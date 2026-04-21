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
import {
  AI_TOOLS,
  executeToolCall,
  ToolCall,
  ToolResult,
  EditorDiagnostic,
  setCurrentDiagnostics,
  getErrorDiagnostics,
  resolvePath
} from '../services/AIToolService';
import { isAbsoluteFilePath, joinPathPreserveAbsolute } from '../utils/pathUtils';
import WhisperAutoStartService, { WhisperAutoStartState } from '../services/WhisperAutoStartService';
import { mapAiConnectionError, mapRateLimitError } from '../utils/aiConnectionErrors';

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

export type AIProviderId = 'ollama' | 'lmstudio' | 'custom';

export interface AISettings {
  provider: AIProviderId;
  baseUrl: string;
  model: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  apiKey?: string;
  toolsEnabled: boolean;
  mode: 'qa' | 'coder' | 'autonomous';
  yoloMode: boolean;
  speechEnabled: boolean;
  speechUseWhisper: boolean;
  speechWhisperModel: string;
  speechMicDeviceId: string;
  speechAlwaysReady: boolean;
  subAgentsEnabled: boolean;
  /** User-defined instructions prepended to system context for every request. */
  globalSystemPrompt: string;
  /** When true, `globalSystemPrompt` replaces `base-prompt.md` instead of stacking after it. */
  replaceBasePrompt: boolean;
  /** When true, assistant replies stream token-by-token in the chat (OpenAI-compatible SSE). */
  streamChat: boolean;
}

export type SubAgentStatus = 'planning' | 'running' | 'done' | 'error';

export interface SubAgentInfo {
  id: string;
  task: string;
  status: SubAgentStatus;
  progress?: string;
  result?: string;
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
  useTools?: boolean;
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
  /** Present when Electron reported install detection; both true = show Ollama/LM Studio switch. */
  localBackendInstalls: { ollama: boolean; lm: boolean } | null;
  refreshLocalBackendInstalls: () => Promise<void>;
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
  subAgents: SubAgentInfo[];
  spawnSubAgents: (parentTask: string) => Promise<void>;
  clearSubAgents: () => void;
  contextUsagePercent: number;
  lastCompactionSaved?: number;
  activeFilePath?: string;
  whisperAutoStartState: WhisperAutoStartState;
}

const AIContext = createContext<AIContextType | undefined>(undefined);

const SETTINGS_KEY = 'lseditor.ai.settings';

/** Default OpenAI-compatible API base URLs (no trailing slash). */
export const DEFAULT_PROVIDER_BASE_URL: Record<AIProviderId, string> = {
  ollama: 'http://localhost:11434',
  lmstudio: 'http://localhost:1234',
  custom: 'http://localhost:1234'
};

const defaultSettings: AISettings = {
  provider: 'lmstudio',
  baseUrl: DEFAULT_PROVIDER_BASE_URL.lmstudio,
  model: '',
  temperature: 0.7,
  topP: 1,
  maxTokens: 4096,
  toolsEnabled: true,
  mode: 'coder',
  yoloMode: false,
  speechEnabled: false,
  speechUseWhisper: false,
  speechWhisperModel: '',
  speechMicDeviceId: '',
  speechAlwaysReady: false,
  subAgentsEnabled: false,
  globalSystemPrompt: '',
  replaceBasePrompt: false,
  streamChat: true
};

const MAX_AGENT_LOOPS = 12;
const COMPLETION_REQUEST_TIMEOUT_MS = 120000;
const COMPLETION_MAX_RETRIES = 4;
const DIAGNOSTIC_SETTLE_MS = 1200;
const MAX_AUTO_FIX_ROUNDS = 3;

/** Fictitious tool used only for API handshake; not executed in AIToolService. */
const HANDSHAKE_PROBE_TOOL = {
  type: 'function' as const,
  function: {
    name: '__ls_handshake_probe',
    description: 'Internal capability probe only. Call with status ok.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ok'], description: 'Acknowledgement' }
      },
      required: ['status']
    }
  }
};

// File extensions that Monaco can validate natively (TS/JS)
const MONACO_VALIDATED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);

/**
 * Build a syntax-check command for languages Monaco cannot validate.
 * Returns null if no checker is known for the extension.
 */
const buildSyntaxCheckCommand = (filePath: string): string | null => {
  const ext = (filePath.match(/\.[^.\\/:]+$/) || [''])[0].toLowerCase();
  // Escape for POSIX double-quoted shell strings: \, ", $, `
  const dq = filePath
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');
  // Escape for PowerShell single-quoted strings: double single-quotes
  const ps1 = filePath.replace(/'/g, "''");
  switch (ext) {
    case '.py':
      return `python -c "import py_compile; py_compile.compile(r'${dq}', doraise=True)"`;
    case '.json':
      return `python -c "import json; json.load(open(r'${dq}', encoding='utf-8'))"`;
    case '.yaml':
    case '.yml':
      return `python -c "import yaml; yaml.safe_load(open(r'${dq}', encoding='utf-8'))"`;
    case '.c':
    case '.h':
      return `gcc -fsyntax-only "${dq}"`;
    case '.cpp':
    case '.cc':
    case '.cxx':
    case '.hpp':
      return `g++ -fsyntax-only "${dq}"`;
    case '.java':
      return `javac -d /dev/null "${dq}" 2>&1 || javac -d NUL "${dq}"`;
    case '.rs':
      return `rustc --edition 2021 --crate-type lib "${dq}" --error-format short 2>&1 | head -20`;
    case '.go':
      return `go vet "${dq}"`;
    case '.rb':
      return `ruby -c "${dq}"`;
    case '.php':
      return `php -l "${dq}"`;
    case '.sh':
    case '.bash':
      return `bash -n "${dq}"`;
    case '.ps1':
      return `powershell -NoProfile -Command "try { [System.Management.Automation.Language.Parser]::ParseFile('${ps1}', [ref]$null, [ref]$null) | Out-Null; 'OK' } catch { $_.Exception.Message }"`;
    default:
      return null;
  }
};

/**
 * Run a syntax check command and return errors (if any), or null if clean/unavailable.
 */
const runSyntaxCheck = async (
  filePath: string,
  signal?: AbortSignal
): Promise<string | null> => {
  const cmd = buildSyntaxCheckCommand(filePath);
  if (!cmd) return null;
  const renderer = (window as any).electron?.ipcRenderer;
  if (!renderer) return null;
  try {
    const result = await renderer.invoke('exec', cmd, {
      cwd: filePath.replace(/[\\/][^\\/]+$/, ''),
      requestId: `syntax-check-${Date.now()}`
    });
    if (!result || typeof result !== 'object') return null;
    if (result.code === 0 || result.code === undefined) return null;
    const output = [result.stderr, result.stdout, result.error].filter(Boolean).join('\n').trim();
    return output ? output.slice(0, 2000) : null;
  } catch {
    return null;
  }
};

const DEFAULT_BASE_PROMPT = `You are LS AI, the integrated assistant for the LS Editor.
You have tools to read, write, search, and run files and commands in the workspace.

Core rules:
- ALWAYS use real tool calls to change files. Do NOT output code as chat-only text.
- Read files with readFile BEFORE you change them. Read large files in chunks (startLine/endLine).
- Prefer replaceInFile for targeted changes. Use writeFile only for new files.
- For very large edits, split work across multiple tool calls if it keeps the task clearer.
- After EVERY code change: call getDiagnostics. Fix errors immediately; do not ignore them.
- If replaceInFile fails: re-read the file, adjust the search text, and try again.
- Never output internal thoughts, analysis tags, or pseudo-tool syntax.
- End completed tasks with: ## Result, ## Approach, ## Validation`;

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

function serializeConversationsForStore(conversations: Conversation[], activeConversationId: string) {
  return {
    conversations: conversations.map(c => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      messages: c.messages.map(m => ({
        ...m,
        timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : String(m.timestamp)
      }))
    })),
    activeConversationId
  };
}

