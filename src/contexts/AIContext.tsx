import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import path from 'path';
import { AI_TOOLS, executeToolCall, ToolCall, ToolResult, EditorDiagnostic, setCurrentDiagnostics, getErrorDiagnostics } from '../services/AIToolService';
import { isAbsoluteFilePath, joinPathPreserveAbsolute } from '../utils/pathUtils';

export type ChatSender = 'user' | 'ai' | 'system' | 'tool';

export interface ToolCallInfo {
  name: string;
  arguments: string;
  result?: string;
  status: 'pending' | 'running' | 'done' | 'error';
  preview?: ToolCallPreview;
}

export interface ToolCallPreview {
  kind: 'file';
  path: string;
  action: 'create' | 'update' | 'delete';
  originalContent: string;
  newContent: string;
}

export interface ImageAttachment {
  dataUrl: string;
  name: string;
  mimeType: string;
}

export interface Message {
  id: string;
  content: string;
  sender: ChatSender;
  timestamp: Date;
  rawContent?: string;
  reasoning?: string;
  toolCalls?: ToolCallInfo[];
  images?: ImageAttachment[];
}

interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  messages: Message[];
}

export interface AISettings {
  provider: 'lmstudio';
  baseUrl: string;
  model: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  apiKey?: string;
  toolsEnabled: boolean;
  mode: 'qa' | 'coder' | 'autonomous';
  yoloMode: boolean;
}

interface SendMessageOptions {
  displayContent?: string;
  actualContent?: string;
  sender?: ChatSender;
  injectSystemPrompt?: string;
  images?: ImageAttachment[];
}

interface CompletionRequestOptions {
  injectSystemPrompt?: string;
  signal?: AbortSignal;
  includeBasePrompt?: boolean;
}

export type ToolCallSupport = boolean | 'unknown';

export interface PendingToolApproval {
  id: string;
  conversationId: string;
  messageId: string;
  summary: string;
  toolCalls: ToolCallInfo[];
}

interface AIContextType {
  conversations: Conversation[];
  activeConversationId: string;
  setActiveConversation: (id: string) => void;
  startNewConversation: () => void;
  removeConversation: (id: string) => void;
  sendMessage: (content: string, options?: SendMessageOptions) => Promise<string | undefined>;
  requestCompletion: (
    messages: { role: string; content: string }[],
    options?: CompletionRequestOptions
  ) => Promise<string | undefined>;
  cancelRequest: () => void;
  clearMessages: () => void;
  isThinking: boolean;
  isCancelling: boolean;
  settings: AISettings;
  updateSettings: (patch: Partial<AISettings>) => void;
  models: string[];
  refreshModels: () => Promise<void>;
  isFetchingModels: boolean;
  lastError?: string;
  connectionStatus: 'idle' | 'connecting' | 'ready' | 'error';
  toolStatus?: string;
  toolCallSupported: ToolCallSupport;
  checkToolCallSupport: () => Promise<ToolCallSupport>;
  visionSupported: boolean;
  pendingToolApprovals: PendingToolApproval[];
  approvePendingToolApproval: (id: string) => Promise<void>;
  rejectPendingToolApproval: (id: string) => Promise<void>;
}

const AIContext = createContext<AIContextType | undefined>(undefined);

const SETTINGS_KEY = 'lseditor.ai.settings';
const defaultSettings: AISettings = {
  provider: 'lmstudio',
  baseUrl: 'http://localhost:1234',
  model: '',
  temperature: 0.7,
  topP: 1,
  maxTokens: 4096,
  toolsEnabled: true,
  mode: 'coder',
  yoloMode: false
};

const MAX_AGENT_LOOPS = 30;
const MAX_TOOL_WRITE_LINES = 140;
const MAX_TOOL_APPEND_LINES = 120;
const COMPLETION_REQUEST_TIMEOUT_MS = 120000;
const COMPLETION_MAX_RETRIES = 4;
const DIAGNOSTIC_SETTLE_MS = 1200;
const MAX_AUTO_FIX_ROUNDS = 3;

const DEFAULT_BASE_PROMPT = `Du bist LS AI, der integrierte Assistent des LS Editors.
Du hast Tools zum Lesen, Schreiben, Suchen und Ausfuehren von Dateien und Befehlen im Workspace.

Kernregeln:
- Benutze IMMER echte Tool-Calls um Dateien zu aendern. Gib Code NICHT als Chat-Text aus.
- Lies Dateien mit readFile BEVOR du sie aenderst. Lies grosse Dateien in Abschnitten (startLine/endLine).
- Bevorzuge replaceInFile fuer gezielte Aenderungen. writeFile nur fuer neue Dateien.
- Arbeite inkrementell: max ~120 Zeilen pro writeFile/appendToFile/replaceInFile.
- Nach JEDER Code-Aenderung: getDiagnostics aufrufen. Fehler sofort beheben, nicht ignorieren.
- Falls replaceInFile fehlschlaegt: Datei erneut lesen, Suchtext anpassen, erneut versuchen.
- Gib niemals interne Gedanken, Analyse-Tags oder Pseudo-Tool-Syntax aus.
- Beende abgeschlossene Aufgaben mit: ## Ergebnis, ## Vorgehen, ## Validierung`;

const createId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as Crypto).randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const createConversation = (index: number): Conversation => ({
  id: createId(),
  title: `Chat ${index}`,
  createdAt: Date.now(),
  messages: []
});

const sanitizeBaseUrl = (url: string) => {
  if (!url) return 'http://localhost:1234';
  return url.trim().replace(/\/$/, '');
};

const resolveToolTargetPath = (targetPath: string, projectPath?: string) => {
  if (!targetPath) return '';
  if (isAbsoluteFilePath(targetPath)) return path.normalize(targetPath);
  if (projectPath) return joinPathPreserveAbsolute(projectPath, targetPath);
  return path.normalize(targetPath);
};

const extractModels = (payload: any): string[] => {
  if (!payload) return [];
  const list =
    payload?.models ?? payload?.data ?? (Array.isArray(payload) ? payload : []);
  if (!Array.isArray(list)) return [];
  return list
    .map(item => {
      if (typeof item === 'string') return item;
      return item?.id || item?.name || item?.model;
    })
    .filter(Boolean);
};

const extractModelEntries = (payload: any): any[] => {
  if (!payload) return [];
  const list = payload?.models ?? payload?.data ?? (Array.isArray(payload) ? payload : []);
  return Array.isArray(list) ? list : [];
};

const coerceBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'supported', 'enabled'].includes(normalized)) return true;
    if (['false', '0', 'no', 'unsupported', 'disabled'].includes(normalized)) return false;
  }
  return undefined;
};

const inferToolCallSupportFromModel = (modelId: string, modelData?: any): ToolCallSupport => {
  const directFlags = [
    modelData?.supports_tool_calls,
    modelData?.supports_function_calling,
    modelData?.supports_function_calls,
    modelData?.tool_calling,
    modelData?.function_calling,
    modelData?.capabilities?.tool_calls,
    modelData?.capabilities?.function_calling
  ];

  for (const flag of directFlags) {
    const resolved = coerceBoolean(flag);
    if (resolved !== undefined) return resolved;
  }

  const lowerModelId = modelId.toLowerCase();
  if (
    /(?:^|[\s:/_-])(vision|embedding|rerank|reranker|whisper|stt|tts)(?:$|[\s:/_-])/.test(lowerModelId)
  ) {
    return false;
  }

  if (
    /(tool|function)[\s_-]?call/.test(lowerModelId) ||
    /\b(?:gpt-4\.1|gpt-4o|gpt-4\.5|gpt-5|qwen(?:2\.5)?-coder|deepseek-coder|codestral|ministral|devstral|kimi-k2|glm-4|llama-3(?:\.\d+)?(?:-instruct)?|mistral(?:-small|-medium|-large)?|mixtral)\b/.test(lowerModelId)
  ) {
    return 'unknown';
  }

  return 'unknown';
};

const sanitizeAssistantContent = (content: string): string => {
  if (!content) return '';

  let cleaned = content
    // Remove special tokens / protocol markers
    .replace(/<\|channel\|>.*$/gim, '')
    .replace(/<\|message\|>/gim, '')
    .replace(/<\|constrain\|>.*$/gim, '')
    .replace(/<\|start\|>.*$/gim, '')
    .replace(/<\|end\|>/gim, '')
    .replace(/<\|im_start\|>.*$/gim, '')
    .replace(/<\|im_end\|>/gim, '')
    .replace(/<\|endoftext\|>/gim, '')
    // Remove pseudo function-call lines (e.g. "functions.readFile to=assistant", "functions.writeFile({...})")
    .replace(/^[\s]*functions\.\w+.*$/gim, '')
    // Remove "to=assistant" / "to=user" / "to=commentary" protocol markers
    .replace(/\bto=(assistant|user|commentary|tool)\b.*$/gim, '')
    // Remove thinking/analysis blocks
    .replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/<analysis[^>]*>[\s\S]*?<\/analysis>/gi, '')
    .trim();

  const reasoningPattern = /(^|\b)(the instruction says|we have to cite|need to see files|we need to|i need to|let'?s do|internal reasoning|chain-of-thought|scratch work|hidden instructions|analysis to=|read the file|use the tool|call the tool)(\b|$)/i;
  const blocks = cleaned.split(/\n\s*\n/).map(block => block.trim()).filter(Boolean);

  while (blocks.length > 1 && reasoningPattern.test(blocks[0])) {
    blocks.shift();
  }

  cleaned = blocks.join('\n\n').trim();

  const lines = cleaned.split('\n');
  while (lines.length > 1 && reasoningPattern.test(lines[0].trim())) {
    lines.shift();
  }

  return lines.join('\n').trim();
};