function deserializeConversationsFromStore(
  data: unknown
): { conversations: Conversation[]; activeConversationId: string } | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as { conversations?: unknown; activeConversationId?: unknown };
  if (!Array.isArray(o.conversations) || typeof o.activeConversationId !== 'string') return null;
  const conversations: Conversation[] = [];
  for (const raw of o.conversations) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string') continue;
    const messages: Message[] = [];
    if (Array.isArray(r.messages)) {
      for (const m of r.messages) {
        if (!m || typeof m !== 'object') continue;
        const msg = m as Record<string, unknown>;
        messages.push({
          id: typeof msg.id === 'string' ? msg.id : createId(),
          content: typeof msg.content === 'string' ? msg.content : '',
          sender: (msg.sender as ChatSender) || 'user',
          timestamp: new Date(typeof msg.timestamp === 'string' ? msg.timestamp : Date.now()),
          rawContent: typeof msg.rawContent === 'string' ? msg.rawContent : undefined,
          reasoning: typeof msg.reasoning === 'string' ? msg.reasoning : undefined,
          toolCalls: Array.isArray(msg.toolCalls) ? (msg.toolCalls as ToolCallInfo[]) : undefined,
          images: Array.isArray(msg.images) ? (msg.images as ImageAttachment[]) : undefined
        });
      }
    }
    conversations.push({
      id: r.id,
      title: typeof r.title === 'string' ? r.title : 'Chat',
      createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
      messages
    });
  }
  if (!conversations.length) return null;
  return { conversations, activeConversationId: o.activeConversationId };
}

const sanitizeBaseUrl = (url: string) => {
  if (!url) return DEFAULT_PROVIDER_BASE_URL.lmstudio;
  // Only strip trailing slash — preserve the URL exactly as the user typed it.
  return url.trim().replace(/\/$/, '');
};

/**
 * Build an API endpoint URL, stripping a trailing /v1 from the base before
 * appending the path — so both "https://api.example.com" and
 * "https://api.example.com/v1" result in the correct final URL.
 */
const buildApiUrl = (baseUrl: string, path: string) => {
  const base = baseUrl.replace(/\/v1$/, '');
  return `${base}${path}`;
};

/** Combines rate-limit and connection-error mapping into a single call. */
const mapAnyAiError = (error: unknown): string | null =>
  mapRateLimitError(error) ?? mapAiConnectionError(error);

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