const sanitizeReasoningContent = (content: string): string => {
  if (!content) return '';

  return content
    .replace(/<\|channel\|>.*$/gim, '')
    .replace(/<\|message\|>/gim, '')
    .replace(/<\|constrain\|>.*$/gim, '')
    .replace(/<\|start\|>.*$/gim, '')
    .replace(/<\|end\|>/gim, '')
    .replace(/<\|im_start\|>.*$/gim, '')
    .replace(/<\|im_end\|>/gim, '')
    .replace(/<\|endoftext\|>/gim, '')
    .replace(/^\*?reasoning:?\*?\s*/gim, '')
    .trim();
};

const normalizeLoopText = (content: string) =>
  String(content || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const containsPseudoToolProtocol = (content: string): boolean => {
  if (!content) return false;
  return /<\|channel\|>|<\|message\|>|<\|constrain\|>|<\|start\|>|<\|end\|>|<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>|analysis\s+to=|to=commentary|to=assistant|json<\|message\|>|^functions\.\w+/im.test(content);
};

const claimsFileMutationWithoutTool = (content: string): boolean => {
  if (!content) return false;
  return /(updated|created|deleted|renamed|fixed|changed|modified|wrote|saved|resolved|repaired|corrected|patched|behoben|korrigiert|repariert|geloesst|aktualisiert|erstellt|geloescht|umbenannt|gefixt|geaendert|gespeichert)/i.test(content);
};

const containsCodeBlockThatShouldBeWritten = (content: string): boolean => {
  if (!content) return false;
  // Detect markdown code blocks with 4+ lines (likely a full file content the AI should have written)
  const codeBlockMatch = content.match(/```[\w]*\n([\s\S]*?)```/g);
  if (!codeBlockMatch) return false;
  return codeBlockMatch.some(block => {
    const lines = block.split('\n').length;
    return lines >= 6;
  });
};

const statesIntentWithoutActing = (content: string): boolean => {
  if (!content) return false;
  // Detect when the model states what it will do next but doesn't actually call tools
  return /(I'll now|I will now|Let me now|I'm going to|Ich werde|Ich füge|Lass mich|Als nächstes|Now I'll|Next I'll|Let me |I'll |I need to |I should ).*(\.|:|\.\.\.)\s*$/im.test(content);
};

const READ_ONLY_TOOL_NAMES = new Set(['findFile', 'readFile', 'listFiles', 'searchFiles', 'getDiagnostics']);
const MUTATING_TOOL_NAMES = new Set(['writeFile', 'appendToFile', 'replaceInFile', 'createDirectory', 'deleteFile', 'renameFile']);
const EXECUTION_TOOL_NAMES = new Set(['runCommand']);

const toolNeedsApproval = (toolName: string) =>
  MUTATING_TOOL_NAMES.has(toolName) || EXECUTION_TOOL_NAMES.has(toolName);

const getToolsForMode = (settings: AISettings) => {
  if (settings.mode === 'qa') {
    return AI_TOOLS.filter(tool => READ_ONLY_TOOL_NAMES.has(tool.function.name));
  }
  return AI_TOOLS;
};

const createRuntimeModePrompt = (settings: AISettings) => {
  const toolGuidance = [
    'Tool workflow: readFile (in chunks) -> edit with replaceInFile -> getDiagnostics -> fix errors -> repeat until clean.',
    'Use searchWorkspace to find files by name or content. Use findFile when exact path is unknown.',
    'For new larger files: create a small scaffold with writeFile, then extend with appendToFile in chunks.',
    'After code changes, ALWAYS call getDiagnostics. If errors found, read affected lines and fix with replaceInFile.',
    'For substantial tasks, use a markdown checklist (- [ ] / - [x]) and update it as you progress.',
    'End completed tasks with: ## Ergebnis, ## Vorgehen, ## Validierung.'
  ].join('\n');

  if (settings.mode === 'qa') {
    return [
      'Mode: QA. Read-only tools only. Do not modify files or run mutating commands.',
      'Answer questions, explain code, propose changes. For implementation, tell user to switch to Coder mode.',
      toolGuidance
    ].join('\n');
  }

  if (settings.mode === 'autonomous') {
    return [
      'Mode: Autonomous. Work like a senior engineer: plan, implement, validate, iterate.',
      'Create a checklist plan first. Execute step by step. After each step, validate with getDiagnostics and runCommand.',
      'Keep improving until the checklist is done and getDiagnostics reports no errors.',
      'Only stop when work is verified complete.',
      toolGuidance
    ].join('\n');
  }

  return [
    'Mode: Coder. Read, write, create files and run commands to complete coding tasks.',
    'Prefer tool calls over prose. Create a short checklist, execute it, stop when done.',
    'Do not keep iterating beyond the plan unless user asks for more.',
    toolGuidance
  ].join('\n');
};

const summarizeToolCall = (toolCall: ToolCall): string => {
  try {
    const args = JSON.parse(toolCall.function.arguments || '{}');
    switch (toolCall.function.name) {
      case 'readFile':
        return `Reading ${args.path || 'file'}`;
      case 'writeFile':
        return `Writing ${args.path || 'file'}`;
      case 'appendToFile':
        return `Appending to ${args.path || 'file'}`;
      case 'replaceInFile':
        return `Editing ${args.path || 'file'}`;
      case 'findFile':
        return `Finding ${args.query || 'file'}`;
      case 'listFiles':
        return `Listing ${args.path || 'directory'}`;
      case 'searchFiles':
        return `Searching ${args.pattern || 'workspace'}`;
      case 'searchWorkspace':
        return `Searching workspace for ${args.query || 'matches'}`;
      case 'runCommand':
        return `Running ${args.command || 'command'}`;
      case 'createDirectory':
        return `Creating ${args.path || 'directory'}`;
      case 'deleteFile':
        return `Deleting ${args.path || 'path'}`;
      case 'renameFile':
        return `Renaming ${args.oldPath || 'path'}`;
      default:
        return `Running ${toolCall.function.name}`;
    }
  } catch {
    return `Running ${toolCall.function.name}`;
  }
};

const buildAssistantToolMessage = (toolCalls: ToolCall[], content?: string | null) => ({
  role: 'assistant',
  content: content || null,
  tool_calls: toolCalls.map(tc => ({
    id: tc.id,
    type: 'function',
    function: { name: tc.function.name, arguments: tc.function.arguments }
  }))
});

const delay = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });

const shouldRetryCompletionRequest = (status: number, message: string) => {
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  return /(timeout|timed out|network|fetch failed|econnreset|econnrefused|socket hang up|temporar|overloaded|rate limit|too many requests|aborted|broken pipe|connection reset|unexpected end|failed to fetch|load failed|server error|internal error|service unavailable)/i.test(
    message
  );
};

const extractErrorMessage = async (response: Response) => {
  try {
    const payload = await response.json();
    return payload?.error?.message || payload?.message || JSON.stringify(payload);
  } catch {
    return await response.text();
  }
};

interface ExecutedToolRecord {
  name: string;
  summary: string;
  result: string;
  status: 'done' | 'error';
}

const buildRequestSummary = (
  combinedContent: string,
  executedTools: ExecutedToolRecord[],
  stopReason?: string
) => {
  const sanitizedContent = combinedContent.trim();
  const requiredHeadings = ['## Ergebnis', '## Vorgehen', '## Validierung'];
  if (requiredHeadings.every(heading => sanitizedContent.includes(heading))) {
    return combinedContent;
  }

  const successfulTools = executedTools.filter(tool => tool.status === 'done');
  const failedTools = executedTools.filter(tool => tool.status === 'error');
  const resultLine = sanitizedContent
    ? sanitizedContent
    : successfulTools.length
      ? 'Die angeforderte Aufgabe wurde bearbeitet.'
      : 'Die Anfrage wurde beantwortet, ohne Workspace-Aktionen auszufuehren.';

  const approachLines = successfulTools.length
    ? successfulTools.map(tool => `- ${tool.summary}: ${tool.result.replace(/\s+/g, ' ').trim().slice(0, 220)}`)
    : ['- Es waren keine Tool-Aufrufe fuer diese Antwort erforderlich.'];

  const validationLines = [
    ...executedTools
      .filter(tool => tool.name === 'runCommand')
      .map(tool => `- Befehl ausgefuehrt: ${tool.result.replace(/\s+/g, ' ').trim().slice(0, 220)}`),
    ...failedTools.map(tool => `- Offener Punkt: ${tool.summary} -> ${tool.result.replace(/\s+/g, ' ').trim().slice(0, 220)}`),
    ...(stopReason ? [`- Abschlussstatus: ${stopReason}`] : [])
  ];

  if (!validationLines.length) {
    validationLines.push('- Kein separater Test- oder Build-Schritt wurde in dieser Anfrage ausgefuehrt.');
  }

  const summaryBlock = [
    '## Ergebnis',
    resultLine,
    '',
    '## Vorgehen',
    ...approachLines,
    '',
    '## Validierung',
    ...validationLines
  ].join('\n');

  return sanitizedContent ? `${sanitizedContent}\n\n${summaryBlock}` : summaryBlock;
};

const countLines = (value: string) => String(value || '').replace(/\r/g, '').split('\n').length;