const inferVisionSupportFromModel = (modelId: string, modelData?: any): boolean => {
  const lower = modelId.toLowerCase();
  const visionFlags = [
    modelData?.supports_vision,
    modelData?.vision,
    modelData?.capabilities?.vision,
    modelData?.supportsVision,
    Array.isArray(modelData?.modalities)
      ? modelData.modalities.some((m: string) => /image|vision|multimodal/i.test(String(m)))
      : undefined
  ];
  for (const flag of visionFlags) {
    const resolved = coerceBoolean(flag);
    if (resolved === true) return true;
  }
  if (modelData && typeof modelData === 'object') {
    const dump = JSON.stringify(modelData).toLowerCase();
    if (dump.includes('vision') && (dump.includes('true') || dump.includes('"vision"'))) {
      return true;
    }
  }
  return /vision|gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|gemini|claude|pixtral|llava|cogvlm|qwen2?-vl|internvl|minicpm|moondream|bakllava|llama-3\.2-vision|multimodal|vl-|llama3\.2-vision|idefics|fuyu|smolvlm/.test(
    lower
  );
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

const READ_ONLY_TOOL_NAMES = new Set([
  'findFile',
  'readFile',
  'listFiles',
  'getFileTree',
  'searchFiles',
  'searchWorkspace',
  'getDiagnostics'
]);
const MUTATING_TOOL_NAMES = new Set([
  'writeFile',
  'appendToFile',
  'replaceInFile',
  'createDirectory',
  'deleteFile',
  'renameFile',
  'copyFile'
]);
const EXECUTION_TOOL_NAMES = new Set(['runCommand']);

const toolNeedsApproval = (toolName: string) =>
  MUTATING_TOOL_NAMES.has(toolName) || EXECUTION_TOOL_NAMES.has(toolName);

const getToolsForMode = (settings: AISettings) => {
  if (!settings.subAgentsEnabled) {
    return AI_TOOLS.filter(tool => tool.function.name !== 'spawnSubAgent');
  }
  return AI_TOOLS;
};

const createRuntimeModePrompt = (settings: AISettings) => {
  const toolGuidance = [
    'Tool workflow: readFile (in chunks) -> edit with replaceInFile -> getDiagnostics -> fix errors -> repeat until clean.',
    'Use getFileTree for a compact overview of folders and files; use searchWorkspace to find by name or content; use findFile when the exact path is unknown.',
    'For new larger files: create a small scaffold with writeFile, then extend with appendToFile in chunks.',
    'After code changes, ALWAYS call getDiagnostics. If errors found, read affected lines and fix with replaceInFile.',
    'For substantial tasks, use a markdown checklist (- [ ] / - [x]) and update it as you progress.',
    'End completed tasks with: ## Result, ## Approach, ## Validation.'
  ].join('\n');

  if (settings.mode === 'qa') {
    return [
      'Mode: QA. Prefer concise explanations and reading the codebase before changing anything.',
      'When the user asks you to implement or edit files, use tools. File mutations and shell commands require explicit user approval in the UI unless YOLO execution mode is enabled in settings.',
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
      case 'getFileTree':
        return `Tree ${args.path || 'directory'}`;
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
      case 'copyFile':
        return `Copying ${args.sourcePath || ''} -> ${args.destinationPath || ''}`;
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
  // 429 = rate limit — do NOT retry automatically; surface the error immediately
  if ([408, 409, 425, 500, 502, 503, 504].includes(status)) return true;
  return /(timeout|timed out|network|fetch failed|econnreset|econnrefused|socket hang up|temporar|overloaded|aborted|broken pipe|connection reset|unexpected end|failed to fetch|load failed|server error|internal error|service unavailable)/i.test(
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

/** Parse OpenAI-compatible chat completion SSE (data: JSON lines, optional [DONE]). */
async function consumeSseChatStream(
  response: Response,
  onDelta: (acc: { content: string; reasoning: string }) => void,
  signal: AbortSignal
): Promise<{
  content: string;
  reasoning: string;
  toolCallParts: Map<number, { id?: string; name?: string; arguments: string }>;
  finishReason?: string;
  usage?: { completion_tokens?: number; total_tokens?: number };
}> {
  let content = '';
  let reasoning = '';
  const toolCallParts = new Map<number, { id?: string; name?: string; arguments: string }>();
  let finishReason: string | undefined;
  let usage: { completion_tokens?: number; total_tokens?: number } | undefined;

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Streaming response has no body');
  }
  const decoder = new TextDecoder();
  let buffer = '';

  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let lineEnd: number;
    while ((lineEnd = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd + 1);
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trimStart();
      if (data === '[DONE]') continue;

      let json: any;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }

      if (json.usage) usage = json.usage;
      const choice = json.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;

      const delta = choice.delta;
      if (!delta) continue;

      if (delta.content !== undefined && delta.content !== null) {
        content += typeof delta.content === 'string' ? delta.content : '';
      }
      if (delta.reasoning_content) {
        reasoning += typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '';
      }
      if (delta.reasoning && typeof delta.reasoning === 'string') {
        reasoning += delta.reasoning;
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = typeof tc.index === 'number' ? tc.index : 0;
          if (!toolCallParts.has(idx)) {
            toolCallParts.set(idx, { arguments: '' });
          }
          const acc = toolCallParts.get(idx)!;
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) acc.arguments += tc.function.arguments;
        }
      }
      if (delta.function_call) {
        if (!toolCallParts.has(0)) {
          toolCallParts.set(0, { arguments: '' });
        }
        const acc = toolCallParts.get(0)!;
        if (delta.function_call?.name) acc.name = delta.function_call.name;
        if (delta.function_call?.arguments) acc.arguments += delta.function_call.arguments;
      }

      onDelta({ content, reasoning });
    }
  }

  return { content, reasoning, toolCallParts, finishReason, usage };
}

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
  const requiredHeadings = ['## Result', '## Approach', '## Validation'];
  if (requiredHeadings.every(heading => sanitizedContent.includes(heading))) {
    return combinedContent;
  }

  const successfulTools = executedTools.filter(tool => tool.status === 'done');
  const failedTools = executedTools.filter(tool => tool.status === 'error');
  const resultLine = sanitizedContent
    ? sanitizedContent
    : successfulTools.length
      ? 'The requested task was processed.'
      : 'The request was answered without workspace actions.';

  const approachLines = successfulTools.length
    ? successfulTools.map(tool => `- ${tool.summary}: ${tool.result.replace(/\s+/g, ' ').trim().slice(0, 220)}`)
    : ['- No tool calls were required for this response.'];

  const validationLines = [
    ...executedTools
      .filter(tool => tool.name === 'runCommand')
      .map(tool => `- Command run: ${tool.result.replace(/\s+/g, ' ').trim().slice(0, 220)}`),
    ...failedTools.map(tool => `- Open point: ${tool.summary} -> ${tool.result.replace(/\s+/g, ' ').trim().slice(0, 220)}`),
    ...(stopReason ? [`- Completion status: ${stopReason}`] : [])
  ];

  if (!validationLines.length) {
    validationLines.push('- No separate test or build step was run for this request.');
  }

  const summaryBlock = [
    '## Result',
    resultLine,
    '',
    '## Approach',
    ...approachLines,
    '',
    '## Validation',
    ...validationLines
  ].join('\n');

  return sanitizedContent ? `${sanitizedContent}\n\n${summaryBlock}` : summaryBlock;
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