const containsOversizedWriteToolCall = (toolCalls: ToolCall[]) => {
  return toolCalls.some(tc => {
    const args = safeJsonParse(tc.function.arguments || '{}');
    if (tc.function.name === 'writeFile') {
      return countLines(typeof args.content === 'string' ? args.content : '') > MAX_TOOL_WRITE_LINES;
    }
    if (tc.function.name === 'appendToFile') {
      return countLines(typeof args.content === 'string' ? args.content : '') > MAX_TOOL_APPEND_LINES;
    }
    if (tc.function.name === 'replaceInFile') {
      return countLines(typeof args.replace === 'string' ? args.replace : '') > MAX_TOOL_WRITE_LINES;
    }
    return false;
  });
};

const isLargeNewFileWrite = (toolCall: ToolCall, preview?: ToolCallPreview) => {
  if (toolCall.function.name !== 'writeFile') return false;
  if (!preview || preview.kind !== 'file' || preview.action !== 'create') return false;
  const args = safeJsonParse(toolCall.function.arguments || '{}');
  return countLines(typeof args.content === 'string' ? args.content : '') > 60;
};

const isRiskyWritePreview = (preview?: ToolCallPreview) => {
  if (!preview || preview.kind !== 'file' || preview.action !== 'update') return false;
  const originalLines = countLines(preview.originalContent || '');
  const newLines = countLines(preview.newContent || '');
  return originalLines >= 20 && newLines <= Math.max(5, Math.floor(originalLines * 0.4));
};

const findReplaceSearchMiss = (toolCalls: ToolCall[], toolResults: ToolResult[]) => {
  for (let index = 0; index < toolCalls.length; index += 1) {
    const toolCall = toolCalls[index];
    const toolResult = toolResults[index];
    if (!toolCall || !toolResult) continue;
    if (toolCall.function.name !== 'replaceInFile') continue;
    if (!toolResult.content.startsWith('Error: Search text not found in ')) continue;

    const args = safeJsonParse(toolCall.function.arguments || '{}');
    const failedPath = String(args.path || '').trim();
    const resolvedPath = toolResult.content.replace('Error: Search text not found in ', '').trim();
    return {
      failedPath,
      resolvedPath
    };
  }
  return null;
};

const serializeToolMessageForModel = (message: Message) => {
  if (!message.toolCalls?.length) {
    return message.content || '';
  }

  const lines = message.toolCalls.map(call => {
    const previewPath = call.preview?.path ? ` ${call.preview.path}` : '';
    const result = call.result ? ` -> ${call.result.replace(/\s+/g, ' ').trim().slice(0, 220)}` : '';
    return `- ${call.name}${previewPath} [${call.status}]${result}`;
  });

  const sections = ['Tool activity executed in this conversation:', ...lines];
  if (message.reasoning) {
    sections.push(`Reasoning summary: ${message.reasoning.replace(/\s+/g, ' ').trim().slice(0, 280)}`);
  }
  return sections.join('\n');
};

const userRequestLikelyNeedsTools = (content: string, mode: AISettings['mode']) => {
  if (mode === 'qa') return false;
  // Action verbs that clearly imply file mutations
  const actionPattern = /\b(program|implement|create|write|save|edit|change|modify|update|fix|refactor|build|run|test|add|remove|delete|rename|move|install|deploy|optimize|improve|replace|insert|append|merge|setup|configure|erstell|schreib|programmier|aender|änder|fixe|teste|baue|hinzufüg|entfern|lösch|verschieb|installier|einricht|optimier|verbesse|fuer mich|mach|mache)\b/i;
  // Exclude purely informational queries even if they contain action words
  const infoPattern = /^(was |wie |warum |wann |wo |wer |erkl|beschreib|zeig|explain|describe|show|what |how |why |when |where |who |tell me|can you explain|can i|should i|is it|do i need)/i;
  if (infoPattern.test(content.trim())) return false;
  return actionPattern.test(content);
};

const extractPseudoToolCalls = (content: string): ToolCall[] => {
  if (!content) return [];
  const calls: ToolCall[] = [];
  const pushCall = (name: string, args: string) => {
    if (!name) return;
    calls.push({
      id: createId(),
      type: 'function',
      function: {
        name,
        arguments: args || '{}'
      }
    });
  };

  const fnPattern = /(?:functions?\.)?([A-Za-z_]\w*)\s*\((\{[\s\S]*?\})\)/g;
  let fnMatch: RegExpExecArray | null;
  while ((fnMatch = fnPattern.exec(content)) !== null) {
    const toolName = fnMatch[1];
    if (AI_TOOLS.some(tool => tool.function.name === toolName)) {
      pushCall(toolName, fnMatch[2]);
    }
  }

  const tagPattern = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagPattern.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(tagMatch[1]);
      const toolName = parsed?.name || parsed?.tool || parsed?.function?.name;
      const args =
        typeof parsed?.arguments === 'string'
          ? parsed.arguments
          : JSON.stringify(parsed?.arguments || parsed?.parameters || {});
      if (toolName) pushCall(toolName, args);
    } catch {
      // ignore malformed pseudo tool calls
    }
  }

  return calls;
};

const safeJsonParse = (value: string) => {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
};

const normalizeTrackedPath = (value: string) =>
  String(value || '').replace(/\\/g, '/').trim().toLowerCase();

interface CompletionResult {
  content: string;
  reasoning?: string;
  finishReason?: string;
  toolCalls?: ToolCall[];
  reasoningOnly?: boolean;
  usage?: {
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface AgentLoopState {
  conversationId: string;
  apiMessages: any[];
  controller: AbortController;
  requestId: string;
  combinedContent: string;
  combinedReasoning: string[];
  stopReason?: string;
  loops: number;
  performedMutationTool: boolean;
  mutationCorrectionSent: boolean;
  toolProtocolCorrectionSent: boolean;
  lastNormalizedResponse?: string;
  repeatedResponseCount: number;
  executedTools: ExecutedToolRecord[];
  replaceReReadRequiredPaths: string[];
  nonMutatingToolRounds: number;
  completionWithoutMutationCorrectionSent: boolean;
  autoFixRounds: number;
  consecutiveEmptyResponses: number;
}

interface PendingToolExecutionState extends AgentLoopState {
  id: string;
  messageId: string;
  toolCalls: ToolCall[];
}

export const AIProvider: React.FC<{ children: React.ReactNode; projectPath?: string }> = ({ children, projectPath }) => {
  const [settings, setSettings] = useState<AISettings>(() => {
    if (typeof window === 'undefined') return defaultSettings;
    try {
      const stored = window.localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          ...defaultSettings,
          ...parsed,
          baseUrl: sanitizeBaseUrl(parsed.baseUrl ?? defaultSettings.baseUrl)
        };
      }
    } catch (error) {
      console.warn('Failed to parse stored AI settings', error);
    }
    return defaultSettings;
  });