const userRequestLikelyNeedsTools = (content: string, _mode: AISettings['mode']) => {
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

/** Module-level cache for base-prompt.md — never changes during a session. */
let basePromptCache: string | null = null;

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

const normalizeLegacyFunctionCall = (fc: any): ToolCall[] | undefined => {
  const name = fc?.name;
  if (!name || typeof name !== 'string') return undefined;
  const argsRaw = fc?.arguments;
  return [
    {
      id: createId(),
      type: 'function',
      function: {
        name,
        arguments: typeof argsRaw === 'string' && argsRaw.trim() ? argsRaw : '{}'
      }
    }
  ];
};

interface AgentLoopState {
  conversationId: string;
  apiMessages: any[];
  controller: AbortController;
  requestId: string;
  combinedContent: string;
  combinedReasoning: string[];
  /** Streaming placeholder from the previous turn; removed on the next turn if not committed. */
  pendingStreamMessageId?: string;
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
  /** Fingerprint of last assistant tool_calls batch (anti-loop). */
  lastToolCallsFingerprint?: string;
  /** How many consecutive completions repeated the same tool_calls fingerprint. */
  identicalToolCallsRounds?: number;
}

interface PendingToolExecutionState extends AgentLoopState {
  id: string;
  messageId: string;
  toolCalls: ToolCall[];
}

export const AIProvider: React.FC<{ children: React.ReactNode; projectPath?: string; activeFilePath?: string }> = ({ children, projectPath, activeFilePath }) => {
  const [settings, setSettings] = useState<AISettings>(() => {
    if (typeof window === 'undefined') return defaultSettings;
    try {
      const stored = window.localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<AISettings>;
        const provider: AIProviderId =
          parsed.provider === 'ollama' || parsed.provider === 'lmstudio' || parsed.provider === 'custom'
            ? parsed.provider
            : 'lmstudio';
        return {
          ...defaultSettings,
          ...parsed,
          provider,
          baseUrl: sanitizeBaseUrl(
            parsed.baseUrl ||
              (provider !== 'custom' ? DEFAULT_PROVIDER_BASE_URL[provider] : defaultSettings.baseUrl)
          ),
          streamChat: parsed.streamChat !== false
        };
      }
    } catch (error) {
      console.warn('Failed to parse stored AI settings', error);
    }
    return defaultSettings;
  });

  const [conversations, setConversations] = useState<Conversation[]>([createConversation(1)]);
  const [activeConversationId, setActiveConversationId] = useState(conversations[0].id);
  const chatPersistReadyRef = useRef(false);
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
  const [localBackendInstalls, setLocalBackendInstalls] = useState<{
    ollama: boolean;
    lm: boolean;
  } | null>(null);

  const refreshLocalBackendInstalls = useCallback(async () => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) {
      setLocalBackendInstalls(null);
      return;
    }
    try {
      const res = (await ipc.invoke('ai:get-local-backends-installed')) as {
        ollamaInstalled?: boolean;
        lmStudioInstalled?: boolean;
      };
      setLocalBackendInstalls({
        ollama: Boolean(res?.ollamaInstalled),
        lm: Boolean(res?.lmStudioInstalled)
      });
    } catch {
      setLocalBackendInstalls(null);
    }
  }, []);

  useEffect(() => {
    void refreshLocalBackendInstalls();
  }, [refreshLocalBackendInstalls]);

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

      if (toolCall.function.name === 'appendToFile') {
        const absolutePath = resolveToolTargetPath(targetPath, projectPathRef.current);
        let originalContent = '';
        try {
          const diskContent = await renderer.invoke('fs:readFile', absolutePath);
          if (typeof diskContent === 'string') originalContent = diskContent;
        } catch {
          return undefined;
        }
        const appendContent = typeof args.content === 'string' ? args.content : '';
        if (!appendContent) return undefined;
        return {
          kind: 'file',
          path: targetPath,
          action: 'update',
          originalContent,
          newContent: originalContent + appendContent
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
    if (basePromptCache !== null) {
      basePromptRef.current = basePromptCache;
      return basePromptCache;
    }
    try {
      if (window.electron?.ipcRenderer) {
        const content = await window.electron.ipcRenderer.invoke('ai:getBasePrompt');
        if (typeof content === 'string' && content.trim().length > 0) {
          basePromptCache = content.trim();
          basePromptRef.current = basePromptCache;
          return basePromptRef.current;
        }
      }
    } catch (error) {
      console.warn('Failed to load base prompt, falling back to default.', error);
    }
    basePromptCache = DEFAULT_BASE_PROMPT;
    basePromptRef.current = DEFAULT_BASE_PROMPT;
    return basePromptRef.current;
  }, []);

  useEffect(() => {
    loadBasePrompt();
  }, [loadBasePrompt]);

  /** Prefer electron-store (main) over localStorage when available */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ipc = window.electron?.ipcRenderer;
        if (!ipc) return;
        const raw = await ipc.invoke('ai:load-settings');
        if (cancelled || typeof raw !== 'string' || !raw.trim()) return;
        const parsed = JSON.parse(raw) as Partial<AISettings>;
        const provider: AIProviderId | undefined =
          parsed.provider === 'ollama' || parsed.provider === 'lmstudio' || parsed.provider === 'custom'
            ? parsed.provider
            : undefined;
        setSettings(prev => ({
          ...prev,
          ...parsed,
          ...(provider ? { provider } : {}),
          // For custom provider: keep whatever baseUrl was saved; never fall back to a
          // local default. For local providers: use detected default if nothing was saved.
          baseUrl: sanitizeBaseUrl(
            parsed.baseUrl ||
              (provider && provider !== 'custom' ? DEFAULT_PROVIDER_BASE_URL[provider] : prev.baseUrl)
          )
        }));
      } catch (e) {
        console.warn('Failed to load AI settings from disk', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ipc = window.electron?.ipcRenderer;
        if (!ipc) {
          chatPersistReadyRef.current = true;
          return;
        }
        const raw = await ipc.invoke('ai:load-chat-state');
        if (cancelled) return;
        const restored = deserializeConversationsFromStore(raw);
        if (restored && restored.conversations.length) {
          const activeOk = restored.conversations.some(c => c.id === restored.activeConversationId);
          setConversations(restored.conversations);
          setActiveConversationId(activeOk ? restored.activeConversationId : restored.conversations[0].id);
        }
      } catch (e) {
        console.warn('Failed to load chat history', e);
      } finally {
        if (!cancelled) {
          chatPersistReadyRef.current = true;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!chatPersistReadyRef.current) return;
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const timer = window.setTimeout(() => {
      void ipc
        .invoke('ai:save-chat-state', serializeConversationsForStore(conversations, activeConversationId))
        .catch(() => {});
    }, 500);
    return () => window.clearTimeout(timer);
  }, [conversations, activeConversationId]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    const t = window.setTimeout(() => {
      void ipc.invoke('ai:save-settings', JSON.stringify(settings)).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(t);
  }, [settings]);

  const updateSettings = useCallback((patch: Partial<AISettings>) => {
    setSettings(prev => {
      const next: AISettings = { ...prev, ...patch };
      if (
        patch.provider != null &&
        patch.provider !== prev.provider &&
        patch.baseUrl === undefined &&
        patch.provider !== 'custom'
      ) {
        next.baseUrl = sanitizeBaseUrl(DEFAULT_PROVIDER_BASE_URL[patch.provider]);
      } else if (patch.baseUrl != null) {
        next.baseUrl = sanitizeBaseUrl(patch.baseUrl);
      } else {
        next.baseUrl = sanitizeBaseUrl(prev.baseUrl);
      }
      return next;
    });
  }, []);

  const refreshModels = useCallback(async () => {
    let baseUrl = sanitizeBaseUrl(settings.baseUrl);
    if (settings.provider === 'ollama' || settings.provider === 'lmstudio') {
      const ipc = window.electron?.ipcRenderer;
      if (ipc) {
        try {
          const res = (await ipc.invoke(
            'ai:resolve-local-provider-base-url',
            settings.provider
          )) as {
            baseUrl?: string | null;
          };
          if (res?.baseUrl) {
            const detected = sanitizeBaseUrl(res.baseUrl);
            if (detected !== baseUrl) {
              baseUrl = detected;
              setSettings(prev => {
                if (prev.provider !== settings.provider) return prev;
                if (sanitizeBaseUrl(prev.baseUrl) === detected) return prev;
                return { ...prev, baseUrl: detected };
              });
            }
          }
        } catch {
          // keep stored baseUrl
        }
      }
    }
    setIsFetchingModels(true);
    setConnectionStatus('connecting');

    try {
      const ipcRenderer = window.electron?.ipcRenderer;

      // LM Studio: list models in the main process. Renderer `fetch` often fails on https://127.0.0.1
      // (self-signed TLS). Ollama is usually plain HTTP so fetch works.
      if (settings.provider === 'lmstudio' && ipcRenderer) {
        try {
          const ipcList = (await ipcRenderer.invoke('ai:list-local-models', 'lmstudio')) as {
            models?: string[];
            baseUrl?: string | null;
            error?: string;
          };
          if (ipcList?.baseUrl) {
            const detected = sanitizeBaseUrl(ipcList.baseUrl);
            setSettings(prev => {
              if (prev.provider !== 'lmstudio') return prev;
              if (sanitizeBaseUrl(prev.baseUrl) === detected) return prev;
              return { ...prev, baseUrl: detected };
            });
          }
          if (ipcList?.models && ipcList.models.length > 0) {
            modelMetadataRef.current = new Map();
            setModels(ipcList.models);
            setConnectionStatus('ready');
            setLastError(undefined);
            setToolCallSupported(prev => (settings.model ? prev : 'unknown'));
            setSettings(prev => {
              if (prev.provider !== 'lmstudio') return prev;
              if (prev.model && ipcList.models!.includes(prev.model)) return prev;
              return { ...prev, model: ipcList.models![0]! };
            });
            return;
          }
          if (ipcList?.baseUrl && (!ipcList.models || ipcList.models.length === 0)) {
            setModels([]);
            setConnectionStatus('error');
            setLastError(
              ipcList.error ||
                'LM Studio is running but returned no models. Load a model in LM Studio, then click Refresh.'
            );
            setToolCallSupported('unknown');
            return;
          }
        } catch {
          // fall through to fetch-based fallback
        }
      }

      const endpoints = [buildApiUrl(baseUrl, '/v1/models'), buildApiUrl(baseUrl, '/models')];
      if (settings.provider === 'ollama') {
        endpoints.push(buildApiUrl(baseUrl, '/api/tags'));
      }
      let fetched: string[] = [];
      let fetchedMetadata = new Map<string, any>();
      let lastErrorMessage = '';

      const fetchHeaders: Record<string, string> = {};
      if (settings.apiKey) {
        fetchHeaders['Authorization'] = `Bearer ${settings.apiKey}`;
      }

      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint, { headers: fetchHeaders });
          if (!response.ok) {
            if (response.status === 429) {
              // Rate limit on models endpoint — stop trying, surface a friendly message
              throw new Error('rate_limit_models');
            }
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
        throw new Error(lastErrorMessage || 'No models found');
      }
      modelMetadataRef.current = fetchedMetadata;

      setModels(fetched);
      setConnectionStatus('ready');
      setLastError(undefined);
      setToolCallSupported(prev => (settings.model ? prev : 'unknown'));

      setSettings(prev => {
        // For custom provider the user types the model name manually — never auto-override it.
        if (prev.provider === 'custom') return prev;
        if (prev.model && fetched.includes(prev.model)) return prev;
        return { ...prev, model: fetched[0] ?? '' };
      });
    } catch (error) {
      const friendly = mapAnyAiError(error);
      const message = friendly ?? (error instanceof Error ? error.message : String(error));
      setModels([]);
      setConnectionStatus(mapRateLimitError(error) ? 'ready' : 'error');
      setLastError(message);
      setToolCallSupported('unknown');
    } finally {
      setIsFetchingModels(false);
    }
  }, [settings.baseUrl, settings.provider, settings.apiKey]);

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

    if (inferred === true || inferred === false) {
      setToolCallSupported(inferred);
      return inferred;
    }

    const baseUrl = sanitizeBaseUrl(settings.baseUrl);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {})
    };

    try {
      const testController = new AbortController();
      const timeoutId = setTimeout(() => testController.abort(), 8000);

      const response = await fetch(buildApiUrl(baseUrl, '/v1/chat/completions'), {
        method: 'POST',
        signal: testController.signal,
        headers,
        body: JSON.stringify({
          model: selectedModel,
          temperature: 0,
          max_tokens: 64,
          messages: [{ role: 'user', content: 'ping' }],
          tools: [HANDSHAKE_PROBE_TOOL],
          tool_choice: 'required'
        })
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const lower = errorText.toLowerCase();
        if (
          lower.includes('tool') ||
          lower.includes('function call') ||
          lower.includes('function calling') ||
          lower.includes('does not support') ||
          lower.includes('not supported')
        ) {
          setToolCallSupported(false);
          return false;
        }
        setToolCallSupported('unknown');
        return 'unknown';
      }

      const payload = await response.json();
      const message = payload?.choices?.[0]?.message;
      const toolCalls = message?.tool_calls;
      const legacyFunctionCalls = normalizeLegacyFunctionCall(message?.function_call);
      if (
        (Array.isArray(toolCalls) && toolCalls.length > 0) ||
        (legacyFunctionCalls && legacyFunctionCalls.length > 0)
      ) {
        setToolCallSupported(true);
        return true;
      }

      setToolCallSupported(false);
      return false;
    } catch (error) {
      const friendly = mapAiConnectionError(error);
      const message = friendly ?? (error instanceof Error ? error.message : String(error));

      if (message.includes('abort') || message.includes('timeout')) {
        setToolCallSupported('unknown');
        return 'unknown';
      }

      if (friendly) {
        setToolCallSupported('unknown');
        return 'unknown';
      }

      console.warn('Tool handshake failed', error);
      setToolCallSupported('unknown');
      return 'unknown';
    }
  }, [settings.apiKey, settings.baseUrl, settings.model]);

  /** On connect + model: hidden handshake (tools + tool_choice required) to set toolCallSupported. */
  useEffect(() => {
    if (connectionStatus === 'ready' && settings.model?.trim()) {
      void checkToolCallSupport();
    }
  }, [connectionStatus, settings.model, checkToolCallSupport]);

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
    setToolStatus(undefined);
    // Waiting for tool approval: abort ref is cleared — dismiss approvals so Stop works.
    if (pendingToolExecutionRef.current.size > 0) {
      pendingToolExecutionRef.current.clear();
      setPendingToolApprovals([]);
      setIsThinking(false);
      setIsCancelling(false);
      setLastError(undefined);
      return;
    }
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
      toolChoice: 'auto' | 'required' = 'auto',
      streamOptions?: { onDelta: (acc: { content: string; reasoning: string }) => void }
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
          { role: 'user', content: 'Please respond to the previous request.' },
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

      const useSse =
        Boolean(settings.streamChat && streamOptions?.onDelta);

      if (useSse) {
        body.stream = true;
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
          const response = await fetch(buildApiUrl(sanitizeBaseUrl(settings.baseUrl), '/v1/chat/completions'), {
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
            const message = detail || `LM Studio responded with status ${response.status}`;
            if (attempt < COMPLETION_MAX_RETRIES && shouldRetryCompletionRequest(response.status, message)) {
              lastAttemptError = new Error(message);
              await delay(Math.min(500 * Math.pow(2, attempt - 1), 5000));
              continue;
            }
            throw new Error(message);
          }

          if (useSse && streamOptions?.onDelta) {
            const { content: streamedRaw, reasoning: streamedReasoning, toolCallParts, finishReason, usage } =
              await consumeSseChatStream(response, streamOptions.onDelta, attemptController.signal);

            const rawContent = streamedRaw.trim() || '';
            const reasoningContent = sanitizeReasoningContent(streamedReasoning.trim() || '');
            const isReasoningOnly = !rawContent && !!reasoningContent && toolCallParts.size === 0;
            const aiContent = sanitizeAssistantContent(rawContent);

            let toolCalls: ToolCall[] | undefined;
            if (toolCallParts.size > 0) {
              const indices = [...toolCallParts.keys()].sort((a, b) => a - b);
              const mapped: ToolCall[] = [];
              for (const idx of indices) {
                const p = toolCallParts.get(idx)!;
                if (p.name) {
                  mapped.push({
                    id: p.id || createId(),
                    type: 'function' as const,
                    function: {
                      name: p.name,
                      arguments: p.arguments || '{}'
                    }
                  });
                }
              }
              toolCalls = mapped.length ? mapped : undefined;
            } else if (useTools) {
              const pseudoToolCalls = extractPseudoToolCalls(rawContent);
              if (pseudoToolCalls.length > 0) {
                toolCalls = pseudoToolCalls;
              }
            }

            if (!aiContent && !reasoningContent && !toolCalls?.length) {
              return { content: '', finishReason, toolCalls: undefined, usage };
            }

            return {
              content: aiContent,
              reasoning: reasoningContent,
              finishReason,
              reasoningOnly: isReasoningOnly,
              toolCalls,
              usage
            };
          }

          payload = await response.json();
          lastAttemptError = null;
          break;
        } catch (error) {
          const friendly = mapAnyAiError(error);
          const message = friendly ?? (error instanceof Error ? error.message : String(error));
          const attemptTimedOut = attemptController.signal.aborted && !signal.aborted;

          if (signal.aborted) {
            throw error instanceof Error ? error : new Error(message);
          }

          if (
            attempt < COMPLETION_MAX_RETRIES &&
            (attemptTimedOut || shouldRetryCompletionRequest(0, message)) &&
            !friendly
          ) {
            lastAttemptError = error instanceof Error ? error : new Error(message);
            await delay(Math.min(500 * Math.pow(2, attempt - 1), 5000));
            continue;
          }

          throw new Error(message);
        } finally {
          clearTimeout(timeoutId);
          signal.removeEventListener('abort', abortRelay);
        }
      }

      if (!payload) {
        throw lastAttemptError || new Error('The model returned no payload.');
      }

      const choice = payload?.choices?.[0];
      const rawMessage = choice?.message;
      const rawContent = rawMessage?.content?.trim() || '';
      const reasoningContent = sanitizeReasoningContent(rawMessage?.reasoning_content?.trim() || '');
      const isReasoningOnly = !rawContent && !!reasoningContent;
      const aiContent = sanitizeAssistantContent(rawContent);
      const rawToolCalls = rawMessage?.tool_calls;

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
      } else if (rawMessage?.function_call) {
        const legacyFunctionCalls = normalizeLegacyFunctionCall(rawMessage?.function_call);
        if (legacyFunctionCalls?.length) {
          toolCalls = legacyFunctionCalls;
        }
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
      const globalPrompt = settings.globalSystemPrompt?.trim();
      const useReplace = Boolean(settings.replaceBasePrompt && globalPrompt);

      if (useReplace) {
        systemMessages.push({ role: 'system', content: globalPrompt });
      } else if (includeBasePrompt) {
        const basePrompt = await loadBasePrompt();
        if (basePrompt) {
          systemMessages.push({ role: 'system', content: basePrompt });
        }
      }

      systemMessages.push({ role: 'system', content: createRuntimeModePrompt(settings) });
      if (projectPathRef.current) {
        systemMessages.push({
          role: 'system',
          content: `Current workspace/project path: ${projectPathRef.current}`
        });
      }
      if (!useReplace && globalPrompt) {
        systemMessages.push({ role: 'system', content: globalPrompt });
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
      const result = await performCompletion([...systemMessages, ...payloadMessages], signal, options?.useTools ?? false);
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

  const removeMessageFromConversation = useCallback((conversationId: string, messageId: string) => {
    setConversations(prev =>
      prev.map(conv =>
        conv.id !== conversationId
          ? conv
          : { ...conv, messages: conv.messages.filter(m => m.id !== messageId) }
      )
    );
  }, []);

  const updateMessageInConversation = useCallback(
    (conversationId: string, messageId: string, patch: Partial<Message>) => {
      setConversations(prev =>
        prev.map(conv =>
          conv.id !== conversationId
            ? conv
            : {
                ...conv,
                messages: conv.messages.map(m => (m.id === messageId ? { ...m, ...patch } : m))
              }
        )
      );
    },
    []
  );

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
      executedTools: ExecutedToolRecord[] = [],
      options?: { streamed?: boolean }
    ) => {
      if (options?.streamed) {
        const note = stopReason?.trim();
        if (
          note &&
          (note.includes('Stopped by user') ||
            note.includes('loop guard') ||
            note.includes('empty responses') ||
            note.includes('execution loop'))
        ) {
          addMessageToConversation(conversationId, {
            id: createId(),
            content: `*${note}*`,
            sender: 'system',
            timestamp: new Date()
          });
        }
        return;
      }
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
            currentState.mutationCorrectionSent &&
            !currentState.performedMutationTool;

          // Prune context if message history has grown large.
          // Input budget mirrors the output limit set in settings (maxTokens).
          // Both input and output are capped at maxTokens tokens, so total ≤ maxTokens × 2.
          // Chars ≈ tokens × 4. Minimum 8 000 chars so very small maxTokens don't over-prune.
          const inputCharBudget = Math.max(8000, settings.maxTokens * 4);
          const prunedMessages = pruneApiMessages(currentState.apiMessages, inputCharBudget);
          if (prunedMessages.length < currentState.apiMessages.length) {
            currentState.apiMessages = prunedMessages;
          }

          if (settings.streamChat && currentState.pendingStreamMessageId) {
            removeMessageFromConversation(currentState.conversationId, currentState.pendingStreamMessageId);
            currentState.pendingStreamMessageId = undefined;
          }

          let streamMsgId: string | undefined;
          if (settings.streamChat) {
            streamMsgId = createId();
            currentState.pendingStreamMessageId = streamMsgId;
            addMessageToConversation(currentState.conversationId, {
              id: streamMsgId,
              content: '',
              sender: 'ai',
              timestamp: new Date()
            });
          }

          let streamFirstChunk = true;
          const result = await performCompletion(
            currentState.apiMessages,
            currentState.controller.signal,
            useTools,
            forceToolChoice ? 'required' : 'auto',
            streamMsgId
              ? {
                  onDelta: ({ content, reasoning }) => {
                    if (streamFirstChunk) {
                      streamFirstChunk = false;
                      setIsThinking(false);
                    }
                    updateMessageInConversation(currentState.conversationId, streamMsgId!, {
                      content,
                      reasoning: reasoning.trim() || undefined
                    });
                  }
                }
              : undefined
          );

          if (result.reasoning && !currentState.combinedReasoning.includes(result.reasoning)) {
            currentState.combinedReasoning = [...currentState.combinedReasoning, result.reasoning];
          }

          if (result.toolCalls && result.toolCalls.length > 0) {
            const toolCalls = result.toolCalls;
            const toolFp = JSON.stringify(
              toolCalls.map(tc => ({ n: tc.function.name, a: tc.function.arguments }))
            );
            if (toolFp === currentState.lastToolCallsFingerprint) {
              currentState.identicalToolCallsRounds = (currentState.identicalToolCallsRounds ?? 0) + 1;
            } else {
              currentState.lastToolCallsFingerprint = toolFp;
              currentState.identicalToolCallsRounds = 0;
            }
            if ((currentState.identicalToolCallsRounds ?? 0) >= 4) {
              currentState.stopReason =
                'Stopped: the model repeated the same tool calls too many times. Try rephrasing or start a new chat.';
              break;
            }
            const toolCallInfos: ToolCallInfo[] = await Promise.all(
              toolCalls.map(tc => buildToolCallInfo(tc))
            );

            currentState.apiMessages = [
              ...currentState.apiMessages,
              buildAssistantToolMessage(toolCalls, result.content)
            ];

            const toolMessageId = streamMsgId ?? createId();
            const toolMessage: Message = {
              id: toolMessageId,
              content: result.content || '',
              reasoning: result.reasoning,
              sender: 'tool',
              timestamp: new Date(),
              toolCalls: toolCallInfos
            };
            if (streamMsgId) {
              updateMessageInConversation(currentState.conversationId, streamMsgId, {
                sender: 'tool',
                content: toolMessage.content,
                reasoning: toolMessage.reasoning,
                toolCalls: toolCallInfos
              });
              currentState.pendingStreamMessageId = undefined;
            } else {
              addMessageToConversation(currentState.conversationId, toolMessage);
            }

            if (
              !settings.yoloMode &&
              toolCalls.some(tc => toolNeedsApproval(tc.function.name))
            ) {
              const approvalId = createId();
              pendingToolExecutionRef.current.set(approvalId, {
                ...currentState,
                id: approvalId,
                messageId: toolMessageId,
                toolCalls
              });
              setPendingToolApprovals(prev => [
                ...prev,
                {
                  id: approvalId,
                  conversationId: currentState.conversationId,
                  messageId: toolMessageId,
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

            // Run all-read-only batches in parallel for speed
            const allReadOnly = toolCalls.every(tc => READ_ONLY_TOOL_NAMES.has(tc.function.name));

            if (allReadOnly && toolCalls.length > 1) {
              setToolStatus(`Running ${toolCalls.length} read-only tools...`);
              updateToolMessage(currentState.conversationId, toolMessageId, current =>
                current.map(entry => ({ ...entry, status: 'running' }))
              );
              const parallelResults = await Promise.all(
                toolCalls.map(tc =>
                  executeToolCall(tc, projectPathRef.current, {
                    signal: currentState.controller.signal,
                    requestId: `${currentState.requestId}:${tc.id}`
                  })
                )
              );
              for (let index = 0; index < toolCalls.length; index += 1) {
                const tc = toolCalls[index];
                const toolResult = parallelResults[index];
                toolResults.push(toolResult);
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
              }
              updateToolMessage(currentState.conversationId, toolMessageId, current =>
                current.map((entry, entryIndex) => {
                  const toolResult = parallelResults[entryIndex];
                  if (!toolResult) return entry;
                  return {
                    ...entry,
                    status: toolResult.content.startsWith('Error') ? 'error' : 'done',
                    result: toolResult.content.substring(0, 500)
                  };
                })
              );
            } else {
              for (let index = 0; index < toolCalls.length; index += 1) {
                const tc = toolCalls[index];
                setToolStatus(summarizeToolCall(tc));

                updateToolMessage(currentState.conversationId, toolMessageId, current =>
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

                updateToolMessage(currentState.conversationId, toolMessageId, current =>
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
            updateToolMessage(currentState.conversationId, toolMessageId, current =>
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

            // Auto-error-detection: after mutations, check Monaco diagnostics + run syntax checks
            if (
              roundPerformedMutation &&
              (currentState.autoFixRounds ?? 0) < MAX_AUTO_FIX_ROUNDS
            ) {
              await delay(DIAGNOSTIC_SETTLE_MS);
              const allErrorLines: string[] = [];

              // 1) Monaco diagnostics (TS/JS)
              const monacoErrors = getErrorDiagnostics();
              for (const d of monacoErrors.slice(0, 10)) {
                allErrorLines.push(`[ERROR] ${d.file}:${d.startLine}:${d.startColumn} - ${d.message}${d.code ? ` (${d.code})` : ''}`);
              }

              // 2) Active syntax check for non-TS/JS files that were mutated this round
              const mutatedPaths = new Set<string>();
              for (let ti = 0; ti < toolCalls.length; ti++) {
                const tc = toolCalls[ti];
                if (!MUTATING_TOOL_NAMES.has(tc.function.name)) continue;
                if (toolResults[ti]?.content?.startsWith('Error')) continue;
                const tcArgs = safeJsonParse(tc.function.arguments || '{}');
                const tcPath = String(tcArgs.path || '');
                if (!tcPath) continue;
                const ext = (tcPath.match(/\.[^.\\/:]+$/) || [''])[0].toLowerCase();
                if (MONACO_VALIDATED_EXTENSIONS.has(ext)) continue;
                const fullPath = resolveToolTargetPath(tcPath, projectPathRef.current);
                if (!mutatedPaths.has(fullPath)) {
                  mutatedPaths.add(fullPath);
                }
              }
              if (mutatedPaths.size > 0) {
                setToolStatus('Running syntax checks...');
                const syntaxResults = await Promise.all(
                  Array.from(mutatedPaths).map(async fp => {
                    const err = await runSyntaxCheck(fp, currentState.controller.signal);
                    return err ? { file: fp, error: err } : null;
                  })
                );
                for (const sr of syntaxResults) {
                  if (sr) {
                    // Take first few lines of the syntax error
                    const lines = sr.error.split('\n').slice(0, 5).join('\n');
                    allErrorLines.push(`[SYNTAX ERROR] ${sr.file}:\n${lines}`);
                  }
                }
              }

              if (allErrorLines.length > 0) {
                currentState.autoFixRounds = (currentState.autoFixRounds ?? 0) + 1;
                currentState.apiMessages = [
                  ...currentState.apiMessages,
                  {
                    role: 'user',
                    content: `${allErrorLines.length} error(s) detected after your changes. Fix them now:\n${allErrorLines.join('\n')}\n\nRead the affected file(s) if needed and apply corrections with replaceInFile. Do not ignore these errors.`
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
                ? '\n\nThe model could not generate a response. Please try again with a more precise request.'
                : 'The model could not generate a response. Please try again with a more precise request.';
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
            currentState.pendingStreamMessageId = undefined;
          }

          if (shouldContinue(result)) {
            currentState.pendingStreamMessageId = undefined;
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
        if (currentState.pendingStreamMessageId) {
          removeMessageFromConversation(currentState.conversationId, currentState.pendingStreamMessageId);
        }
        finalizeAssistantMessage(
          currentState.conversationId,
          currentState.combinedContent,
          currentState.combinedReasoning,
          stopReason,
          currentState.executedTools,
          { streamed: settings.streamChat }
        );
        return currentState.combinedContent;
      } catch (error) {
        const aborted = state.controller.signal.aborted;
        const friendly = mapAnyAiError(error);
        const message = friendly ?? (error instanceof Error ? error.message : String(error));
        setLastError(aborted ? 'Request cancelled.' : message);
        addMessageToConversation(state.conversationId, {
          id: createId(),
          content: aborted ? 'Request cancelled.' : `Error: ${message}`,
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
      removeMessageFromConversation,
      setIsThinking,
      settings,
      shouldContinue,
      toolCallSupported,
      updateMessageInConversation,
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

      // Auto-compact if context is >= 85%
      if (contextUsagePercent >= 85) {
        const saved = await compactContext(conversationId);
        if (saved > 0) setLastCompactionSaved(saved);
      }

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
          pendingStreamMessageId: undefined,
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
    const meta = modelMetadataRef.current.get(settings.model);
    return inferVisionSupportFromModel(settings.model, meta);
  }, [settings.model, settings.provider, models]);

  // ── Whisper Auto-Start ──
  useEffect(() => {
    const whisperService = WhisperAutoStartService.getInstance();
    whisperService.configure(settings.baseUrl, settings.speechWhisperModel);
    
    const unsubscribe = whisperService.onStateChange(setWhisperAutoStartState);
    
    // Start auto-start process when speech is enabled
    if (settings.speechEnabled && settings.speechUseWhisper) {
      whisperService.start();
    }
    
    return () => {
      unsubscribe();
    };
  }, [settings.baseUrl, settings.speechWhisperModel, settings.speechEnabled, settings.speechUseWhisper]);

  // ── Context usage tracking ──

  const [lastCompactionSaved, setLastCompactionSaved] = useState<number | undefined>();

  const [whisperAutoStartState, setWhisperAutoStartState] = useState<WhisperAutoStartState>({ status: 'idle' });

  const contextUsagePercent = useMemo(() => {
    const conv = conversations.find(c => c.id === activeConversationId);
    if (!conv || !settings.maxTokens) return 0;
    const totalChars = conv.messages.reduce((sum, m) => sum + (m.content?.length || 0) + (m.rawContent?.length || 0), 0);
    const estimatedTokens = totalChars / 4;
    return Math.min(100, Math.round((estimatedTokens / settings.maxTokens) * 100));
  }, [conversations, activeConversationId, settings.maxTokens]);

  // ── Sub-Agent system ──

  const [subAgents, setSubAgents] = useState<SubAgentInfo[]>([]);

  const clearSubAgents = useCallback(() => setSubAgents([]), []);

  /**
   * Parse a task description and determine sub-tasks for parallel agents.
   * Uses the LLM to break down the task, then runs agents concurrently.
   * Each sub-agent gets its own isolated requestCompletion call so they don't
   * interfere with each other's message history.
   */
  const spawnSubAgents = useCallback(async (_task: string) => {}, []);

  const compactContext = useCallback(async (conversationId: string) => {
    const conv = conversations.find(c => c.id === conversationId);
    if (!conv || conv.messages.length <= 6) return 0;

    const toCompact = conv.messages.slice(0, -4);
    const toKeep = conv.messages.slice(-4);

    const originalChars = toCompact.reduce((s, m) => s + (m.content?.length || 0), 0);

    const summaryText = toCompact
      .map(m => `[${m.sender}]: ${(m.rawContent || m.content || '').slice(0, 500)}`)
      .join('\n');

    let summary = '';
    try {
      summary = await requestCompletion([
        { role: 'user', content: `Summarize the following conversation history concisely, preserving all important technical facts, file paths, decisions and code snippets:\n\n${summaryText}` }
      ], { includeBasePrompt: false }) || '';
    } catch {
      return 0;
    }

    if (!summary) return 0;

    const summaryMessage: Message = {
      id: createId(),
      content: `[Compacted history summary]\n${summary}`,
      sender: 'system',
      timestamp: new Date()
    };

    const savedChars = originalChars - summary.length;

    setConversations(prev => prev.map(c =>
      c.id === conversationId
        ? { ...c, messages: [summaryMessage, ...toKeep] }
        : c
    ));

    return Math.max(0, Math.round(savedChars / 4));
  }, [conversations, requestCompletion]);

  // Listen for spawnSubAgent events dispatched by the tool handler
  useEffect(() => {
    const handler = (event: Event) => {
      const { agentId, task, systemPrompt } = (event as CustomEvent).detail as { agentId: string; task: string; systemPrompt: string };
      setSubAgents(prev => [...prev, { id: agentId, task, status: 'running' }]);

      const currentProjectPath = projectPathRef.current;
      const projectPathInjection = currentProjectPath
        ? `\nCurrent workspace/project path: ${currentProjectPath}\nAll file operations must use this path as root.`
        : '';
      const fullSystemPrompt = systemPrompt
        ? `${systemPrompt}${projectPathInjection}`
        : projectPathInjection.trim();

      requestCompletion(
        [{ role: 'user', content: task }],
        { injectSystemPrompt: fullSystemPrompt || undefined, useTools: true }
      ).then(result => {
        setSubAgents(prev => prev.map(a => a.id === agentId ? { ...a, status: 'done', result: result?.trim() || 'Completed.' } : a));
        window.dispatchEvent(new CustomEvent('ai:subAgentDone', { detail: { agentId, task, result: result?.trim() || '' } }));
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setSubAgents(prev => prev.map(a => a.id === agentId ? { ...a, status: 'error', result: msg } : a));
      });
    };
    window.addEventListener('ai:spawnSubAgent', handler);
    return () => window.removeEventListener('ai:spawnSubAgent', handler);
  }, [requestCompletion]);

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
      localBackendInstalls,
      refreshLocalBackendInstalls,
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
      rejectPendingToolApproval,
      subAgents,
      spawnSubAgents,
      clearSubAgents,
      contextUsagePercent,
      lastCompactionSaved,
      activeFilePath,
      whisperAutoStartState
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
      localBackendInstalls,
      refreshLocalBackendInstalls,
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
      rejectPendingToolApproval,
      subAgents,
      spawnSubAgents,
      clearSubAgents,
      contextUsagePercent,
      lastCompactionSaved,
      activeFilePath,
      whisperAutoStartState
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

/** Safe when StatusBar may render outside AIProvider (e.g. splash). */
export const useOptionalAI = () => useContext(AIContext);