  const [conversations, setConversations] = useState<Conversation[]>([createConversation(1)]);
  const [activeConversationId, setActiveConversationId] = useState(conversations[0].id);
  const [models, setModels] = useState<string[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [lastError, setLastError] = useState<string | undefined>();
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'ready' | 'error'>('idle');
  const [toolStatus, setToolStatus] = useState<string | undefined>();
  const [toolCallSupported, setToolCallSupported] = useState<ToolCallSupport>('unknown');
  const [pendingToolApprovals, setPendingToolApprovals] = useState<PendingToolApproval[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const basePromptRef = useRef<string>(DEFAULT_BASE_PROMPT);
  const projectPathRef = useRef(projectPath);
  const modelMetadataRef = useRef<Map<string, any>>(new Map());
  const pendingToolExecutionRef = useRef<Map<string, PendingToolExecutionState>>(new Map());

  const buildToolCallPreview = useCallback(
    async (toolCall: ToolCall): Promise<ToolCallPreview | undefined> => {
      const args = safeJsonParse(toolCall.function.arguments || '{}');
      const targetPath = typeof args.path === 'string' ? args.path : '';
      if (!targetPath || !window.electron?.ipcRenderer) return undefined;

      const renderer = window.electron.ipcRenderer;

      if (toolCall.function.name === 'writeFile') {
        const absolutePath = resolveToolTargetPath(targetPath, projectPathRef.current);
        let originalContent = '';
        try {
          const diskContent = await renderer.invoke('fs:readFile', absolutePath);
          if (typeof diskContent === 'string') originalContent = diskContent;
        } catch {
          originalContent = '';
        }
        return {
          kind: 'file',
          path: targetPath,
          action: originalContent ? 'update' : 'create',
          originalContent,
          newContent: typeof args.content === 'string' ? args.content : ''
        };
      }

      if (toolCall.function.name === 'replaceInFile') {
        const absolutePath = resolveToolTargetPath(targetPath, projectPathRef.current);
        const diskContent = await renderer.invoke('fs:readFile', absolutePath);
        if (typeof diskContent !== 'string') return undefined;
        const search = typeof args.search === 'string' ? args.search : '';
        const replace = typeof args.replace === 'string' ? args.replace : '';
        if (!search) return undefined;
        const replaceAll = Boolean(args.allOccurrences);
        const newContent = replaceAll
          ? diskContent.split(search).join(replace)
          : diskContent.replace(search, replace);
        if (newContent === diskContent) {
          return undefined;
        }
        return {
          kind: 'file',
          path: targetPath,
          action: 'update',
          originalContent: diskContent,
          newContent
        };
      }

      if (toolCall.function.name === 'deleteFile') {
        const absolutePath = resolveToolTargetPath(targetPath, projectPathRef.current);
        const diskContent = await renderer.invoke('fs:readFile', absolutePath);
        if (typeof diskContent !== 'string') return undefined;
        return {
          kind: 'file',
          path: targetPath,
          action: 'delete',
          originalContent: diskContent,
          newContent: ''
        };
      }

      return undefined;
    },
    []
  );

  const buildToolCallInfo = useCallback(
    async (toolCall: ToolCall): Promise<ToolCallInfo> => {
      try {
        return {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
          status: 'pending',
          preview: await buildToolCallPreview(toolCall)
        };
      } catch {
        return {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
          status: 'pending'
        };
      }
    },
    [buildToolCallPreview]
  );

  useEffect(() => {
    projectPathRef.current = projectPath;
  }, [projectPath]);

  // Listen for editor diagnostic changes and store them globally
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail && Array.isArray(detail.diagnostics)) {
        setCurrentDiagnostics(detail.diagnostics as EditorDiagnostic[]);
      }
    };
    window.addEventListener('editor:diagnosticsChanged', handler);
    return () => window.removeEventListener('editor:diagnosticsChanged', handler);
  }, []);

  const loadBasePrompt = useCallback(async (): Promise<string> => {
    try {
      if (window.electron?.ipcRenderer) {
        const content = await window.electron.ipcRenderer.invoke('ai:getBasePrompt');
        if (typeof content === 'string' && content.trim().length > 0) {
          basePromptRef.current = content.trim();
          return basePromptRef.current;
        }
      }
    } catch (error) {
      console.warn('Failed to load base prompt, falling back to default.', error);
    }
    basePromptRef.current = DEFAULT_BASE_PROMPT;
    return basePromptRef.current;
  }, []);

  useEffect(() => {
    loadBasePrompt();
  }, [loadBasePrompt]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }
  }, [settings]);

  const updateSettings = useCallback((patch: Partial<AISettings>) => {
    setSettings(prev => ({
      ...prev,
      ...patch,
      baseUrl: patch.baseUrl ? sanitizeBaseUrl(patch.baseUrl) : prev.baseUrl
    }));
  }, []);

  const refreshModels = useCallback(async () => {
    const baseUrl = sanitizeBaseUrl(settings.baseUrl);
    setIsFetchingModels(true);
    setConnectionStatus('connecting');

    try {
      const endpoints = [`${baseUrl}/v1/models`, `${baseUrl}/models`];
      let fetched: string[] = [];
      let fetchedMetadata = new Map<string, any>();
      let lastErrorMessage = '';

      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint);
          if (!response.ok) {
            lastErrorMessage = `HTTP ${response.status}`;
            continue;
          }
          const payload = await response.json();
          fetched = extractModels(payload);
          if (fetched.length) {
            fetchedMetadata = new Map(
              extractModelEntries(payload)
                .map(entry => {
                  const id =
                    typeof entry === 'string'
                      ? entry
                      : entry?.id || entry?.name || entry?.model;
                  return id ? [String(id), entry] : null;
                })
                .filter(Boolean) as Array<[string, any]>
            );
            break;
          }
        } catch (error) {
          lastErrorMessage = error instanceof Error ? error.message : String(error);
        }
      }

      if (!fetched.length) {
        throw new Error(lastErrorMessage || 'Keine Modelle gefunden');
      }
      modelMetadataRef.current = fetchedMetadata;

      setModels(fetched);
      setConnectionStatus('ready');
      setLastError(undefined);
      setToolCallSupported(prev => (settings.model ? prev : 'unknown'));

      setSettings(prev => {
        if (prev.model && fetched.includes(prev.model)) {
          return prev;
        }
        return { ...prev, model: fetched[0] };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setModels([]);
      setConnectionStatus('error');
      setLastError(message);
      setToolCallSupported('unknown');
    } finally {
      setIsFetchingModels(false);
    }
  }, [settings.baseUrl, settings.model]);

  useEffect(() => {
    refreshModels();
  }, [refreshModels]);

  const checkToolCallSupport = useCallback(async (): Promise<ToolCallSupport> => {
    const selectedModel = settings.model?.trim();
    if (!selectedModel) {
      setToolCallSupported('unknown');
      return 'unknown';
    }

    const inferred = inferToolCallSupportFromModel(
      selectedModel,
      modelMetadataRef.current.get(selectedModel)
    );

    if (inferred !== 'unknown') {
      setToolCallSupported(inferred);
      return inferred;
    }

    const baseUrl = sanitizeBaseUrl(settings.baseUrl);
    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: selectedModel,
          temperature: 0,
          max_tokens: 32,
          messages: [
            {
              role: 'user',
              content:
                'If tool calling is available, call the getWorkspaceInfo tool. Otherwise reply with the exact text NO_TOOL_SUPPORT.'
            }
          ],
          tools: [
            {
              type: 'function',
              function: {
                name: 'getWorkspaceInfo',
                description: 'Returns a short workspace description.',
                parameters: {
                  type: 'object',
                  properties: {},
                  additionalProperties: false
                }
              }
            }
          ],
          tool_choice: {
            type: 'function',
            function: {
              name: 'getWorkspaceInfo'
            }
          }
        })
      });

      if (!response.ok) {
        const fallback = await response.text().catch(() => '');
        const lower = fallback.toLowerCase();
        if (
          lower.includes('tool') ||
          lower.includes('function call') ||
          lower.includes('function calling') ||
          lower.includes('does not support')
        ) {
          setToolCallSupported(false);
          return false;
        }
        setToolCallSupported('unknown');
        return 'unknown';
      }

      const payload = await response.json();
      const choice = payload?.choices?.[0];
      const toolCalls = choice?.message?.tool_calls;
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        setToolCallSupported(true);
        return true;
      }

      const content = String(choice?.message?.content || '').trim();
      if (content === 'NO_TOOL_SUPPORT') {
        setToolCallSupported(false);
        return false;
      }

      setToolCallSupported(false);
      return false;
    } catch (error) {
      console.warn('Failed to verify tool calling support', error);
    }

    setToolCallSupported('unknown');
    return 'unknown';
  }, [settings.apiKey, settings.baseUrl, settings.model]);

  const getActiveConversation = useCallback(
    () => conversations.find(conv => conv.id === activeConversationId) ?? conversations[0],
    [conversations, activeConversationId]
  );

  const startNewConversation = useCallback(() => {
    setConversations(prev => {
      const newConv = createConversation(prev.length + 1);
      setActiveConversationId(newConv.id);
      return [...prev, newConv];
    });
  }, []);

  const removeConversation = useCallback(
    (conversationId: string) => {
      setConversations(prev => {
        if (prev.length === 1 && prev[0].id === conversationId) {
          const replacement = createConversation(1);
          setActiveConversationId(replacement.id);
          return [replacement];
        }

        const filtered = prev.filter(conv => conv.id !== conversationId);
        if (filtered.length === prev.length) {
          return prev;
        }

        if (conversationId === activeConversationId) {
          const fallback = filtered[filtered.length - 1] ?? createConversation(1);
          setActiveConversationId(fallback.id);
          if (!filtered.length) {
            return [fallback];
          }
        }

        return filtered.length ? filtered : prev;
      });
    },
    [activeConversationId]
  );

  const clearMessages = useCallback(() => {
    setConversations(prev =>
      prev.map(conv => (conv.id === activeConversationId ? { ...conv, messages: [] } : conv))
    );
  }, [activeConversationId]);

  const cancelRequest = useCallback(() => {
    if (abortControllerRef.current) {
      setIsCancelling(true);
      abortControllerRef.current.abort();
    }
  }, []);

  const mapMessages = useCallback((messages: Message[]) => {
    return messages
      .map(message => {
        const role =
          message.sender === 'user'
            ? 'user'
            : message.sender === 'tool'
              ? 'system'
              : message.sender === 'ai'
                ? 'assistant'
                : 'system';
        const textContent =
          message.sender === 'tool'
            ? serializeToolMessageForModel(message)
            : message.rawContent ?? message.content;

        if (message.images && message.images.length > 0 && role === 'user') {
          const parts: any[] = [];
          for (const img of message.images) {
            parts.push({
              type: 'image_url',
              image_url: { url: img.dataUrl, detail: 'low' }
            });
          }
          if (textContent) {
            parts.push({ type: 'text', text: textContent });
          }
          return { role, content: parts };
        }

        return { role, content: textContent };
      });
  }, []);

  /** Prune API messages to stay within a rough character budget.
   *  Keeps:
   *  - All system messages (prompts)
   *  - The last user message
   *  - The most recent N messages fitting the budget
   *  - A summary note of dropped messages
   */
  const pruneApiMessages = useCallback((messages: any[], charBudget: number = 60000): any[] => {
    // Split into system messages and conversation messages
    const systemMessages = messages.filter((m: any) => m.role === 'system');
    const conversationMessages = messages.filter((m: any) => m.role !== 'system');

    if (conversationMessages.length <= 4) return messages;

    // Estimate character cost of each message
    const estimateChars = (msg: any): number => {
      if (typeof msg.content === 'string') return msg.content.length;
      if (Array.isArray(msg.content)) {
        return msg.content.reduce((sum: number, part: any) => {
          if (part.type === 'text') return sum + (part.text?.length || 0);
          if (part.type === 'image_url') return sum + 500; // rough estimate for image ref
          return sum;
        }, 0);
      }
      return JSON.stringify(msg).length;
    };

    const systemChars = systemMessages.reduce((sum, m) => sum + estimateChars(m), 0);
    const remainingBudget = charBudget - systemChars;

    // Always keep the first user message (original request context) and the last 2 messages
    const firstUserIdx = conversationMessages.findIndex((m: any) => m.role === 'user');
    const firstUserMsg = firstUserIdx >= 0 ? conversationMessages[firstUserIdx] : null;

    // Build from the end, keeping recent messages within budget
    const kept: any[] = [];
    let usedChars = 0;

    for (let i = conversationMessages.length - 1; i >= 0; i--) {
      const msg = conversationMessages[i];
      const cost = estimateChars(msg);
      if (usedChars + cost > remainingBudget && kept.length >= 4) {
        break;
      }
      kept.unshift(msg);
      usedChars += cost;
    }

    // If we dropped messages and the first user message isn't in kept, prepend it
    const droppedCount = conversationMessages.length - kept.length;
    if (droppedCount > 0) {
      if (firstUserMsg && !kept.includes(firstUserMsg)) {
        kept.unshift(firstUserMsg);
      }
      // Add a summary note so the model knows context was pruned
      const summaryNote = {
        role: 'system',
        content: `[Context note: ${droppedCount} earlier message(s) were pruned to save context space. The conversation continues from the most recent exchanges. If you need earlier file contents, re-read them.]`
      };
      return [...systemMessages, summaryNote, ...kept];
    }

    return [...systemMessages, ...kept];
  }, []);

  const performCompletion = useCallback(
    async (
      payloadMessages: any[],
      signal: AbortSignal,
      useTools: boolean = false,
      toolChoice: 'auto' | 'required' = 'auto'
    ): Promise<CompletionResult> => {
      // Ensure there is always at least one user-role message.
      // Some LM Studio Jinja templates error with "No user query found" otherwise.
      let finalMessages = payloadMessages;
      const hasUserMessage = payloadMessages.some((m: any) => m.role === 'user');
      if (!hasUserMessage) {
        // Insert a user message before any assistant/tool messages
        const firstNonSystem = payloadMessages.findIndex((m: any) => m.role !== 'system');
        const insertAt = firstNonSystem === -1 ? payloadMessages.length : firstNonSystem;
        finalMessages = [
          ...payloadMessages.slice(0, insertAt),
          { role: 'user', content: 'Bitte antworte auf die vorherige Anfrage.' },
          ...payloadMessages.slice(insertAt)
        ];
      }

      const body: any = {
        model: settings.model,
        temperature: settings.temperature,
        top_p: settings.topP,
        max_tokens: settings.maxTokens,
        messages: finalMessages
      };

      if (useTools && settings.toolsEnabled) {
        body.tools = getToolsForMode(settings);
        body.tool_choice = toolChoice;
      }

      let payload: any;
      let lastAttemptError: Error | null = null;

      for (let attempt = 1; attempt <= COMPLETION_MAX_RETRIES; attempt += 1) {
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        const attemptController = new AbortController();
        const timeoutId = setTimeout(() => attemptController.abort(), COMPLETION_REQUEST_TIMEOUT_MS);
        const abortRelay = () => attemptController.abort();
        signal.addEventListener('abort', abortRelay, { once: true });

        try {
          const response = await fetch(`${sanitizeBaseUrl(settings.baseUrl)}/v1/chat/completions`, {
            method: 'POST',
            signal: attemptController.signal,
            headers: {
              'Content-Type': 'application/json',
              ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {})
            },
            body: JSON.stringify(body)
          });

          if (!response.ok) {
            const detail = await extractErrorMessage(response);
            const message = detail || `LM Studio antwortete mit Status ${response.status}`;
            if (attempt < COMPLETION_MAX_RETRIES && shouldRetryCompletionRequest(response.status, message)) {
              lastAttemptError = new Error(message);
              await delay(Math.min(500 * Math.pow(2, attempt - 1), 5000));
              continue;
            }
            throw new Error(message);
          }

          payload = await response.json();
          lastAttemptError = null;
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const attemptTimedOut = attemptController.signal.aborted && !signal.aborted;

          if (signal.aborted) {
            throw error instanceof Error ? error : new Error(message);
          }

          if (attempt < COMPLETION_MAX_RETRIES && (attemptTimedOut || shouldRetryCompletionRequest(0, message))) {
            lastAttemptError = error instanceof Error ? error : new Error(message);
            await delay(Math.min(500 * Math.pow(2, attempt - 1), 5000));
            continue;
          }

          throw error instanceof Error ? error : new Error(message);
        } finally {
          clearTimeout(timeoutId);
          signal.removeEventListener('abort', abortRelay);
        }
      }

      if (!payload) {
        throw lastAttemptError || new Error('The model returned no payload.');
      }

      const choice = payload?.choices?.[0];
      const rawContent = choice?.message?.content?.trim() || '';
      const reasoningContent = sanitizeReasoningContent(choice?.message?.reasoning_content?.trim() || '');
      const isReasoningOnly = !rawContent && !!reasoningContent;
      const aiContent = sanitizeAssistantContent(rawContent);
      const rawToolCalls = choice?.message?.tool_calls;

      let toolCalls: ToolCall[] | undefined;
      if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
        toolCalls = rawToolCalls.map((tc: any) => ({
          id: tc.id || createId(),
          type: 'function' as const,
          function: {
            name: tc.function?.name || '',
            arguments: tc.function?.arguments || '{}'
          }
        }));
      } else if (useTools) {
        const pseudoToolCalls = extractPseudoToolCalls(rawContent);
        if (pseudoToolCalls.length > 0) {
          toolCalls = pseudoToolCalls;
        }
      }

      if (!aiContent && !reasoningContent && !toolCalls?.length) {
        // Return empty so the agent loop can re-prompt instead of crashing
        return { content: '', finishReason: choice?.finish_reason, toolCalls: undefined, usage: payload?.usage };
      }

      return {
        content: aiContent,
        reasoning: reasoningContent,
        finishReason: choice?.finish_reason,
        reasoningOnly: isReasoningOnly,
        toolCalls,
        usage: payload?.usage
      };
    },
    [settings]
  );

  const buildSystemMessages = useCallback(
    async (injectSystemPrompt?: string, includeBasePrompt: boolean = true) => {
      const systemMessages: Array<{ role: string; content: string }> = [];
      const basePrompt = includeBasePrompt ? await loadBasePrompt() : '';
      if (basePrompt) {
        systemMessages.push({ role: 'system', content: basePrompt });
      }
      systemMessages.push({ role: 'system', content: createRuntimeModePrompt(settings) });
      if (projectPathRef.current) {
        systemMessages.push({
          role: 'system',
          content: `Current workspace/project path: ${projectPathRef.current}`
        });
      }
      if (injectSystemPrompt) {
        systemMessages.push({ role: 'system', content: injectSystemPrompt });
      }
      return systemMessages;
    },
    [loadBasePrompt, settings]
  );

  const requestCompletion = useCallback(
    async (
      payloadMessages: { role: string; content: string }[],
      options?: CompletionRequestOptions
    ) => {
      if (!settings.model) {
        return undefined;
      }
      const systemMessages = await buildSystemMessages(
        options?.injectSystemPrompt,
        options?.includeBasePrompt ?? true
      );
      const signal = options?.signal ?? new AbortController().signal;
      const result = await performCompletion([...systemMessages, ...payloadMessages], signal, false);
      return result?.content;
    },
    [buildSystemMessages, performCompletion, settings.model]
  );

  const shouldContinue = useCallback(
    (result: CompletionResult) => {
      if (!result) return false;
      if (result.finishReason === 'length') return true;
      const used = result.usage?.completion_tokens;
      if (!used || !settings.maxTokens) return false;
      return used >= settings.maxTokens * 0.9;
    },
    [settings.maxTokens]
  );

  const addMessageToConversation = useCallback((conversationId: string, message: Message) => {
    setConversations(prev =>
      prev.map(conv =>
        conv.id === conversationId
          ? { ...conv, messages: [...conv.messages, message] }
          : conv
      )
    );
  }, []);

  const updateToolMessage = useCallback(
    (
      conversationId: string,
      messageId: string,
      updater: (current: ToolCallInfo[]) => ToolCallInfo[]
    ) => {
      setConversations(prev =>
        prev.map(conv => {
          if (conv.id !== conversationId) return conv;
          return {
            ...conv,
            messages: conv.messages.map(message => {
              if (message.id !== messageId || !message.toolCalls) return message;
              return {
                ...message,
                toolCalls: updater(message.toolCalls)
              };
            })
          };
        })
      );
    },
    []
  );

  const finalizeAssistantMessage = useCallback(
    (
      conversationId: string,
      combinedContent: string,
      combinedReasoning: string[],
      stopReason?: string,
      executedTools: ExecutedToolRecord[] = []
    ) => {
      const parts: string[] = [];
      if (combinedContent) parts.push(combinedContent);
      if (stopReason) parts.push(`\n\n---\n*${stopReason}*`);
      const aiMessage: Message = {
        id: createId(),
        content: buildRequestSummary(parts.join('') || '(No response)', executedTools, stopReason),
        reasoning: combinedReasoning.join('\n\n').trim() || undefined,
        sender: 'ai',
        timestamp: new Date()
      };
      addMessageToConversation(conversationId, aiMessage);
    },
    [addMessageToConversation]
  );

  const runAgentLoop = useCallback(
    async (
      state: AgentLoopState,
      initialUserContent: string
    ): Promise<string | undefined> => {
      try {
        let currentState = { ...state };

        while (!currentState.controller.signal.aborted) {
          currentState.loops += 1;
          if (currentState.loops > MAX_AGENT_LOOPS) {
            currentState.stopReason = 'Stopped: execution loop guard reached.';
            currentState.combinedContent += currentState.combinedContent
              ? '\n\nI stopped to avoid an execution loop. Summarize or continue with a more specific next prompt.'
              : 'I stopped to avoid an execution loop. Summarize or continue with a more specific next prompt.';
            break;
          }
          const useTools = settings.toolsEnabled;
          const forceToolChoice =
            toolCallSupported !== false &&
            settings.mode !== 'qa' &&
            currentState.mutationCorrectionSent &&
            !currentState.performedMutationTool;

          // Prune context if message history has grown large
          const prunedMessages = pruneApiMessages(currentState.apiMessages);
          if (prunedMessages.length < currentState.apiMessages.length) {
            currentState.apiMessages = prunedMessages;
          }

          const result = await performCompletion(
            currentState.apiMessages,
            currentState.controller.signal,
            useTools,
            forceToolChoice ? 'required' : 'auto'
          );

          if (result.reasoning && !currentState.combinedReasoning.includes(result.reasoning)) {
            currentState.combinedReasoning = [...currentState.combinedReasoning, result.reasoning];
          }

          if (result.toolCalls && result.toolCalls.length > 0) {
            const toolCalls = result.toolCalls;
            if (containsOversizedWriteToolCall(toolCalls)) {
              currentState.apiMessages = [
                ...currentState.apiMessages,
                buildAssistantToolMessage(toolCalls, result.content),
                {
                  role: 'user',
                  content:
                    'Do not write such a large block at once. Split the work into smaller tool-call chunks, ideally under 200 lines per write or replacement. For new files, create a small scaffold first and then extend it incrementally.'
                }
              ];
              continue;
            }
            const invalidReadCall = toolCalls.find(tc => {
              if (tc.function.name !== 'readFile') return false;
              const args = safeJsonParse(tc.function.arguments || '{}');
              return args.startLine == null && args.endLine == null;
            });
            if (invalidReadCall) {
              currentState.apiMessages = [
                ...currentState.apiMessages,
                buildAssistantToolMessage(toolCalls, result.content),
                {
                  role: 'user',
                  content:
                    'Do not read full files in one call. Use readFile with explicit startLine and endLine, then continue with the next range if needed.'
                }
              ];
              continue;
            }
            const blockedReplaceCall = toolCalls.find(tc => {
              if (tc.function.name !== 'replaceInFile') return false;
              const args = safeJsonParse(tc.function.arguments || '{}');
              const pathKey = normalizeTrackedPath(String(args.path || ''));
              return currentState.replaceReReadRequiredPaths.includes(pathKey);
            });
            if (blockedReplaceCall) {
              currentState.apiMessages = [
                ...currentState.apiMessages,
                buildAssistantToolMessage(toolCalls, result.content),
                {
                  role: 'user',
                  content:
                    'You must reread that file in chunks with readFile using startLine/endLine before trying replaceInFile again. Do not retry the same edit against stale content.'
                }
              ];
              continue;
            }
            const toolCallInfos: ToolCallInfo[] = await Promise.all(
              toolCalls.map(tc => buildToolCallInfo(tc))
            );
            const riskyOverwrite = toolCallInfos.find(
              (info, index) =>
                toolCalls[index]?.function.name === 'writeFile' &&
                isRiskyWritePreview(info.preview)
            );
            if (riskyOverwrite) {
              currentState.apiMessages = [
                ...currentState.apiMessages,
                buildAssistantToolMessage(toolCalls, result.content),
                {
                  role: 'user',
                  content:
                    'This writeFile looks destructive because it would overwrite an existing file with much less content. Do not replace the whole file. Read the current file again if needed and use a precise replaceInFile-based edit or a clearly justified full rewrite.'
                }
              ];
              continue;
            }
            const largeNewFileWrite = toolCallInfos.find(
              (info, index) => isLargeNewFileWrite(toolCalls[index], info.preview)
            );
            if (largeNewFileWrite) {
              currentState.apiMessages = [
                ...currentState.apiMessages,
                buildAssistantToolMessage(toolCalls, result.content),
                {
                  role: 'user',
                  content:
                    'This new file is too large for a single writeFile call. First create a minimal scaffold with writeFile, then continue in multiple appendToFile or small replaceInFile chunks. Keep each chunk small and meaningful.'
                }
              ];
              continue;
            }

            currentState.apiMessages = [
              ...currentState.apiMessages,
              buildAssistantToolMessage(toolCalls, result.content)
            ];

            const toolMessage: Message = {
              id: createId(),
              content: result.content || '',
              reasoning: result.reasoning,
              sender: 'tool',
              timestamp: new Date(),
              toolCalls: toolCallInfos
            };
            addMessageToConversation(currentState.conversationId, toolMessage);

            if (
              !settings.yoloMode &&
              toolCalls.some(tc => toolNeedsApproval(tc.function.name))
            ) {
              const approvalId = createId();
              pendingToolExecutionRef.current.set(approvalId, {
                ...currentState,
                id: approvalId,
                messageId: toolMessage.id,
                toolCalls
              });
              setPendingToolApprovals(prev => [
                ...prev,
                {
                  id: approvalId,
                  conversationId: currentState.conversationId,
                  messageId: toolMessage.id,
                  summary: toolCalls.map(summarizeToolCall).join(' | '),
                  toolCalls: toolCallInfos
                }
              ]);
              setToolStatus('Waiting for approval');
              abortControllerRef.current = null;
              setIsThinking(false);
              setIsCancelling(false);
              return currentState.combinedContent;
            }

            const toolResults: ToolResult[] = [];
            let roundPerformedMutation = false;
            for (let index = 0; index < toolCalls.length; index += 1) {
              const tc = toolCalls[index];
              setToolStatus(summarizeToolCall(tc));

              updateToolMessage(currentState.conversationId, toolMessage.id, current =>
                current.map((entry, entryIndex) =>
                  entryIndex === index ? { ...entry, status: 'running' } : entry
                )
              );

              const toolResult = await executeToolCall(tc, projectPathRef.current, {
                signal: currentState.controller.signal,
                requestId: `${currentState.requestId}:${tc.id}`
              });
              toolResults.push(toolResult);
              if (
                MUTATING_TOOL_NAMES.has(tc.function.name) &&
                !toolResult.content.startsWith('Error')
              ) {
                currentState.performedMutationTool = true;
                roundPerformedMutation = true;
              }
              currentState.executedTools = [
                ...currentState.executedTools,
                {
                  name: tc.function.name,
                  summary: summarizeToolCall(tc),
                  result: toolResult.content,
                  status: toolResult.content.startsWith('Error') ? 'error' : 'done'
                }
              ];
              if (tc.function.name === 'readFile' && !toolResult.content.startsWith('Error')) {
                const args = safeJsonParse(tc.function.arguments || '{}');
                if (args.startLine != null || args.endLine != null) {
                  const readPath = normalizeTrackedPath(String(args.path || ''));
                  currentState.replaceReReadRequiredPaths = currentState.replaceReReadRequiredPaths.filter(
                    tracked => tracked !== readPath
                  );
                }
              }

              updateToolMessage(currentState.conversationId, toolMessage.id, current =>
                current.map((entry, entryIndex) =>
                  entryIndex === index
                    ? {
                        ...entry,
                        status: toolResult.content.startsWith('Error') ? 'error' : 'done',
                        result: toolResult.content.substring(0, 500)
                      }
                    : entry
                )
              );
            }

            currentState.apiMessages = [
              ...currentState.apiMessages,
              ...toolResults.map(tr => ({
                role: 'tool',
                tool_call_id: tr.tool_call_id,
                content: tr.content
              }))
            ];
            if (currentState.controller.signal.aborted) {
              break;
            }
            updateToolMessage(currentState.conversationId, toolMessage.id, current =>
              current.map((entry, entryIndex) => {
                const toolResult = toolResults[entryIndex];
                if (!toolResult) return entry;
                return {
                  ...entry,
                  status: toolResult.content.startsWith('Error') ? 'error' : 'done',
                  result: entry.result ?? toolResult.content.substring(0, 500)
                };
              })
            );
            const replaceSearchMiss = findReplaceSearchMiss(toolCalls, toolResults);
            if (replaceSearchMiss) {
              const trackedPath = normalizeTrackedPath(
                replaceSearchMiss.resolvedPath || replaceSearchMiss.failedPath || ''
              );
              if (trackedPath && !currentState.replaceReReadRequiredPaths.includes(trackedPath)) {
                currentState.replaceReReadRequiredPaths = [
                  ...currentState.replaceReReadRequiredPaths,
                  trackedPath
                ];
              }
              currentState.apiMessages = [
                ...currentState.apiMessages,
                {
                  role: 'user',
                  content: `The previous replaceInFile failed because the search text no longer matched in ${replaceSearchMiss.resolvedPath || replaceSearchMiss.failedPath || 'the file'}. Read that file again in chunks with explicit startLine and endLine, inspect the latest content, and only then apply a smaller replacement. Do not repeat the same replaceInFile call unchanged.`
                }
              ];
              setToolStatus(undefined);
              continue;
            }
            if (
              !roundPerformedMutation &&
              userRequestLikelyNeedsTools(initialUserContent, settings.mode)
            ) {
              currentState.nonMutatingToolRounds += 1;
              // Allow up to 6 read-only rounds (reading large files in chunks is normal).
              // Only warn after 6, force after 8.
              if (currentState.nonMutatingToolRounds >= 8) {
                currentState.apiMessages = [
                  ...currentState.apiMessages,
                  {
                    role: 'user',
                    content:
                      'You have spent 8 rounds only reading without making any changes. Make a concrete code change now or explain why no change can be made.'
                  }
                ];
                setToolStatus(undefined);
                continue;
              }
              if (currentState.nonMutatingToolRounds === 6) {
                currentState.apiMessages = [
                  ...currentState.apiMessages,
                  {
                    role: 'user',
                    content:
                      'Reminder: you have been reading files for several rounds. Once you have enough context, proceed with the actual code change using a mutating tool.'
                  }
                ];
                setToolStatus(undefined);
                continue;
              }
            } else {
              currentState.nonMutatingToolRounds = 0;
            }

            // Auto-error-detection: after mutations, wait for Monaco diagnostics and inject errors
            if (
              roundPerformedMutation &&
              (currentState.autoFixRounds ?? 0) < MAX_AUTO_FIX_ROUNDS
            ) {
              await delay(DIAGNOSTIC_SETTLE_MS);
              const errors = getErrorDiagnostics();
              if (errors.length > 0) {
                const errorLines = errors
                  .slice(0, 15)
                  .map(d => `[ERROR] ${d.file}:${d.startLine}:${d.startColumn} - ${d.message}${d.code ? ` (${d.code})` : ''}`)
                  .join('\n');
                currentState.autoFixRounds = (currentState.autoFixRounds ?? 0) + 1;
                currentState.apiMessages = [
                  ...currentState.apiMessages,
                  {
                    role: 'user',
                    content: `The editor detected ${errors.length} error(s) after your changes. Fix them now:\n${errorLines}\n\nRead the affected file(s) if needed and apply corrections with replaceInFile. Do not ignore these errors.`
                  }
                ];
                setToolStatus('Fixing detected errors...');
                continue;
              }
            }

            setToolStatus(undefined);
            continue;
          }

          // If the model only returned reasoning (thinking) but no actual content or tool calls,
          // re-prompt it to continue and actually perform the action.
          if (result.reasoningOnly && !result.toolCalls?.length && !currentState.controller.signal.aborted) {
            currentState.apiMessages = [
              ...currentState.apiMessages,
              { role: 'assistant', content: result.reasoning || '' },
              {
                role: 'user',
                content: 'Continue from your latest reasoning. Execute the action now, do not repeat previous text, and use tool calls when changes are needed.'
              }
            ];
            continue;
          }

          if (result.content) {
            const normalizedResponse = normalizeLoopText(result.content);
            if (
              normalizedResponse &&
              normalizedResponse === currentState.lastNormalizedResponse &&
              !currentState.controller.signal.aborted
            ) {
              currentState.repeatedResponseCount += 1;
              if (currentState.repeatedResponseCount >= 2) {
                currentState.apiMessages = [
                  ...currentState.apiMessages,
                  { role: 'assistant', content: result.content },
                  {
                    role: 'user',
                    content: 'Do not repeat yourself. Continue only with new progress, completed results, or the final answer.'
                  }
                ];
                continue;
              }
            } else {
              currentState.lastNormalizedResponse = normalizedResponse;
              currentState.repeatedResponseCount = 0;
            }

            if (
              settings.toolsEnabled &&
              !currentState.toolProtocolCorrectionSent &&
              containsPseudoToolProtocol(result.content)
            ) {
              currentState.toolProtocolCorrectionSent = true;
              currentState.apiMessages = [
                ...currentState.apiMessages,
                {
                  role: 'user',
                  content: 'Do not print internal tool protocol, analysis tags, channel markers, or pseudo function calls like functions.writeFile(...). Use real tool calls instead.'
                }
              ];
              continue;
            }
          } else if (!result.content && !result.toolCalls?.length && !currentState.controller.signal.aborted) {
            currentState.consecutiveEmptyResponses = (currentState.consecutiveEmptyResponses ?? 0) + 1;
            if (currentState.consecutiveEmptyResponses >= 3) {
              currentState.stopReason = 'Stopped: model returned multiple empty responses.';
              currentState.combinedContent += currentState.combinedContent
                ? '\n\nDas Modell konnte keine Antwort generieren. Bitte versuche es mit einer praeziseren Anfrage erneut.'
                : 'Das Modell konnte keine Antwort generieren. Bitte versuche es mit einer praeziseren Anfrage erneut.';
              break;
            }
            currentState.apiMessages = [
              ...currentState.apiMessages,
              {
                role: 'user',
                content: currentState.toolProtocolCorrectionSent
                  ? 'Please provide your answer now. Summarize what you did and any results.'
                  : 'Your previous response was empty or protocol-only. Respond normally and use real tool calls if needed.'
              }
            ];
            currentState.toolProtocolCorrectionSent = true;
            continue;
          }

          if (result.content) {
            if (
              settings.toolsEnabled &&
              !currentState.performedMutationTool &&
              !currentState.mutationCorrectionSent &&
              claimsFileMutationWithoutTool(result.content)
            ) {
              currentState.mutationCorrectionSent = true;
              currentState.apiMessages = [
                ...currentState.apiMessages,
                {
                  role: 'user',
                  content: 'You have not modified any file yet. If you intend to change files, call the appropriate tool first. Otherwise answer without claiming a file change.'
                }
              ];
              continue;
            }

            if (
              settings.toolsEnabled &&
              userRequestLikelyNeedsTools(initialUserContent, settings.mode) &&
              !currentState.performedMutationTool &&
              !currentState.mutationCorrectionSent &&
              containsCodeBlockThatShouldBeWritten(result.content)
            ) {
              currentState.mutationCorrectionSent = true;
              currentState.apiMessages = [
                ...currentState.apiMessages,
                {
                  role: 'user',
                  content: 'Do not output the file as chat text. Use the correct tool call now and write the file directly.'
                }
              ];
              continue;
            }

            if (
              settings.toolsEnabled &&
              userRequestLikelyNeedsTools(initialUserContent, settings.mode) &&
              !currentState.performedMutationTool &&
              !currentState.mutationCorrectionSent &&
              statesIntentWithoutActing(result.content)
            ) {
              currentState.mutationCorrectionSent = true;
              currentState.apiMessages = [
                ...currentState.apiMessages,
                { role: 'assistant', content: result.content },
                {
                  role: 'user',
                  content: 'Do not describe what you will do. Execute the action now using tool calls.'
                }
              ];
              continue;
            }

            currentState.combinedContent += currentState.combinedContent
              ? `\n\n${result.content}`
              : result.content;
            currentState.apiMessages = [
              ...currentState.apiMessages,
              { role: 'assistant', content: result.content }
            ];
          }

          if (shouldContinue(result)) {
            currentState.apiMessages = [
              ...currentState.apiMessages,
              {
                role: 'user',
                content:
                  'Continue exactly where you left off. Do not repeat completed steps or prior text. Finish the remaining work and then provide the final answer.'
              }
            ];
            continue;
          }

          if (
            userRequestLikelyNeedsTools(initialUserContent, settings.mode) &&
            !currentState.performedMutationTool &&
            !currentState.completionWithoutMutationCorrectionSent
          ) {
            currentState.completionWithoutMutationCorrectionSent = true;
            currentState.apiMessages = [
              ...currentState.apiMessages,
              {
                role: 'user',
                content:
                  'You have not completed the requested file change yet. Do not claim the issue is fixed or resolved. Use a mutating tool now to apply the change, or explicitly state that no safe change was made.'
              }
            ];
            continue;
          }

          currentState.stopReason =
            settings.mode === 'autonomous'
              ? 'Stopped: no further concrete improvements remained.'
              : 'Stopped: plan completed.';
          break;
        }

        const stopReason = currentState.controller.signal.aborted
          ? 'Stopped by user.'
          : currentState.stopReason || 'Stopped: response completed.';
        finalizeAssistantMessage(
          currentState.conversationId,
          currentState.combinedContent,
          currentState.combinedReasoning,
          stopReason,
          currentState.executedTools
        );
        return currentState.combinedContent;
      } catch (error) {
        const aborted = state.controller.signal.aborted;
        const message = error instanceof Error ? error.message : String(error);
        setLastError(aborted ? 'Anfrage abgebrochen.' : message);
        addMessageToConversation(state.conversationId, {
          id: createId(),
          content: aborted ? 'Anfrage abgebrochen.' : `Fehler: ${message}`,
          sender: 'system',
          timestamp: new Date()
        });
        return undefined;
      } finally {
        if (abortControllerRef.current === state.controller) {
          abortControllerRef.current = null;
        }
        setIsCancelling(false);
        setIsThinking(false);
        setToolStatus(undefined);
      }
    },
    [
      addMessageToConversation,
      buildToolCallInfo,
      finalizeAssistantMessage,
      performCompletion,
      pruneApiMessages,
      settings,
      shouldContinue,
      toolCallSupported,
      updateToolMessage
    ]
  );

  const approvePendingToolApproval = useCallback(
    async (id: string) => {
      const pending = pendingToolExecutionRef.current.get(id);
      if (!pending) return;
      pendingToolExecutionRef.current.delete(id);
      setPendingToolApprovals(prev => prev.filter(item => item.id !== id));
      setIsThinking(true);
      setLastError(undefined);

      const toolResults: ToolResult[] = [];
      for (let index = 0; index < pending.toolCalls.length; index += 1) {
        const tc = pending.toolCalls[index];
        setToolStatus(summarizeToolCall(tc));
        updateToolMessage(pending.conversationId, pending.messageId, current =>
          current.map((entry, entryIndex) =>
            entryIndex === index ? { ...entry, status: 'running' } : entry
          )
        );
        const toolResult = await executeToolCall(tc, projectPathRef.current, {
          signal: pending.controller.signal,
          requestId: `${pending.requestId}:${tc.id}`
        });
        toolResults.push(toolResult);
        updateToolMessage(pending.conversationId, pending.messageId, current =>
          current.map((entry, entryIndex) =>
            entryIndex === index
              ? {
                  ...entry,
                  status: toolResult.content.startsWith('Error') ? 'error' : 'done',
                  result: toolResult.content.substring(0, 500)
                }
              : entry
          )
        );
      }

      updateToolMessage(pending.conversationId, pending.messageId, current =>
        current.map((entry, entryIndex) => {
          const toolResult = toolResults[entryIndex];
          if (!toolResult) return entry;
          return {
            ...entry,
            status: toolResult.content.startsWith('Error') ? 'error' : 'done',
            result: entry.result ?? toolResult.content.substring(0, 500)
          };
        })
      );

      const replaceSearchMiss = findReplaceSearchMiss(pending.toolCalls, toolResults);

      await runAgentLoop(
        {
          ...pending,
          apiMessages: [
            ...pending.apiMessages,
            ...toolResults.map(tr => ({
              role: 'tool',
              tool_call_id: tr.tool_call_id,
              content: tr.content
            })),
            ...(replaceSearchMiss
              ? [
                  {
                    role: 'user',
                    content: `The previous replaceInFile failed because the search text no longer matched in ${replaceSearchMiss.resolvedPath || replaceSearchMiss.failedPath || 'the file'}. Read the file again first, inspect the current contents, and then apply a smaller replacement against the latest text. Do not repeat the same replaceInFile call unchanged.`
                  }
                ]
              : [])
          ],
          performedMutationTool:
            pending.performedMutationTool ||
            pending.toolCalls.some(
              (tc, index) =>
                MUTATING_TOOL_NAMES.has(tc.function.name) &&
                !toolResults[index]?.content?.startsWith('Error')
            ),
          executedTools: [
            ...pending.executedTools,
            ...pending.toolCalls.map((tc, index) => ({
              name: tc.function.name,
              summary: summarizeToolCall(tc),
              result: toolResults[index]?.content || 'No tool result returned.',
              status: toolResults[index]?.content?.startsWith('Error') ? 'error' as const : 'done' as const
            }))
          ],
          replaceReReadRequiredPaths: (() => {
            const next = [...pending.replaceReReadRequiredPaths];
            pending.toolCalls.forEach((tc, index) => {
              const args = safeJsonParse(tc.function.arguments || '{}');
              if (
                tc.function.name === 'readFile' &&
                !toolResults[index]?.content?.startsWith('Error') &&
                (args.startLine != null || args.endLine != null)
              ) {
                const readPath = normalizeTrackedPath(String(args.path || ''));
                const idx = next.indexOf(readPath);
                if (idx >= 0) next.splice(idx, 1);
              }
            });
            const replaceSearchMissPath = normalizeTrackedPath(
              replaceSearchMiss?.resolvedPath || replaceSearchMiss?.failedPath || ''
            );
            if (replaceSearchMissPath && !next.includes(replaceSearchMissPath)) {
              next.push(replaceSearchMissPath);
            }
            return next;
          })(),
          nonMutatingToolRounds:
            pending.toolCalls.some(
              (tc, index) =>
                MUTATING_TOOL_NAMES.has(tc.function.name) &&
                !toolResults[index]?.content?.startsWith('Error')
            )
              ? 0
              : pending.nonMutatingToolRounds + 1,
          completionWithoutMutationCorrectionSent: pending.completionWithoutMutationCorrectionSent,
          autoFixRounds: pending.autoFixRounds ?? 0,
          consecutiveEmptyResponses: 0
        },
        ''
      );
    },
    [runAgentLoop, updateToolMessage]
  );

  const rejectPendingToolApproval = useCallback(
    async (id: string) => {
      const pending = pendingToolExecutionRef.current.get(id);
      if (!pending) return;
      pendingToolExecutionRef.current.delete(id);
      setPendingToolApprovals(prev => prev.filter(item => item.id !== id));
      setIsThinking(true);

      const denialResults = pending.toolCalls.map((tc, index) => {
        updateToolMessage(pending.conversationId, pending.messageId, current =>
          current.map((entry, entryIndex) =>
            entryIndex === index
              ? { ...entry, status: 'error', result: 'Rejected by user.' }
              : entry
          )
        );
        return {
          tool_call_id: tc.id,
          role: 'tool' as const,
          content: `Tool call rejected by the user: ${tc.function.name}`
        };
      });

      await runAgentLoop(
        {
          ...pending,
          apiMessages: [
            ...pending.apiMessages,
            ...denialResults.map(tr => ({
              role: 'tool',
              tool_call_id: tr.tool_call_id,
              content: tr.content
            }))
          ],
          executedTools: [
            ...pending.executedTools,
            ...pending.toolCalls.map(tc => ({
              name: tc.function.name,
              summary: summarizeToolCall(tc),
              result: 'Tool call rejected by the user.',
              status: 'error' as const
            }))
          ],
          replaceReReadRequiredPaths: pending.replaceReReadRequiredPaths,
          nonMutatingToolRounds: pending.nonMutatingToolRounds,
          completionWithoutMutationCorrectionSent: pending.completionWithoutMutationCorrectionSent,
          autoFixRounds: pending.autoFixRounds ?? 0,
          consecutiveEmptyResponses: 0
        },
        ''
      );
    },
    [runAgentLoop, updateToolMessage]
  );

  const sendMessage = useCallback(
    async (content: string, options?: SendMessageOptions) => {
      const displayContent = (options?.displayContent ?? content).trim();
      if (!displayContent || !settings.model || isThinking) {
        return undefined;
      }

      const activeConversation = getActiveConversation();
      const conversationId = activeConversation?.id ?? conversations[0].id;
      const rawContent = options?.actualContent ?? displayContent;
      const sender = options?.sender ?? 'user';

      const userMessage: Message = {
        id: createId(),
        content: displayContent,
        rawContent,
        sender,
        timestamp: new Date(),
        images: options?.images
      };

      const currentMessages = activeConversation?.messages ?? [];
      const updatedMessages = [...currentMessages, userMessage];

      setConversations(prev =>
        prev.map(conv => {
          if (conv.id !== conversationId) return conv;
          const updatedTitle =
            conv.messages.length === 0 && sender === 'user'
              ? displayContent.slice(0, 40) || conv.title
              : conv.title;
          return { ...conv, title: updatedTitle, messages: updatedMessages };
        })
      );

      setIsThinking(true);
      setIsCancelling(false);
      setLastError(undefined);
      setToolStatus(undefined);

      const messagePayload = mapMessages(updatedMessages);
      const systemMessages = await buildSystemMessages(options?.injectSystemPrompt);
      const controller = new AbortController();
      abortControllerRef.current = controller;

      return runAgentLoop(
        {
          conversationId,
          apiMessages: [...systemMessages, ...messagePayload],
          controller,
          requestId: createId(),
          combinedContent: '',
          combinedReasoning: [],
          stopReason: undefined,
          loops: 0,
          performedMutationTool: false,
          mutationCorrectionSent: false,
          toolProtocolCorrectionSent: false,
          repeatedResponseCount: 0,
          executedTools: [],
          replaceReReadRequiredPaths: [],
          nonMutatingToolRounds: 0,
          completionWithoutMutationCorrectionSent: false,
          autoFixRounds: 0,
          consecutiveEmptyResponses: 0
        },
        rawContent
      );
    },
    [
      buildSystemMessages,
      conversations,
      getActiveConversation,
      isThinking,
      mapMessages,
      runAgentLoop,
      settings.model
    ]
  );

  const visionSupported = useMemo(() => {
    if (!settings.model) return false;
    const lower = settings.model.toLowerCase();
    return /vision|gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|gemini|claude|pixtral|llava|cogvlm|qwen2?-vl|internvl|minicpm/.test(lower);
  }, [settings.model]);

  const value = useMemo<AIContextType>(
    () => ({
      conversations,
      activeConversationId,
      setActiveConversation: setActiveConversationId,
      startNewConversation,
      sendMessage,
      requestCompletion,
      cancelRequest,
      removeConversation,
      clearMessages,
      isThinking,
      isCancelling,
      settings,
      updateSettings,
      models,
      refreshModels,
      isFetchingModels,
      lastError,
      connectionStatus,
      toolStatus,
      toolCallSupported,
      checkToolCallSupport,
      visionSupported,
      pendingToolApprovals,
      approvePendingToolApproval,
      rejectPendingToolApproval
    }),
    [
      conversations,
      activeConversationId,
      startNewConversation,
      sendMessage,
      requestCompletion,
      cancelRequest,
      removeConversation,
      clearMessages,
      isThinking,
      isCancelling,
      settings,
      updateSettings,
      models,
      refreshModels,
      isFetchingModels,
      lastError,
      connectionStatus,
      toolStatus,
      toolCallSupported,
      checkToolCallSupport,
      visionSupported,
      pendingToolApprovals,
      approvePendingToolApproval,
      rejectPendingToolApproval
    ]
  );

  return <AIContext.Provider value={value}>{children}</AIContext.Provider>;
};

export const useAI = () => {
  const context = useContext(AIContext);
  if (context === undefined) {
    throw new Error('useAI must be used within an AIProvider');
  }
  return context;
};
