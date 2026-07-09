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
import { AI_TOOLS, executeToolCall, ToolCall, ToolResult, EditorDiagnostic, setCurrentDiagnostics, getErrorDiagnostics, TodoItem, setTodoUpdateListener } from '../services/AIToolService';
import { isAbsoluteFilePath, joinPathPreserveAbsolute } from '../utils/pathUtils';
import WhisperAutoStartService, { WhisperAutoStartState } from '../services/WhisperAutoStartService';
import { classifyModel, ModelClassification } from '../services/modelCapabilities';

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

// An AI connection profile — lets the user keep several setups (e.g. "Local 1"
// using Ollama/LM Studio and "Cloud 1" using an OpenAI-compatible provider) and
// switch between them in one click.
export interface AIProfile {
  id: string;
  name: string;
  kind: 'local' | 'cloud';
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface AISettings {
  provider: 'lmstudio';
  baseUrl: string;
  model: string;
  profiles: AIProfile[];
  activeProfileId: string;
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
  // When enabled, the agent first drafts a step-by-step plan that the user must
  // approve (or that auto-approves after planAutoApproveSeconds) before any work
  // runs. Keeps the agent on-scope and ensures nothing is forgotten.
  planningEnabled: boolean;
  planAutoApproveSeconds: number;
  // Detail level sent with images to vision models. 'low' is cheap/fast, 'high'
  // resolves small text/diagrams, 'auto' lets the model decide.
  visionDetail: 'low' | 'high' | 'auto';
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
}

export type ToolCallSupport = boolean | 'unknown';

export interface PendingToolApproval {
  id: string;
  conversationId: string;
  messageId: string;
  summary: string;
  toolCalls: ToolCallInfo[];
}

export interface PlanStep {
  id: string;
  text: string;
}

export interface PendingPlanApproval {
  id: string;
  conversationId: string;
  title: string;
  steps: PlanStep[];
  autoApproveSeconds: number;
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
  /** Per-model capability classification (tool support, vision, kind) for the picker. */
  modelClassifications: Record<string, ModelClassification>;
  visionSupported: boolean;
  pendingToolApprovals: PendingToolApproval[];
  approvePendingToolApproval: (id: string) => Promise<void>;
  rejectPendingToolApproval: (id: string) => Promise<void>;
  pendingPlanApproval: PendingPlanApproval | null;
  approvePlan: (id: string, editedSteps?: PlanStep[]) => Promise<void>;
  rejectPlan: (id: string) => void;
  saveProfile: (profile: AIProfile) => void;
  deleteProfile: (id: string) => void;
  selectProfile: (id: string) => void;
  subAgents: SubAgentInfo[];
  spawnSubAgents: (parentTask: string) => Promise<void>;
  clearSubAgents: () => void;
  /** Live partial text of the in-flight completion (streamed). */
  streamingDraft: StreamingDraft | null;
  /** Live todo list the agent maintains via the updateTodoList tool. */
  agentTodos: TodoItem[];
  /** Token usage of the most recent turn (summed across all loop rounds). */
  lastTurnTokens?: { prompt: number; completion: number; total: number };
  contextUsagePercent: number;
  lastCompactionSaved?: number;
  activeFilePath?: string;
  whisperAutoStartState: WhisperAutoStartState;
}

const AIContext = createContext<AIContextType | undefined>(undefined);

const SETTINGS_KEY = 'lseditor.ai.settings';
const DEFAULT_LOCAL_PROFILE_ID = 'local-1';
const defaultProfiles: AIProfile[] = [
  { id: DEFAULT_LOCAL_PROFILE_ID, name: 'Local 1', kind: 'local', baseUrl: 'http://localhost:1234', model: '', apiKey: '' }
];
// Coding wants precise, low-variance output. 0.7 (a chat default) makes edits
// and tool arguments sloppy; 0.2 keeps the model on-target. maxTokens is a
// COMPLETION cap — 4096 truncates real edits mid-file, so default to 8192.
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 8192;
// The previous shipped defaults; migrated forward when still untouched.
const LEGACY_DEFAULT_TEMPERATURE = 0.7;
const LEGACY_DEFAULT_MAX_TOKENS = 4096;

const defaultSettings: AISettings = {
  provider: 'lmstudio',
  baseUrl: 'http://localhost:1234',
  model: '',
  profiles: defaultProfiles,
  activeProfileId: DEFAULT_LOCAL_PROFILE_ID,
  temperature: DEFAULT_TEMPERATURE,
  topP: 1,
  maxTokens: DEFAULT_MAX_TOKENS,
  toolsEnabled: true,
  mode: 'coder',
  yoloMode: false,
  speechEnabled: false,
  speechUseWhisper: false,
  speechWhisperModel: '',
  speechMicDeviceId: '',
  speechAlwaysReady: false,
  subAgentsEnabled: false,
  planningEnabled: true,
  planAutoApproveSeconds: 60,
  visionDetail: 'auto'
};

const MAX_AGENT_LOOPS = 30;
const MAX_TOOL_WRITE_LINES = 140;
const MAX_TOOL_APPEND_LINES = 120;
const COMPLETION_REQUEST_TIMEOUT_MS = 120000;
const COMPLETION_MAX_RETRIES = 4;
const DIAGNOSTIC_SETTLE_MS = 1200;
const MAX_AUTO_FIX_ROUNDS = 3;
// Assumed model context window for the usage meter / auto-compaction trigger.
// Local models (LM Studio/Ollama) typically run 8k-32k; 16k is a conservative
// middle ground. NOT the same as settings.maxTokens (max completion length).
const ASSUMED_CONTEXT_WINDOW_TOKENS = 16384;

// Best-effort context-window estimate from the model id, so the usage meter and
// auto-compaction trigger are sane for large-context cloud models instead of
// firing at "85% full" after a few messages. Falls back to the local default.
const guessContextWindow = (model: string): number => {
  const id = (model || '').toLowerCase();
  if (!id) return ASSUMED_CONTEXT_WINDOW_TOKENS;
  if (id.includes('gemini')) return 200000; // 1M+ real, capped for meter sanity
  if (id.includes('claude')) return 200000;
  if (id.includes('gpt-5') || id.includes('gpt-4.1') || id.includes('gpt-4o') || /\bo[1-4]\b/.test(id)) return 128000;
  if (id.includes('gpt-4')) return 120000;
  if (id.includes('128k')) return 128000;
  if (id.includes('32k')) return 32768;
  if (id.includes('1m')) return 200000;
  if (id.includes('qwen') || id.includes('llama') || id.includes('deepseek') || id.includes('mistral') || id.includes('glm') || id.includes('kimi')) {
    return 32768; // most modern local coding models ship 32k
  }
  return ASSUMED_CONTEXT_WINDOW_TOKENS;
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

const DEFAULT_BASE_PROMPT = `You are LS AI, the integrated coding agent of LS Editor. You can read, write and
edit files and run shell commands in the user's workspace — but ONLY by invoking tools.
You are an agent, not a chatbot: when the user asks about the project or asks you to
create, change, run or fix something, you find the answer or do the work with tools.

How you invoke tools is described in the "HOW TO USE TOOLS" section that follows.
Follow its format EXACTLY — it differs depending on the active model. Always:
- ACT, don't describe. To answer "what is in file X?" you call readFile on X and read
  the result — you do NOT explain how one could read it. To create a file you call
  writeFile. Never replace a real action with a description of it.
- NEVER write pseudo-code, snippets, lambdas or expressions that merely LOOK like a
  tool call (e.g. readFile(path), runCommand(x => readFile(...)), lua/js/python). That
  text does nothing — use the exact tool-call format from the protocol section.
- Use ONLY the exact tool names and argument keys you are given. To create a file use
  writeFile with the FULL content — there is no "createFile".
- One step at a time: call, wait for the result, then decide the next step.
- Read files before editing. Prefer replaceInFile for targeted edits; writeFile only for
  new files. Work in small chunks (~120 lines per write/replace).
- After every code change call getDiagnostics and fix reported errors. If replaceInFile
  fails, re-read the file, adjust the search text, retry.
- Never claim a file was changed or a command succeeded unless a tool returned that.
- Do not reveal internal reasoning or emit fake function-call/protocol syntax in prose.
- End substantial completed tasks with: ## Ergebnis, ## Vorgehen, ## Validierung`;

// Some models reject a custom sampling temperature/top_p and only run at their
// own fixed setting: OpenAI reasoning models (o1/o3/o4, gpt-5) and Anthropic
// Claude. Sending temperature to them errors or silently degrades output, so
// we omit it and let the provider use its default.
const modelIgnoresTemperature = (model: string): boolean => {
  const id = (model || '').toLowerCase();
  if (/(^|[\/:_-])o[1-4]($|[\/:_.-])/.test(id)) return true; // o1 / o3 / o4 …
  if (id.includes('gpt-5') || id.includes('gpt5')) return true;
  if (id.includes('claude')) return true;
  if (id.includes('reason') || id.includes('thinking')) return true;
  return false;
};

// Resolve the sampling params to actually send for a given model. Returns
// `undefined` fields for models that must not receive them.
const resolveSampling = (
  settings: AISettings
): { temperature?: number; top_p?: number } => {
  if (modelIgnoresTemperature(settings.model)) {
    return {};
  }
  return { temperature: settings.temperature, top_p: settings.topP };
};

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

const CONVERSATIONS_KEY = 'lseditor.ai.conversations';
const MAX_PERSISTED_CONVERSATIONS = 50;

// Restore saved conversations (surviving app restarts). Message timestamps are
// serialized as ISO strings and revived back into Date objects here.
const loadStoredConversations = (): Conversation[] => {
  if (typeof window === 'undefined') return [createConversation(1)];
  try {
    const raw = window.localStorage.getItem(CONVERSATIONS_KEY);
    if (!raw) return [createConversation(1)];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [createConversation(1)];
    const revived: Conversation[] = parsed
      .filter((c: any) => c && typeof c.id === 'string' && Array.isArray(c.messages))
      .map((c: any) => ({
        id: c.id,
        title: typeof c.title === 'string' ? c.title : 'Chat',
        createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
        messages: c.messages.map((m: any) => ({
          ...m,
          timestamp: m.timestamp ? new Date(m.timestamp) : new Date()
        }))
      }));
    return revived.length ? revived : [createConversation(1)];
  } catch {
    return [createConversation(1)];
  }
};

// Persist conversations, trimming to the most recent N. Retries with fewer
// conversations if the browser storage quota is exceeded (large image dataURLs).
const persistConversations = (conversations: Conversation[]) => {
  if (typeof window === 'undefined') return;
  let toStore = conversations.slice(-MAX_PERSISTED_CONVERSATIONS);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      window.localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(toStore));
      return;
    } catch {
      // Quota exceeded — drop the oldest half and retry.
      if (toStore.length <= 1) {
        try { window.localStorage.removeItem(CONVERSATIONS_KEY); } catch { /* ignore */ }
        return;
      }
      toStore = toStore.slice(Math.ceil(toStore.length / 2));
    }
  }
};

const sanitizeBaseUrl = (url: string) => {
  if (!url) return 'http://localhost:1234';
  return url.trim().replace(/\/$/, '');
};

const TOOL_SUPPORT_CACHE_KEY = 'lseditor.ai.toolSupportCache';
const toolSupportCacheId = (baseUrl: string, model: string) => `${sanitizeBaseUrl(baseUrl)}::${model}`;

const loadToolSupportCache = (): Map<string, ToolCallSupport> => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(TOOL_SUPPORT_CACHE_KEY) : null;
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, ToolCallSupport>;
    // Only persist definitive verdicts; 'unknown' is never cached.
    return new Map(Object.entries(parsed).filter(([, v]) => v === true || v === false));
  } catch {
    return new Map();
  }
};

const saveToolSupportCache = (cache: Map<string, ToolCallSupport>) => {
  try {
    if (typeof localStorage === 'undefined') return;
    const obj: Record<string, ToolCallSupport> = {};
    cache.forEach((value, key) => {
      if (value === true || value === false) obj[key] = value;
    });
    localStorage.setItem(TOOL_SUPPORT_CACHE_KEY, JSON.stringify(obj));
  } catch {
    /* ignore quota / serialization errors */
  }
};

/**
 * Ollama exposes richer capability data than the OpenAI-compatible `/v1/models`
 * route. When the endpoint is an Ollama server, fetch the native model list
 * (`/api/tags`) and per-model capabilities (`/api/show`, which reports a
 * `capabilities: ["completion","tools","vision",…]` array). Returns a metadata
 * map keyed by model id, or null when the endpoint is not Ollama.
 */
const fetchOllamaCapabilities = async (
  baseUrl: string,
  modelIds: string[]
): Promise<Map<string, any> | null> => {
  try {
    const tagsRes = await fetch(`${baseUrl}/api/tags`);
    if (!tagsRes.ok) return null;
    const tags = await tagsRes.json();
    if (!Array.isArray(tags?.models)) return null;

    const metadata = new Map<string, any>();
    // Probe capabilities for the models actually offered, capped for safety.
    const targets = modelIds.length ? modelIds : tags.models.map((m: any) => m?.model || m?.name).filter(Boolean);
    await Promise.all(
      targets.slice(0, 50).map(async (id: string) => {
        try {
          const showRes = await fetch(`${baseUrl}/api/show`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: id })
          });
          if (!showRes.ok) return;
          const show = await showRes.json();
          if (show?.capabilities) metadata.set(id, { capabilities: show.capabilities, details: show.details });
        } catch {
          /* per-model show failures are non-fatal */
        }
      })
    );
    return metadata.size ? metadata : null;
  } catch {
    return null;
  }
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

// Thin wrapper around the shared capability catalog (src/services/
// modelCapabilities.ts). Kept as a named helper so the rest of this file reads
// the same as before; the catalog is the single source of truth.
const inferToolCallSupportFromModel = (modelId: string, modelData?: any): ToolCallSupport =>
  classifyModel(modelId, modelData).toolSupport;

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

const READ_ONLY_TOOL_NAMES = new Set(['findFile', 'readFile', 'listFiles', 'searchFiles', 'searchWorkspace', 'searchCodebase', 'findReferences', 'getDiagnostics', 'updateTodoList', 'webFetch']);
const MUTATING_TOOL_NAMES = new Set(['writeFile', 'appendToFile', 'replaceInFile', 'applyPatch', 'createDirectory', 'deleteFile', 'renameFile']);
const EXECUTION_TOOL_NAMES = new Set(['runCommand']);

const toolNeedsApproval = (toolName: string) =>
  MUTATING_TOOL_NAMES.has(toolName) || EXECUTION_TOOL_NAMES.has(toolName);

// Irreversible / destructive shell commands that must be confirmed even in
// YOLO mode. Deliberately broad — false positives just add one approval click.
const DANGEROUS_COMMAND_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*\s+)*-[a-z]*r[a-z]*f/i, // rm -rf and variants
  /\brm\s+-[a-z]*f[a-z]*r/i,
  /\brmdir\s+\/s/i,
  /\bdel\s+\/[sf]/i,
  /\brd\s+\/s/i,
  /\bformat\s+([a-z]:|\/(fs|q|x)\b)/i, // disk format — NOT `npm run format`
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /:\s*\(\s*\)\s*\{.*\|.*&\s*\}\s*;/, // fork bomb
  /\bgit\s+push\b.*(--force|-f)\b/i,
  /\bgit\s+reset\s+--hard/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\bshutdown\b|\breboot\b/i,
  /\bchmod\s+-R\s+0?00\b/i,
  />\s*\/dev\/sd[a-z]/i,
  /\bcurl\b.*\|\s*(sudo\s+)?(sh|bash)\b/i, // curl | sh
  /\bwget\b.*\|\s*(sudo\s+)?(sh|bash)\b/i
];

const isDangerousCommand = (command: string): boolean => {
  const c = String(command || '');
  return DANGEROUS_COMMAND_PATTERNS.some(re => re.test(c));
};

const isDangerousToolCall = (tc: ToolCall): boolean => {
  if (tc.function.name !== 'runCommand') return false;
  try {
    const args = JSON.parse(tc.function.arguments || '{}');
    return isDangerousCommand(String(args.command || ''));
  } catch {
    return false;
  }
};

const getToolsForMode = (settings: AISettings) => {
  if (settings.mode === 'qa') {
    return AI_TOOLS.filter(tool => READ_ONLY_TOOL_NAMES.has(tool.function.name));
  }
  if (!settings.subAgentsEnabled) {
    return AI_TOOLS.filter(tool => tool.function.name !== 'spawnSubAgent');
  }
  return AI_TOOLS;
};

// One-line usage reference per real tool. Each line names the EXACT argument
// keys the executor expects, so models emit correct JSON arguments.
const TOOL_USAGE: Record<string, string> = {
  findFile: 'findFile — args: { "query": string }. Locate a file when you do not know its exact path.',
  readFile: 'readFile — args: { "path": string, optional "startLine": number, "endLine": number }. Read a file. Omit the line range to read from the start (it auto-chunks large files and tells you how to continue).',
  writeFile: 'writeFile — args: { "path": string, "content": string }. Create a NEW file or overwrite one. "content" MUST be the COMPLETE literal file text as a JSON string (never empty, never a variable/placeholder).',
  appendToFile: 'appendToFile — args: { "path": string, "content": string }. Append literal text to the end of an existing file. Best tool to add something "at the bottom" of a file.',
  replaceInFile: 'replaceInFile — args: { "path": string, "search": string, "replace": string }. Replace exact existing text; "search" must match the current file content verbatim.',
  listFiles: 'listFiles — args: { "path": string }. List the contents of a directory.',
  searchFiles: 'searchFiles — args: { "pattern": string }. Find files by glob pattern.',
  searchWorkspace: 'searchWorkspace — args: { "query": string }. Search file names and contents across the project.',
  searchCodebase: 'searchCodebase — args: { "query": string }. Relevance-ranked search: find the files most relevant to a description/symbol. Use FIRST to locate where something lives.',
  findReferences: 'findReferences — args: { "symbol": string }. Find every whole-word reference to a symbol across the project, with context.',
  applyPatch: 'applyPatch — args: { "edits": [{ "path": string, "search": string, "replace": string }] }. Apply multiple edits across files atomically (all-or-nothing).',
  runCommand: 'runCommand — args: { "command": string }. Run ONE shell/terminal command in the project.',
  createDirectory: 'createDirectory — args: { "path": string }. Create a directory.',
  deleteFile: 'deleteFile — args: { "path": string }. Delete a file.',
  renameFile: 'renameFile — args: { "oldPath": string, "newPath": string }. Rename or move a file.',
  getDiagnostics: 'getDiagnostics — args: {}. Get current compiler/linter errors and warnings.',
  webFetch: 'webFetch — args: { "url": string }. Fetch a web page / API URL and get its text (for up-to-date docs, API references, user-provided links).',
  updateTodoList: 'updateTodoList — args: { "items": [{ "text": string, "status": "pending"|"in_progress"|"done" }] }. Replace the visible progress list with the FULL updated list (not a diff).',
  spawnSubAgent: 'spawnSubAgent — args: { "task": string }. Delegate an isolated sub-task to a helper agent.'
};

const buildToolReference = (settings: AISettings) => {
  const tools = getToolsForMode(settings);
  const lines = tools
    .map(tool => TOOL_USAGE[tool.function.name])
    .filter(Boolean)
    .map(line => `- ${line}`);
  return `AVAILABLE TOOLS (use ONLY these exact names and argument keys — never invent others):\n${lines.join('\n')}`;
};

// Protocol for models WITH native tool calling: call tools through the API's
// tool mechanism, never as text.
const NATIVE_TOOL_PROTOCOL = [
  'HOW TO USE TOOLS (this model supports native tool calls — critical):',
  '- To DO anything (read, write, search, run), emit a REAL tool call through the tool-calling mechanism. Do NOT describe, narrate, or plan the call in prose first — just make it.',
  '- NEVER write a tool call as text, JSON, or inside a ```code block. NEVER write pseudo-code, lambdas, or expressions like `runCommand(x => readFile(...))`, `readFile(path)`, or lua/js/python that *describes* a call. Such text is NOT executed and produces nothing.',
  '- Use ONLY the exact tool names and argument keys listed below. To create a file use writeFile (there is no "createFile").',
  '- Arguments must be LITERAL values: put the actual file text directly in "content" as a JSON string (with \\n for newlines). NEVER pass a variable, placeholder or expression like {"content": chunk}, and never write code that builds the arguments.',
  '- writeFile needs BOTH "path" and the COMPLETE "content". Never call it with only a path. If content is very large, make SEVERAL calls yourself (writeFile then appendToFile), each with real literal text — do not write a loop.',
  '- Take ONE concrete step, wait for the tool result, then decide the next step.',
  '- Never claim a file was read/created/changed or a command succeeded unless a tool call actually returned that result.',
  '',
  'EXAMPLE — user asks "was steht in der test.py?": do NOT explain how to read it. Immediately make a real readFile tool call with arguments {"path": "test.py"}, then answer using the returned content.'
].join('\n');

// Protocol for models WITHOUT native tool calling: tools are invoked by writing
// a single JSON block in EXACTLY this shape (parsed back into a real call).
const PROMPT_FALLBACK_TOOL_PROTOCOL = [
  'HOW TO USE TOOLS (this model has NO native tool calling — you invoke tools by writing JSON — critical):',
  '- To call a tool, output a SINGLE fenced json block and nothing else in that message, in EXACTLY this shape:',
  '```json',
  '{"tool": "<toolName>", "arguments": { ... }}',
  '```',
  '- Use ONLY the exact tool names and argument keys listed below. To create a file use writeFile (there is no "createFile").',
  '- Do NOT write code that *describes* a call (no lua/js/python, no arrow functions like `x => readFile(...)`, no `runCommand(...)` expressions, no concatenation helpers). Write ONLY the json block shown above with literal values.',
  '- Arguments must be LITERAL: put the actual file text directly in "content" as a JSON string (use \\n for newlines). NEVER pass a variable/placeholder like {"content": chunk}. If content is very large, make SEVERAL json blocks across turns (writeFile then appendToFile), each with real text — do not write a loop.',
  '- Emit the json block by itself, then STOP. The tool result is sent back to you in the next message; continue from there.',
  '- Take ONE step at a time. writeFile needs BOTH "path" and the COMPLETE "content". Never claim success unless a tool result confirmed it.',
  '',
  'EXAMPLE — user asks "was steht in der test.py?": respond with EXACTLY this and nothing else:',
  '```json',
  '{"tool": "readFile", "arguments": {"path": "test.py"}}',
  '```'
].join('\n');

// Family-specific guidance. Different model families behave best with slightly
// different steering; this appends a short tuned block based on the model id.
const getModelFamilyGuidance = (model: string): string => {
  const id = (model || '').toLowerCase();
  if (id.includes('claude')) {
    return [
      'You are running as Claude. Be direct and concise — do not over-explain or narrate every step.',
      'Trust native tool calls: act immediately instead of describing what you will do. Batch independent reads/searches into parallel tool calls.',
      'Prioritise technical accuracy over agreement; if the user is wrong, say so and explain why.'
    ].join('\n');
  }
  if (id.includes('gpt') || id.includes('o1') || id.includes('o3') || id.includes('o4') || id.includes('openai')) {
    return [
      'Be terse and to the point. Prefer parallel tool calls for independent work.',
      'Do not restate the task or your plan in prose before acting — just make the tool calls.'
    ].join('\n');
  }
  if (id.includes('gemini')) {
    return [
      'Work step by step. Before each tool call, take exactly one concrete action toward the goal.',
      'Do not produce long preamble; act with tools and keep prose minimal.'
    ].join('\n');
  }
  if (id.includes('qwen') || id.includes('deepseek') || id.includes('glm') || id.includes('kimi') || id.includes('mistral') || id.includes('llama')) {
    return [
      'Follow the tool-call format EXACTLY. Emit ONE tool call, wait for its result, then continue.',
      'Put literal values in arguments — never variables, placeholders, or code that builds the arguments.',
      'Keep search/replace strings short and copied verbatim from what you just read.'
    ].join('\n');
  }
  return '';
};

// The "keep going" directive that separates a real agent from a chatbot. Only
// for work modes — a QA/read-only turn should stop after answering.
const PERSISTENCE_DIRECTIVE = [
  'PERSISTENCE: You are an agent — keep working until the user\'s request is COMPLETELY resolved before ending your turn. Do not stop at the first obstacle or hand back a half-done task.',
  'Only stop when: the task is done and verified, OR you are genuinely blocked and need a decision from the user, OR the user asked only a question. When blocked, state the specific blocker plainly.',
  'Never end your turn saying you "will now" do something — actually do it with a tool call in the same turn.'
].join('\n');

const createRuntimeModePrompt = (settings: AISettings, nativeTools = true) => {
  const TOOL_PROTOCOL = nativeTools ? NATIVE_TOOL_PROTOCOL : PROMPT_FALLBACK_TOOL_PROTOCOL;
  const familyGuidance = getModelFamilyGuidance(settings.model);
  const toolGuidance = [
    'EFFICIENCY (important): Match effort to the task and do EXACTLY what was asked — nothing more. Take the most direct path and STOP the moment the request is fulfilled. Fewer, well-chosen tool calls are better; every call costs the user time and tokens.',
    'Do NOT re-verify trivially: a successful writeFile / replaceInFile / appendToFile result already confirms the change — do not readFile the same file again just to "check". Do not call listFiles or getDiagnostics unless the result actually informs your next step.',
    'Do exactly what the content says. If asked to write `hallo` into a file, the file content is exactly `hallo`. Never reformat, quote, "fix", or make content "valid" for some language unless the user asked for that.',
    'Only run/execute a program or command when the user explicitly asks you to run it, or when running is truly required to finish the task. Creating or editing a file does NOT require running it.',
    'If a command or edit FAILS, read the error and change your approach before retrying. NEVER repeat an identical failing call hoping for a different result. After two failed attempts at the same thing, stop and report the blocker plainly.',
    'Editing: readFile (in chunks) the relevant part before changing it; prefer replaceInFile for targeted edits, writeFile for new files / full rewrites, appendToFile to add literal text to the end. Split only very large content into SEVERAL calls with real literal text — never a variable or a loop.',
    'When you change real SOURCE code, call getDiagnostics afterward and fix reported errors with replaceInFile. Skip getDiagnostics for trivial/non-code files (plain text, notes, one-liners) where it adds nothing.',
    'To locate where a feature/bug lives when you do not know the file, use searchCodebase (relevance-ranked) FIRST; use findReferences to see all uses of a symbol; searchWorkspace for exact text; findFile when only the name is known.',
    'For a change that spans multiple files, use applyPatch with all edits at once (atomic) instead of many separate replaceInFile calls.',
    'For substantial multi-step tasks, maintain the progress list with the updateTodoList tool: create it when you plan, mark the current step in_progress, and mark steps done as you finish them. Simple tasks need no todo list — just do them.',
    'Finish with a SHORT confirmation. Use the ## Ergebnis / ## Vorgehen / ## Validierung sections ONLY for substantial multi-step tasks; for a small task one sentence is enough. Never pad the summary or claim validation you did not perform.'
  ].join('\n');

  const toolReference = buildToolReference(settings);

  if (settings.mode === 'qa') {
    return [
      'Mode: QA. Read-only tools only. Do not modify files or run mutating commands.',
      'Answer questions, explain code, propose changes. For implementation, tell the user to switch to Coder mode.',
      TOOL_PROTOCOL,
      toolReference,
      toolGuidance,
      familyGuidance
    ].filter(Boolean).join('\n\n');
  }

  if (settings.mode === 'autonomous') {
    return [
      'Mode: Autonomous. Work like a senior engineer: plan, implement, validate — but stay proportional to the request.',
      'For a multi-step task, make a short checklist and execute it step by step. For a simple task, just do it directly — no checklist, no ceremony.',
      'Validate at a level the task warrants: run getDiagnostics after real source changes; only execute the program with runCommand if the user asked you to run it or if running is required to verify the specific thing requested. Do NOT invent extra verification, and do NOT keep iterating once the actual request is fulfilled — stop.',
      PERSISTENCE_DIRECTIVE,
      TOOL_PROTOCOL,
      toolReference,
      toolGuidance,
      familyGuidance
    ].filter(Boolean).join('\n\n');
  }

  return [
    'Mode: Coder. Read, write, create files and run commands to complete coding tasks.',
    'Prefer tool calls over prose. For multi-step work make a short checklist; for a simple request just do it. STOP as soon as the request is fulfilled.',
    'Do not iterate beyond what was asked, and do not run/execute the result unless the user asked you to.',
    PERSISTENCE_DIRECTIVE,
    TOOL_PROTOCOL,
    toolReference,
    toolGuidance,
    familyGuidance
  ].filter(Boolean).join('\n\n');
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
      case 'searchCodebase':
        return `Searching codebase for ${args.query || 'relevant files'}`;
      case 'findReferences':
        return `Finding references to ${args.symbol || 'symbol'}`;
      case 'applyPatch': {
        const count = Array.isArray(args.edits) ? args.edits.length : 0;
        return `Applying patch (${count} edit${count === 1 ? '' : 's'})`;
      }
      case 'runCommand':
        return `Running ${args.command || 'command'}`;
      case 'createDirectory':
        return `Creating ${args.path || 'directory'}`;
      case 'deleteFile':
        return `Deleting ${args.path || 'path'}`;
      case 'renameFile':
        return `Renaming ${args.oldPath || 'path'}`;
      case 'updateTodoList': {
        const items = Array.isArray(args.items) ? args.items : [];
        const done = items.filter((item: any) => item?.status === 'done').length;
        return items.length ? `Updating todo list (${done}/${items.length} done)` : 'Updating todo list';
      }
      default:
        return `Running ${toolCall.function.name}`;
    }
  } catch {
    return `Running ${toolCall.function.name}`;
  }
};

// Ensures tool-call arguments echoed back to the API are valid JSON. A model
// that emits malformed args (e.g. `{"content": chunk}` with an unquoted
// placeholder) would otherwise crash the NEXT request with "invalid tool call
// arguments" and abort the whole turn. We coerce unparseable args to `{}` — the
// tool result already explains the error so the model can retry correctly.
const sanitizeToolArgsForApi = (raw: string): string => {
  const s = (raw || '').trim();
  if (!s) return '{}';
  try { JSON.parse(s); return s; } catch { /* try to salvage below */ }
  try {
    const fixed = s.replace(/,\s*([}\]])/g, '$1');
    JSON.parse(fixed);
    return fixed;
  } catch {
    return '{}';
  }
};

const buildAssistantToolMessage = (toolCalls: ToolCall[], content?: string | null) => ({
  role: 'assistant',
  content: content || null,
  tool_calls: toolCalls.map(tc => ({
    id: tc.id,
    type: 'function',
    function: { name: tc.function.name, arguments: sanitizeToolArgsForApi(tc.function.arguments) }
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
  // Purely informational queries don't need mutating tools.
  const infoPattern = /^(was |wie |warum |wann |wo |wer |welche|erkl|beschreib|zeig|explain|describe|show|what |how |why |when |where |who |tell me|can you explain|can i|should i|is it|do i need)/i;
  if (infoPattern.test(content.trim())) return false;
  // In coder/autonomous mode, treat any non-informational request as likely
  // needing tools. Brittle action-verb lists missed real edits (e.g. German
  // "füge … ein", "ergänze", "passe an"), so we default to true here and let the
  // specific correction conditions (code block present, claims a change, etc.)
  // decide whether to actually nudge.
  return true;
};

const KNOWN_TOOL_NAMES = new Set(AI_TOOLS.map(tool => tool.function.name));

// Detects when an assistant message *describes* a tool call in prose/code
// (e.g. `runCommand(x => readFile(...))`, `readFile(path)`, a ```block calling a
// tool) instead of actually issuing one. Used to nudge the model to perform the
// real call. Only meaningful when no real tool call was produced this turn.
const describesToolCallWithoutIssuing = (content: string, allowedNames: Set<string>): boolean => {
  if (!content) return false;
  for (const name of allowedNames) {
    if (new RegExp(`\\b${name}\\s*\\(`).test(content)) return true;
  }
  return false;
};

// Maps the tool names models commonly hallucinate / use from other agent
// frameworks onto this app's real tool names. Lets weaker models succeed even
// when they don't use the exact schema name (OpenCode-style robustness).
const TOOL_ALIASES: Record<string, string> = {
  createfile: 'writeFile', create_file: 'writeFile', create: 'writeFile',
  newfile: 'writeFile', new_file: 'writeFile', touch: 'writeFile',
  write: 'writeFile', write_file: 'writeFile', save: 'writeFile', savefile: 'writeFile',
  putfile: 'writeFile', create_or_update_file: 'writeFile',
  editfile: 'replaceInFile', edit_file: 'replaceInFile', edit: 'replaceInFile',
  modify: 'replaceInFile', modifyfile: 'replaceInFile', updatefile: 'replaceInFile',
  update_file: 'replaceInFile', replace: 'replaceInFile', replace_in_file: 'replaceInFile',
  str_replace: 'replaceInFile', str_replace_editor: 'replaceInFile', apply_patch: 'replaceInFile',
  patch: 'replaceInFile', applydiff: 'replaceInFile', apply_diff: 'replaceInFile',
  append: 'appendToFile', append_file: 'appendToFile', appendfile: 'appendToFile', append_to_file: 'appendToFile',
  read: 'readFile', read_file: 'readFile', readfile: 'readFile', cat: 'readFile',
  openfile: 'readFile', open_file: 'readFile', viewfile: 'readFile', view: 'readFile', getfile: 'readFile',
  bash: 'runCommand', shell: 'runCommand', sh: 'runCommand', cmd: 'runCommand',
  execute: 'runCommand', exec: 'runCommand', run: 'runCommand', run_command: 'runCommand',
  runterminalcommand: 'runCommand', terminal: 'runCommand', execute_command: 'runCommand',
  ls: 'listFiles', list: 'listFiles', list_files: 'listFiles', listdir: 'listFiles',
  list_directory: 'listFiles', listdirectory: 'listFiles', dir: 'listFiles',
  grep: 'searchFiles', search: 'searchWorkspace', search_files: 'searchFiles',
  searchcode: 'searchWorkspace', search_workspace: 'searchWorkspace', codebase_search: 'searchWorkspace',
  mkdir: 'createDirectory', makedirectory: 'createDirectory', make_directory: 'createDirectory',
  create_directory: 'createDirectory', createdir: 'createDirectory',
  rm: 'deleteFile', remove: 'deleteFile', delete: 'deleteFile', delete_file: 'deleteFile', removefile: 'deleteFile',
  mv: 'renameFile', move: 'renameFile', rename: 'renameFile', rename_file: 'renameFile', movefile: 'renameFile',
  find: 'findFile', findfile: 'findFile', glob: 'findFile', locate: 'findFile',
  diagnostics: 'getDiagnostics', get_diagnostics: 'getDiagnostics', lint: 'getDiagnostics', checkerrors: 'getDiagnostics'
};

// Resolves a possibly-aliased / mis-cased tool name to the real schema name.
const canonicalizeToolName = (name: string): string => {
  if (!name) return name;
  const stripped = name.includes('.') ? name.split('.').pop()! : name;
  if (KNOWN_TOOL_NAMES.has(stripped)) return stripped;
  const key = stripped.toLowerCase().replace(/[\s-]+/g, '_');
  if (TOOL_ALIASES[key]) return TOOL_ALIASES[key];
  const compact = key.replace(/_/g, '');
  return TOOL_ALIASES[compact] || stripped;
};

// Pull balanced {...} / [...] JSON substrings out of free text. Correctly skips
// over braces inside quoted strings and handles arbitrary nesting. Used to
// recover tool calls that models emit as plain text/JSON (in ```json fences,
// <tool_call> tags, or bare) instead of via the native tool_calls field.
const extractJsonCandidates = (text: string): string[] => {
  const results: string[] = [];
  let depth = 0;
  let start = -1;
  let opener = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') {
      if (depth === 0) { start = i; opener = ch; }
      depth += 1;
    } else if (ch === '}' || ch === ']') {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          results.push(text.slice(start, i + 1));
          start = -1;
          void opener;
        }
      }
    }
  }
  return results;
};

// Normalize one parsed object into { name, args } if it looks like a call to a
// known tool. Accepts OpenAI, ReAct and several common community formats:
//   {name, arguments}  {tool, parameters}  {function:{name, arguments}}
//   {tool_call:{...}}  {action, action_input}  {recipient_name, ...}
const normalizePseudoToolObject = (input: any): { name: string; args: string } | null => {
  let obj = input;
  if (!obj || typeof obj !== 'object') return null;
  if (obj.tool_call && typeof obj.tool_call === 'object') obj = obj.tool_call;
  if (obj.function_call && typeof obj.function_call === 'object') obj = obj.function_call;

  let name: unknown;
  let rawArgs: unknown;
  if (obj.function && typeof obj.function === 'object') {
    name = obj.function.name;
    rawArgs = obj.function.arguments ?? obj.function.parameters ?? obj.function.input;
  } else {
    name = obj.name ?? obj.tool ?? obj.tool_name ?? obj.action ?? obj.recipient_name;
    rawArgs = obj.arguments ?? obj.parameters ?? obj.args ?? obj.input ?? obj.action_input ?? obj.tool_input;
  }
  if (typeof name !== 'string' || !name) return null;
  // Resolve namespace prefixes and common aliases (e.g. "createFile" → writeFile).
  const cleanName = canonicalizeToolName(name);
  if (!KNOWN_TOOL_NAMES.has(cleanName)) return null;

  let args: string;
  if (typeof rawArgs === 'string') args = rawArgs;
  else if (rawArgs == null) args = '{}';
  else args = JSON.stringify(rawArgs);
  return { name: cleanName, args };
};

const extractPseudoToolCalls = (content: string): ToolCall[] => {
  if (!content) return [];
  const calls: ToolCall[] = [];
  const seen = new Set<string>();
  const pushCall = (name: string, args: string) => {
    if (!name) return;
    const key = `${name}:${args}`;
    if (seen.has(key)) return;
    seen.add(key);
    calls.push({ id: createId(), type: 'function', function: { name, arguments: args || '{}' } });
  };

  // 1) functionName({...}) call syntax, e.g. writeFile({"path": "a.txt"}).
  const fnPattern = /(?:functions?\.)?([A-Za-z_]\w*)\s*\(\s*(\{[\s\S]*?\})\s*\)/g;
  let fnMatch: RegExpExecArray | null;
  while ((fnMatch = fnPattern.exec(content)) !== null) {
    if (KNOWN_TOOL_NAMES.has(fnMatch[1])) pushCall(fnMatch[1], fnMatch[2]);
  }

  // 2) Any balanced JSON object/array in the text. This single pass covers
  //    ```json fences, <tool_call> tags, bare JSON and arrays of calls. Gated on
  //    a known tool name so ordinary code/JSON the model writes is ignored.
  for (const jsonStr of extractJsonCandidates(content)) {
    let parsed: any;
    try { parsed = JSON.parse(jsonStr); } catch { continue; }
    const candidates = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.tool_calls)
        ? parsed.tool_calls
        : [parsed];
    for (const candidate of candidates) {
      const normalized = normalizePseudoToolObject(candidate);
      if (normalized) pushCall(normalized.name, normalized.args);
    }
  }

  return calls;
};

// Removes tool-call JSON/fences/tags from assistant text so the user sees prose,
// not the raw call, once we've extracted and executed it.
const stripToolCallArtifacts = (content: string): string => {
  if (!content) return content;
  let out = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
  // Drop fenced blocks whose body parses to a known tool call.
  out = out.replace(/```[a-zA-Z_]*\s*([\s\S]*?)\s*```/g, (match, inner) => {
    try {
      const parsed = JSON.parse(String(inner).trim());
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      if (arr.some(p => normalizePseudoToolObject(p))) return '';
    } catch { /* keep non-JSON code blocks */ }
    return match;
  });
  // Drop any remaining bare JSON objects that are tool calls.
  for (const jsonStr of extractJsonCandidates(out)) {
    try {
      const parsed = JSON.parse(jsonStr);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      if (arr.some(p => normalizePseudoToolObject(p))) out = out.replace(jsonStr, '');
    } catch { /* ignore */ }
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
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

const basenameLower = (value: string) =>
  normalizeTrackedPath(value).split('/').pop() || '';

interface CompletionResult {
  content: string;
  reasoning?: string;
  finishReason?: string;
  toolCalls?: ToolCall[];
  reasoningOnly?: boolean;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

// Parses the planning model output into a { title, steps } object. Accepts the
// preferred JSON shape ({"title","steps":[...]}) and falls back to bullet /
// numbered markdown lists so weaker models still produce a usable plan.
function parsePlanOutput(text: string): { title: string; steps: string[] } | null {
  const raw = (text || '').trim();
  const unfenced = raw.replace(/```(?:json)?/gi, '').trim();

  const start = unfenced.indexOf('{');
  if (start >= 0) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < unfenced.length; i += 1) {
      const ch = unfenced[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') {
        inStr = true;
      } else if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const obj = JSON.parse(unfenced.slice(start, i + 1));
            const steps = Array.isArray(obj.steps)
              ? obj.steps.map((s: unknown) => String(s).trim()).filter(Boolean)
              : [];
            if (steps.length) {
              return { title: String(obj.title || 'Plan').trim() || 'Plan', steps: steps.slice(0, 12) };
            }
          } catch {
            /* fall through to list parsing */
          }
          break;
        }
      }
    }
  }

  const steps = unfenced
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^[-*]\s+/, '').replace(/^\d+[.)]\s+/, '').trim())
    .filter(line => line && !/^(title|plan)\s*[:=]/i.test(line));
  if (steps.length) {
    return { title: 'Plan', steps: steps.slice(0, 12) };
  }
  return null;
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
  describedToolCallCorrectionSent: boolean;
  lastNormalizedResponse?: string;
  repeatedResponseCount: number;
  executedTools: ExecutedToolRecord[];
  replaceReReadRequiredPaths: string[];
  nonMutatingToolRounds: number;
  completionWithoutMutationCorrectionSent: boolean;
  autoFixRounds: number;
  consecutiveEmptyResponses: number;
  lastToolRoundSignature?: string;
  repeatedToolRoundCount: number;
  todoIncompleteCorrectionSent: boolean;
}

export interface StreamingDraft {
  content: string;
  reasoning: string;
}

/**
 * Consume an OpenAI-compatible SSE chat-completion stream and reassemble it
 * into the same payload shape a non-streaming response would have, emitting
 * throttled partial-text updates along the way. Tool-call deltas are
 * accumulated per index (arguments arrive as string fragments).
 */
async function consumeChatCompletionStream(
  response: Response,
  onDelta: (draft: StreamingDraft) => void,
  resetIdleTimer: () => void
): Promise<any> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Streaming response has no readable body');
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';
  let finishReason: string | undefined;
  let usage: any;
  let lastEmit = 0;
  const toolCallsByIndex = new Map<number, { id?: string; name: string; arguments: string }>();

  // Returns true when the stream signalled completion ([DONE]).
  const handleLine = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return false;
    const data = trimmed.slice(5).trim();
    if (data === '[DONE]') return true;
    let parsed: any;
    try {
      parsed = JSON.parse(data);
    } catch {
      return false;
    }
    if (parsed?.usage) usage = parsed.usage;
    const choice = parsed?.choices?.[0];
    if (!choice) return false;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta || {};
    if (typeof delta.content === 'string') content += delta.content;
    const deltaReasoning =
      typeof delta.reasoning_content === 'string'
        ? delta.reasoning_content
        : typeof delta.reasoning === 'string'
          ? delta.reasoning
          : '';
    if (deltaReasoning) reasoning += deltaReasoning;
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const index = typeof tc?.index === 'number' ? tc.index : 0;
        const entry = toolCallsByIndex.get(index) || { name: '', arguments: '' };
        if (tc?.id) entry.id = tc.id;
        if (tc?.function?.name && !entry.name) entry.name = tc.function.name;
        if (typeof tc?.function?.arguments === 'string') entry.arguments += tc.function.arguments;
        toolCallsByIndex.set(index, entry);
      }
    }
    return false;
  };

  let streamFinished = false;
  while (!streamFinished) {
    const { done, value } = await reader.read();
    if (done) break;
    resetIdleTimer();
    buffer += decoder.decode(value, { stream: true });
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      if (handleLine(line)) streamFinished = true;
    }
    const now = Date.now();
    if (now - lastEmit > 80 && (content || reasoning)) {
      lastEmit = now;
      onDelta({ content, reasoning });
    }
  }
  if (buffer.trim()) handleLine(buffer);
  if (content || reasoning) onDelta({ content, reasoning });

  const toolCalls = Array.from(toolCallsByIndex.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, entry]) => ({
      id: entry.id,
      type: 'function' as const,
      function: { name: entry.name, arguments: entry.arguments }
    }))
    .filter(tc => tc.function.name);

  return {
    choices: [
      {
        message: {
          content,
          reasoning_content: reasoning || undefined,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {})
        },
        finish_reason: finishReason
      }
    ],
    usage
  };
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
        const parsed = JSON.parse(stored);
        const merged: AISettings = {
          ...defaultSettings,
          ...parsed,
          baseUrl: sanitizeBaseUrl(parsed.baseUrl ?? defaultSettings.baseUrl)
        };
        // Migration: bump the old coding-hostile sampling defaults forward for
        // users who never changed them (leave any custom value untouched).
        if (parsed.temperature === LEGACY_DEFAULT_TEMPERATURE) {
          merged.temperature = DEFAULT_TEMPERATURE;
        }
        if (parsed.maxTokens === LEGACY_DEFAULT_MAX_TOKENS) {
          merged.maxTokens = DEFAULT_MAX_TOKENS;
        }
        // Migration: ensure at least one profile exists; if the stored data
        // predates profiles, seed the first one from the user's current config.
        if (!Array.isArray(merged.profiles) || merged.profiles.length === 0) {
          merged.profiles = [
            { id: DEFAULT_LOCAL_PROFILE_ID, name: 'Local 1', kind: 'local', baseUrl: merged.baseUrl, model: merged.model, apiKey: merged.apiKey || '' }
          ];
        }
        if (!merged.activeProfileId || !merged.profiles.some(p => p.id === merged.activeProfileId)) {
          merged.activeProfileId = merged.profiles[0].id;
        }
        return merged;
      }
    } catch (error) {
      console.warn('Failed to parse stored AI settings', error);
    }
    return defaultSettings;
  });

  const [conversations, setConversations] = useState<Conversation[]>(() => loadStoredConversations());
  const [activeConversationId, setActiveConversationId] = useState(() => conversations[0]?.id ?? '');
  const [models, setModels] = useState<string[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [lastError, setLastError] = useState<string | undefined>();
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'ready' | 'error'>('idle');
  const [toolStatus, setToolStatus] = useState<string | undefined>();
  const [toolCallSupported, setToolCallSupported] = useState<ToolCallSupport>('unknown');
  const [modelClassifications, setModelClassifications] = useState<Record<string, ModelClassification>>({});
  const [pendingToolApprovals, setPendingToolApprovals] = useState<PendingToolApproval[]>([]);
  const [pendingPlanApproval, setPendingPlanApproval] = useState<PendingPlanApproval | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const basePromptRef = useRef<string>(DEFAULT_BASE_PROMPT);
  const projectPathRef = useRef(projectPath);
  const modelMetadataRef = useRef<Map<string, any>>(new Map());
  // Live-probe verdicts persist across sessions, keyed by `${baseUrl}::${model}`,
  // so we never re-probe a model we've already classified.
  const toolSupportCacheRef = useRef<Map<string, ToolCallSupport>>(loadToolSupportCache());
  // Mirror of `toolCallSupported` for the currently selected model, readable from
  // inside performCompletion without adding it to that callback's deps.
  const toolSupportRef = useRef<ToolCallSupport>('unknown');
  // Whether the server accepts `stream: true` / `stream_options` — downgraded
  // at runtime when a server rejects them, so we only pay one failed request.
  const streamSupportRef = useRef<boolean | 'unknown'>('unknown');
  const streamUsageOptionRef = useRef<boolean | 'unknown'>('unknown');
  // Live partial text of the in-flight completion (streamed deltas).
  const [streamingDraft, setStreamingDraft] = useState<StreamingDraft | null>(null);
  // Live todo/progress list the model maintains via the updateTodoList tool.
  const [agentTodos, setAgentTodos] = useState<TodoItem[]>([]);
  const agentTodosRef = useRef<TodoItem[]>([]);
  // Token usage of the last completed turn (summed over all loop rounds).
  const [lastTurnTokens, setLastTurnTokens] = useState<{ prompt: number; completion: number; total: number } | undefined>();
  const turnTokensRef = useRef<{ prompt: number; completion: number; total: number }>({ prompt: 0, completion: 0, total: 0 });
  const pendingToolExecutionRef = useRef<Map<string, PendingToolExecutionState>>(new Map());
  // Holds the prepared agent-loop state for a drafted plan until the user
  // approves/rejects it (or it auto-approves).
  const pendingPlanExecutionRef = useRef<Map<string, { state: AgentLoopState; rawContent: string; title: string; steps: PlanStep[] }>>(new Map());

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

  // Persist conversations so chat history survives an app restart.
  useEffect(() => {
    persistConversations(conversations);
  }, [conversations]);

  const updateSettings = useCallback((patch: Partial<AISettings>) => {
    setSettings(prev => {
      const next: AISettings = {
        ...prev,
        ...patch,
        baseUrl: patch.baseUrl ? sanitizeBaseUrl(patch.baseUrl) : prev.baseUrl
      };
      // Keep the active profile's connection fields in sync when the user edits
      // baseUrl/model/apiKey directly, so the change persists with that profile.
      if (
        (patch.baseUrl !== undefined || patch.model !== undefined || patch.apiKey !== undefined) &&
        patch.profiles === undefined &&
        next.activeProfileId
      ) {
        next.profiles = next.profiles.map(p =>
          p.id === next.activeProfileId
            ? { ...p, baseUrl: next.baseUrl, model: next.model, apiKey: next.apiKey || '' }
            : p
        );
      }
      return next;
    });
  }, []);

  const saveProfile = useCallback((profile: AIProfile) => {
    setSettings(prev => {
      const exists = prev.profiles.some(p => p.id === profile.id);
      const normalized: AIProfile = { ...profile, baseUrl: sanitizeBaseUrl(profile.baseUrl) };
      const profiles = exists
        ? prev.profiles.map(p => (p.id === profile.id ? normalized : p))
        : [...prev.profiles, normalized];
      // If the edited profile is the active one, reflect its config live.
      if (profile.id === prev.activeProfileId) {
        return { ...prev, profiles, baseUrl: normalized.baseUrl, model: normalized.model, apiKey: normalized.apiKey || '' };
      }
      return { ...prev, profiles };
    });
  }, []);

  const deleteProfile = useCallback((id: string) => {
    setSettings(prev => {
      if (prev.profiles.length <= 1) return prev; // always keep one
      const profiles = prev.profiles.filter(p => p.id !== id);
      if (prev.activeProfileId === id) {
        const fallback = profiles[0];
        return { ...prev, profiles, activeProfileId: fallback.id, baseUrl: fallback.baseUrl, model: fallback.model, apiKey: fallback.apiKey || '' };
      }
      return { ...prev, profiles };
    });
  }, []);

  const selectProfile = useCallback((id: string) => {
    setSettings(prev => {
      const profile = prev.profiles.find(p => p.id === id);
      if (!profile) return prev;
      return {
        ...prev,
        activeProfileId: id,
        baseUrl: sanitizeBaseUrl(profile.baseUrl),
        model: profile.model,
        apiKey: profile.apiKey || ''
      };
    });
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

      // Enrich with native Ollama capabilities when available — the most
      // authoritative source for local tool/vision support.
      const ollamaMeta = await fetchOllamaCapabilities(baseUrl, fetched);
      if (ollamaMeta) {
        ollamaMeta.forEach((meta, id) => {
          const existing = fetchedMetadata.get(id) || {};
          fetchedMetadata.set(id, { ...existing, ...meta });
        });
      }
      modelMetadataRef.current = fetchedMetadata;

      // Classify every model once (catalog + heuristic + metadata), then let any
      // cached live-probe verdict override an 'unknown'.
      const classifications: Record<string, ModelClassification> = {};
      for (const id of fetched) {
        const classification = classifyModel(id, fetchedMetadata.get(id));
        if (classification.toolSupport === 'unknown') {
          const cached = toolSupportCacheRef.current.get(toolSupportCacheId(baseUrl, id));
          if (cached === true || cached === false) {
            classification.toolSupport = cached;
            classification.reason = cached
              ? 'Per Live-Test bestätigt – Tool-Support.'
              : 'Per Live-Test bestätigt – kein Tool-Support.';
          }
        }
        classifications[id] = classification;
      }
      setModelClassifications(classifications);

      setModels(fetched);
      setConnectionStatus('ready');
      setLastError(undefined);
      setToolCallSupported(prev => (settings.model ? prev : 'unknown'));

      // Prefer keeping the current model; otherwise default to the first
      // tool-capable model so the agent works out of the box.
      setSettings(prev => {
        if (prev.model && fetched.includes(prev.model)) {
          return prev;
        }
        const firstToolCapable = fetched.find(id => classifications[id]?.toolSupport === true);
        const firstChat = fetched.find(id => (classifications[id]?.kind ?? 'chat') === 'chat');
        return { ...prev, model: firstToolCapable || firstChat || fetched[0] };
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

  // Centralizes a verdict: updates the live state, the ref read by the
  // completion path, the per-model classification map, and the persisted cache.
  const recordToolSupport = useCallback(
    (model: string, baseUrl: string, verdict: ToolCallSupport, reason?: string) => {
      setToolCallSupported(verdict);
      toolSupportRef.current = verdict;
      setModelClassifications(prev => {
        const existing = prev[model];
        if (existing && existing.toolSupport === verdict) return prev;
        const base = existing ?? classifyModel(model, modelMetadataRef.current.get(model));
        return { ...prev, [model]: { ...base, toolSupport: verdict, reason: reason ?? base.reason } };
      });
      if (verdict === true || verdict === false) {
        toolSupportCacheRef.current.set(toolSupportCacheId(baseUrl, model), verdict);
        saveToolSupportCache(toolSupportCacheRef.current);
      }
    },
    []
  );

  const checkToolCallSupport = useCallback(async (): Promise<ToolCallSupport> => {
    const selectedModel = settings.model?.trim();
    const baseUrl = sanitizeBaseUrl(settings.baseUrl);
    if (!selectedModel) {
      recordToolSupport('', baseUrl, 'unknown');
      return 'unknown';
    }

    // 1) Persisted live-probe verdict wins (survives restarts).
    const cached = toolSupportCacheRef.current.get(toolSupportCacheId(baseUrl, selectedModel));
    if (cached === true || cached === false) {
      recordToolSupport(selectedModel, baseUrl, cached);
      return cached;
    }

    // 2) Catalog + metadata + heuristic.
    const inferred = inferToolCallSupportFromModel(
      selectedModel,
      modelMetadataRef.current.get(selectedModel)
    );
    if (inferred === true || inferred === false) {
      recordToolSupport(selectedModel, baseUrl, inferred);
      return inferred;
    }

    // 3) Live probe as the final arbiter for 'unknown' models.
    try {
      const testController = new AbortController();
      const timeoutId = setTimeout(() => testController.abort(), 5000);

      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        signal: testController.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: selectedModel,
          temperature: 0,
          max_tokens: 10,
          messages: [
            {
              role: 'user',
              content: 'Test'
            }
          ],
          tools: [
            {
              type: 'function',
              function: {
                name: 'test',
                description: 'Test function',
                parameters: {
                  type: 'object',
                  properties: {},
                  additionalProperties: false
                }
              }
            }
          ],
          tool_choice: 'none'
        })
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const lower = errorText.toLowerCase();

        // Check for explicit tool-related errors
        if (
          lower.includes('tool') ||
          lower.includes('function call') ||
          lower.includes('function calling') ||
          lower.includes('does not support') ||
          lower.includes('not supported')
        ) {
          recordToolSupport(selectedModel, baseUrl, false, 'Per Live-Test bestätigt – kein Tool-Support.');
          return false;
        }

        // Other errors don't tell us about tool support
        recordToolSupport(selectedModel, baseUrl, 'unknown');
        return 'unknown';
      }

      // If the request succeeded with tools parameter, the model supports tools
      const payload = await response.json();

      // Check if response has tool_calls field (even if empty)
      const choice = payload?.choices?.[0];
      if (choice?.message && ('tool_calls' in choice.message)) {
        recordToolSupport(selectedModel, baseUrl, true, 'Per Live-Test bestätigt – Tool-Support.');
        return true;
      }

      // If no error and request went through, assume support
      recordToolSupport(selectedModel, baseUrl, true, 'Per Live-Test bestätigt – Tool-Support.');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Timeout or network error - can't determine
      if (message.includes('abort') || message.includes('timeout')) {
        recordToolSupport(selectedModel, baseUrl, 'unknown');
        return 'unknown';
      }

      console.warn('Failed to verify tool calling support', error);
      recordToolSupport(selectedModel, baseUrl, 'unknown');
      return 'unknown';
    }
  }, [settings.apiKey, settings.baseUrl, settings.model, recordToolSupport]);

  useEffect(() => {
    if (settings.model) {
      checkToolCallSupport();
    }
  }, [settings.model]);

  // Keep the ref used inside performCompletion in lock-step with the state,
  // regardless of which code path updated the verdict.
  useEffect(() => {
    toolSupportRef.current = toolCallSupported;
  }, [toolCallSupported]);

  // A different server may support streaming again — re-probe after switching.
  useEffect(() => {
    streamSupportRef.current = 'unknown';
    streamUsageOptionRef.current = 'unknown';
  }, [settings.baseUrl]);

  // Receive live todo-list updates from the updateTodoList tool executor.
  useEffect(() => {
    setTodoUpdateListener(items => {
      agentTodosRef.current = items;
      setAgentTodos(items);
    });
    return () => setTodoUpdateListener(null);
  }, []);

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
    // Discard any plan still awaiting approval so the run doesn't resume later.
    if (pendingPlanExecutionRef.current.size > 0) {
      pendingPlanExecutionRef.current.forEach(entry => {
        try { entry.state.controller.abort(); } catch { /* noop */ }
      });
      pendingPlanExecutionRef.current.clear();
      setPendingPlanApproval(null);
      setToolStatus(undefined);
      setIsThinking(false);
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
              image_url: { url: img.dataUrl, detail: settings.visionDetail || 'auto' }
            });
          }
          if (textContent) {
            parts.push({ type: 'text', text: textContent });
          }
          return { role, content: parts };
        }

        return { role, content: textContent };
      });
  }, [settings.visionDetail]);

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
    let conversationMessages = messages.filter((m: any) => m.role !== 'system');

    if (conversationMessages.length <= 4) return messages;

    // First shrink stale tool outputs instead of dropping whole messages: keep
    // the most recent messages verbatim, truncate older bulky tool results.
    // This preserves the conversation structure (assistant tool_calls keep
    // their matching tool replies) while freeing most of the budget.
    const KEEP_FULL_TAIL = 8;
    conversationMessages = conversationMessages.map((msg: any, index: number) => {
      if (msg.role !== 'tool') return msg;
      if (index >= conversationMessages.length - KEEP_FULL_TAIL) return msg;
      const text = typeof msg.content === 'string' ? msg.content : '';
      if (text.length <= 1200) return msg;
      return {
        ...msg,
        content: `${text.slice(0, 600)}\n…[older tool result truncated to save context — re-run the tool if you need the full output]`
      };
    });

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
      onDelta?: (draft: StreamingDraft) => void
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
        ...resolveSampling(settings),
        max_tokens: settings.maxTokens,
        messages: finalMessages
      };

      // Tools are "active" for this turn when the mode wants them. We only send
      // the NATIVE tools/tool_choice params when the model isn't known to reject
      // them — for models that explicitly lack tool support we fall back to the
      // prompt-injected tool protocol (recovered from text below), which lets
      // even weak models drive the agent loop.
      const toolsActive = useTools && settings.toolsEnabled;
      const useNativeTools = toolsActive && toolSupportRef.current !== false;
      if (useNativeTools) {
        body.tools = getToolsForMode(settings);
        body.tool_choice = toolChoice;
      }

      let payload: any;
      let lastAttemptError: Error | null = null;

      for (let attempt = 1; attempt <= COMPLETION_MAX_RETRIES; attempt += 1) {
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        // Stream when the caller wants live deltas and the server hasn't
        // rejected streaming before. With streaming the timeout is an IDLE
        // timeout (reset on every chunk), so slow local models can generate
        // long answers without being cut off mid-response.
        const attemptStream = typeof onDelta === 'function' && streamSupportRef.current !== false;
        if (attemptStream) {
          body.stream = true;
          if (streamUsageOptionRef.current !== false) {
            body.stream_options = { include_usage: true };
          } else {
            delete body.stream_options;
          }
        } else {
          delete body.stream;
          delete body.stream_options;
        }

        const attemptController = new AbortController();
        let timeoutId = setTimeout(() => attemptController.abort(), COMPLETION_REQUEST_TIMEOUT_MS);
        const resetIdleTimer = () => {
          clearTimeout(timeoutId);
          timeoutId = setTimeout(() => attemptController.abort(), COMPLETION_REQUEST_TIMEOUT_MS);
        };
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

            // A model we didn't flag rejected the sampling params (some
            // reasoning models only allow their fixed temperature). Strip them
            // and retry instead of failing the turn.
            if (
              ('temperature' in body || 'top_p' in body) &&
              /temperature|top[_-]?p|sampling/i.test(message)
            ) {
              delete body.temperature;
              delete body.top_p;
              lastAttemptError = new Error(message);
              continue;
            }

            // Some servers accept `stream` but reject `stream_options`; others
            // reject streaming altogether. Downgrade gracefully and retry
            // instead of failing the turn.
            if (attemptStream && /stream_options/i.test(message)) {
              streamUsageOptionRef.current = false;
              lastAttemptError = new Error(message);
              continue;
            }
            if (attemptStream && /\bstream/i.test(message)) {
              streamSupportRef.current = false;
              lastAttemptError = new Error(message);
              continue;
            }

            // A model we believed was tool-capable rejected the native tools
            // params. Drop them, mark the model as no-native-tools (so the prompt
            // protocol takes over) and retry instead of failing the turn.
            if (body.tools && /tool|function[\s_-]?call|does not support|not supported|unsupported/i.test(message)) {
              delete body.tools;
              delete body.tool_choice;
              toolSupportRef.current = false;
              recordToolSupport(
                settings.model,
                sanitizeBaseUrl(settings.baseUrl),
                false,
                'Server lehnte native Tools ab – Prompt-Fallback aktiv.'
              );
              lastAttemptError = new Error(message);
              continue;
            }

            if (attempt < COMPLETION_MAX_RETRIES && shouldRetryCompletionRequest(response.status, message)) {
              lastAttemptError = new Error(message);
              await delay(Math.min(500 * Math.pow(2, attempt - 1), 5000));
              continue;
            }
            throw new Error(message);
          }

          payload = attemptStream
            ? await consumeChatCompletionStream(response, onDelta!, resetIdleTimer)
            : await response.json();
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
      let displayContent = aiContent;
      if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
        toolCalls = rawToolCalls.map((tc: any) => ({
          id: tc.id || createId(),
          type: 'function' as const,
          function: {
            name: canonicalizeToolName(tc.function?.name || ''),
            arguments: tc.function?.arguments || '{}'
          }
        }));
      } else if (toolsActive) {
        // Recover tool calls models emit as text/JSON instead of via the native
        // tool_calls field, then strip that JSON from the displayed prose.
        const pseudoToolCalls = extractPseudoToolCalls(rawContent);
        if (pseudoToolCalls.length > 0) {
          toolCalls = pseudoToolCalls;
          displayContent = sanitizeAssistantContent(stripToolCallArtifacts(rawContent));
        }
      }

      if (!displayContent && !reasoningContent && !toolCalls?.length) {
        // Return empty so the agent loop can re-prompt instead of crashing
        return { content: '', finishReason: choice?.finish_reason, toolCalls: undefined, usage: payload?.usage };
      }

      return {
        content: displayContent,
        reasoning: reasoningContent,
        finishReason: choice?.finish_reason,
        reasoningOnly: isReasoningOnly,
        toolCalls,
        usage: payload?.usage
      };
    },
    [settings, recordToolSupport]
  );

  const buildSystemMessages = useCallback(
    async (injectSystemPrompt?: string, includeBasePrompt: boolean = true) => {
      const systemMessages: Array<{ role: string; content: string }> = [];
      const basePrompt = includeBasePrompt ? await loadBasePrompt() : '';
      if (basePrompt) {
        systemMessages.push({ role: 'system', content: basePrompt });
      }
      // Tell the model HOW to invoke tools based on whether the selected model
      // actually does native tool calls. For non-native models the protocol
      // explains the JSON-block format we parse back into real calls — without
      // this they tend to emit pseudo-code instead of a usable call.
      const nativeTools = settings.toolsEnabled && toolSupportRef.current !== false;
      systemMessages.push({ role: 'system', content: createRuntimeModePrompt(settings, nativeTools) });
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

  // A tool-enabled headless agent used for sub-agents. Unlike requestCompletion
  // (single-shot, no tools) it runs a real read/act loop with the tool set, but
  // without touching the visible conversation UI. Returns the final text.
  const runHeadlessAgent = useCallback(
    async (
      task: string,
      systemPrompt: string,
      signal: AbortSignal,
      onProgress?: (status: string) => void
    ): Promise<string> => {
      if (!settings.model) return 'No model configured.';
      const systemMessages = await buildSystemMessages(systemPrompt, true);
      let apiMessages: any[] = [...systemMessages, { role: 'user', content: task }];
      const useTools = settings.toolsEnabled;
      let combined = '';
      const MAX_SUBAGENT_LOOPS = 20;

      for (let loop = 0; loop < MAX_SUBAGENT_LOOPS; loop += 1) {
        if (signal.aborted) break;
        const pruned = pruneApiMessages(apiMessages);
        if (pruned.length < apiMessages.length) apiMessages = pruned;

        const result = await performCompletion(apiMessages, signal, useTools, 'auto');

        if (result.toolCalls && result.toolCalls.length > 0) {
          apiMessages.push(buildAssistantToolMessage(result.toolCalls, result.content));
          const toolResults: ToolResult[] = [];
          for (const tc of result.toolCalls) {
            if (signal.aborted) break;
            onProgress?.(summarizeToolCall(tc));
            const tr = await executeToolCall(tc, projectPathRef.current, {
              signal,
              requestId: `subagent:${tc.id}`
            });
            toolResults.push(tr);
          }
          apiMessages.push(
            ...toolResults.map(tr => ({ role: 'tool', tool_call_id: tr.tool_call_id, content: tr.content }))
          );
          continue;
        }

        if (result.content) {
          combined += combined ? `\n\n${result.content}` : result.content;
          // No tool calls and we have prose → the sub-agent is done.
          break;
        }

        // Empty round — nudge once, then bail to avoid spinning.
        apiMessages.push({ role: 'user', content: 'Continue and complete the task, then give your final answer.' });
      }

      return combined.trim() || 'Sub-agent finished without a textual result.';
    },
    [buildSystemMessages, performCompletion, pruneApiMessages, settings.model, settings.toolsEnabled]
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
            forceToolChoice ? 'required' : 'auto',
            draft => setStreamingDraft(draft)
          );
          setStreamingDraft(null);

          // Accumulate token usage across the turn's rounds for the UI meter.
          if (result.usage) {
            const u = result.usage;
            turnTokensRef.current = {
              prompt: turnTokensRef.current.prompt + (u.prompt_tokens || 0),
              completion: turnTokensRef.current.completion + (u.completion_tokens || 0),
              total: turnTokensRef.current.total + (u.total_tokens || (u.prompt_tokens || 0) + (u.completion_tokens || 0))
            };
            setLastTurnTokens({ ...turnTokensRef.current });
          }

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
            // Note: readFile without an explicit line range is allowed — the
            // executor auto-chunks large files and reports how to continue, so
            // forcing a range here only confused weaker models.
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

            // Dangerous shell commands (rm -rf, disk format, force push, etc.)
            // ALWAYS require explicit approval — even in YOLO mode — so a model
            // mistake can't irreversibly wipe data unattended.
            const hasDangerousCommand = toolCalls.some(tc => isDangerousToolCall(tc));
            if (
              hasDangerousCommand ||
              (!settings.yoloMode && toolCalls.some(tc => toolNeedsApproval(tc.function.name)))
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

            // Run all-read-only batches in parallel for speed
            const allReadOnly = toolCalls.every(tc => READ_ONLY_TOOL_NAMES.has(tc.function.name));

            if (allReadOnly && toolCalls.length > 1) {
              setToolStatus(`Running ${toolCalls.length} read-only tools...`);
              updateToolMessage(currentState.conversationId, toolMessage.id, current =>
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
              updateToolMessage(currentState.conversationId, toolMessage.id, current =>
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

            // Generic loop guard: the exact same tool calls returning the exact
            // same results means zero progress — nudge once, then stop.
            const roundSignature = JSON.stringify({
              calls: toolCalls.map(tc => `${tc.function.name}|${tc.function.arguments}`),
              results: toolResults.map(tr => tr.content.slice(0, 400))
            });
            if (roundSignature === currentState.lastToolRoundSignature) {
              currentState.repeatedToolRoundCount += 1;
              if (currentState.repeatedToolRoundCount >= 2) {
                currentState.stopReason = 'Stopped: repeated identical tool calls without progress.';
                currentState.combinedContent +=
                  (currentState.combinedContent ? '\n\n' : '') +
                  'Ich habe abgebrochen, weil dieselben Tool-Aufrufe mehrfach ohne Fortschritt wiederholt wurden. Bitte gib einen konkreteren nächsten Schritt vor.';
                break;
              }
              currentState.apiMessages = [
                ...currentState.apiMessages,
                {
                  role: 'user',
                  content:
                    'You just repeated the exact same tool call(s) and received the exact same result. Do NOT run them again — change your approach: use different arguments, a different tool, or state the blocker and finish.'
                }
              ];
              setToolStatus(undefined);
              continue;
            }
            currentState.lastToolRoundSignature = roundSignature;
            currentState.repeatedToolRoundCount = 0;

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

              // Collect the files actually mutated this round. We only want to
              // report errors the model just introduced — surfacing unrelated
              // pre-existing errors elsewhere in the project would derail the
              // agent into fixing things the user never asked about.
              const editedFullPaths = new Set<string>();
              const editedBasenames = new Set<string>();
              const mutatedPaths = new Set<string>(); // non-TS/JS, for syntax checks
              for (let ti = 0; ti < toolCalls.length; ti++) {
                const tc = toolCalls[ti];
                if (!MUTATING_TOOL_NAMES.has(tc.function.name)) continue;
                if (toolResults[ti]?.content?.startsWith('Error')) continue;
                const tcArgs = safeJsonParse(tc.function.arguments || '{}');
                const tcPath = String(tcArgs.path || tcArgs.newPath || '');
                if (!tcPath) continue;
                const fullPath = resolveToolTargetPath(tcPath, projectPathRef.current);
                editedFullPaths.add(normalizeTrackedPath(fullPath));
                editedBasenames.add(basenameLower(tcPath));
                const ext = (tcPath.match(/\.[^.\\/:]+$/) || [''])[0].toLowerCase();
                if (!MONACO_VALIDATED_EXTENSIONS.has(ext)) {
                  mutatedPaths.add(fullPath);
                }
              }

              // 1) Monaco diagnostics (TS/JS) — scoped to the edited files only
              const monacoErrors = getErrorDiagnostics().filter(d => {
                const norm = normalizeTrackedPath(d.file);
                return editedFullPaths.has(norm) || editedBasenames.has(basenameLower(d.file));
              });
              for (const d of monacoErrors.slice(0, 10)) {
                allErrorLines.push(`[ERROR] ${d.file}:${d.startLine}:${d.startColumn} - ${d.message}${d.code ? ` (${d.code})` : ''}`);
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

            // Text-pattern "you didn't really call a tool" nudges are only for
            // prompt-fallback models (no native tool calling). On models with
            // native tools these heuristics mostly misfire — they interrupt a
            // capable model that is legitimately discussing or explaining code —
            // so we skip them entirely there.
            const promptFallback = toolSupportRef.current === false;

            if (
              promptFallback &&
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

            // The model wrote something that *looks like* a tool call (e.g.
            // `runCommand(x => readFile(...))` or a code block calling a tool) but
            // didn't actually issue one — so nothing ran. Nudge it to perform the
            // real call, using the format that matches the active model.
            if (
              promptFallback &&
              settings.toolsEnabled &&
              !currentState.describedToolCallCorrectionSent &&
              describesToolCallWithoutIssuing(
                result.content,
                new Set(getToolsForMode(settings).map(tool => tool.function.name))
              )
            ) {
              currentState.describedToolCallCorrectionSent = true;
              const nativeTools = toolCallSupported !== false;
              currentState.apiMessages = [
                ...currentState.apiMessages,
                { role: 'assistant', content: result.content },
                {
                  role: 'user',
                  content: nativeTools
                    ? 'You described a tool call in text/code but did NOT actually call any tool, so nothing ran and you have no result. Stop describing — issue a REAL tool call now (e.g. call readFile with {"path":"<file>"}), then answer from the returned result.'
                    : 'You described a tool call in text/code but did not output a usable call, so nothing ran. To actually run a tool, reply with ONLY this json block and literal values (no pseudo-code, no arrow functions):\n```json\n{"tool": "readFile", "arguments": {"path": "<file>"}}\n```'
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
            // As above, these "you claimed/showed a change but didn't call a
            // tool" nudges are prompt-fallback-only. Native-tool models are
            // trusted to act via real calls; nudging them here mostly derails
            // legitimate explanations.
            const promptFallbackContent = toolSupportRef.current === false;

            if (
              promptFallbackContent &&
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
                  content: toolCallSupported !== false
                    ? 'You have not modified any file yet. If you intend to change files, issue a real tool call (writeFile/appendToFile/replaceInFile) first. Otherwise answer without claiming a file change.'
                    : 'You have not modified any file yet. If you intend to change files, output a json tool-call block (e.g. {"tool": "replaceInFile", "arguments": {...}}) first. Otherwise answer without claiming a file change.'
                }
              ];
              continue;
            }

            if (
              promptFallbackContent &&
              settings.toolsEnabled &&
              settings.mode !== 'qa' &&
              !currentState.performedMutationTool &&
              !currentState.mutationCorrectionSent &&
              containsCodeBlockThatShouldBeWritten(result.content)
            ) {
              currentState.mutationCorrectionSent = true;
              const nativeTools = toolCallSupported !== false;
              currentState.apiMessages = [
                ...currentState.apiMessages,
                { role: 'assistant', content: result.content },
                {
                  role: 'user',
                  content: nativeTools
                    ? 'Outputting the code as a chat code block does NOT change the file — nothing was written. Apply it now with a real tool call: appendToFile to add to the end, replaceInFile for a targeted change, or writeFile for a full rewrite. Read the file first if you need its current content.'
                    : 'Outputting the code as a chat code block does NOT change the file — nothing was written. To actually write it, reply with ONLY a json tool-call block and literal values, e.g.:\n```json\n{"tool": "appendToFile", "arguments": {"path": "<file>", "content": "<exact code to add>"}}\n```\nUse replaceInFile for a targeted change or writeFile for a full rewrite.'
                }
              ];
              continue;
            }

            if (
              promptFallbackContent &&
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
                  content: toolCallSupported !== false
                    ? 'Do not describe what you will do. Execute the action now by issuing a real tool call.'
                    : 'Do not describe what you will do. Execute the action now by outputting a json tool-call block (e.g. {"tool": "readFile", "arguments": {"path": "<file>"}}).'
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

          // Final safety net: the run is about to end without any file mutation.
          // Only nudge when the conversation actually shows mutation intent/claims
          // — otherwise a read-only answer (e.g. listFiles, an explanation) would
          // be wrongly flagged as an incomplete change.
          const finalText = currentState.combinedContent || '';
          const showsMutationIntent =
            settings.mode !== 'qa' &&
            (containsCodeBlockThatShouldBeWritten(finalText) ||
              claimsFileMutationWithoutTool(finalText) ||
              statesIntentWithoutActing(finalText));
          if (
            showsMutationIntent &&
            !currentState.performedMutationTool &&
            !currentState.completionWithoutMutationCorrectionSent
          ) {
            currentState.completionWithoutMutationCorrectionSent = true;
            currentState.apiMessages = [
              ...currentState.apiMessages,
              {
                role: 'user',
                content:
                  toolCallSupported !== false
                    ? 'You have not completed the requested file change yet. Do not claim the issue is fixed or resolved. Issue a real mutating tool call (writeFile/appendToFile/replaceInFile) now to apply the change, or explicitly state that no safe change was made.'
                    : 'You have not completed the requested file change yet. Do not claim the issue is fixed or resolved. Output a json tool-call block now (e.g. {"tool": "appendToFile", "arguments": {"path": "<file>", "content": "<code>"}}) to apply the change, or explicitly state that no safe change was made.'
              }
            ];
            continue;
          }

          // The run is about to end — if the model's own todo list still has
          // open items, give it one chance to finish or explicitly close them.
          const openTodos = agentTodosRef.current.filter(item => item.status !== 'done');
          if (
            openTodos.length > 0 &&
            !currentState.todoIncompleteCorrectionSent &&
            !currentState.controller.signal.aborted
          ) {
            currentState.todoIncompleteCorrectionSent = true;
            currentState.apiMessages = [
              ...currentState.apiMessages,
              {
                role: 'user',
                content: `Your todo list still has ${openTodos.length} unfinished item(s): ${openTodos
                  .map(item => `"${item.text}"`)
                  .join(', ')}. Finish them now, or if an item is obsolete or already covered, mark it done via updateTodoList — then give the final answer.`
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
        setStreamingDraft(null);
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

  // Asks the model for a short step-by-step plan (no tools, no code) so the user
  // can approve the approach before any work runs.
  const generatePlan = useCallback(
    async (apiMessages: any[], signal: AbortSignal): Promise<{ title: string; steps: string[] } | null> => {
      const planInstruction = {
        role: 'system',
        content: [
          'PLANNING STEP. Before doing ANY work, draft a short, concrete step-by-step plan for the user to approve.',
          'Output ONLY a single-line JSON object, no prose, no code fences, in EXACTLY this shape:',
          '{"title": "<short task title>", "steps": ["<step 1>", "<step 2>"]}',
          'Rules: 1-7 steps. Each step is one concrete action you will take (e.g. "Create gta6.py containing the text hallo"). Be proportional — a trivial task may have a single step. Do NOT write code, do NOT call tools, do NOT explain. Plan ONLY what the user actually asked for; never invent extra scope.'
        ].join('\n')
      };
      const result = await performCompletion([...apiMessages, planInstruction], signal, false);
      return parsePlanOutput(result.content || '');
    },
    [performCompletion]
  );

  const approvePlan = useCallback(
    async (id: string, editedSteps?: PlanStep[]) => {
      const entry = pendingPlanExecutionRef.current.get(id);
      if (!entry) return;
      pendingPlanExecutionRef.current.delete(id);
      setPendingPlanApproval(null);

      const steps = (editedSteps && editedSteps.length ? editedSteps : entry.steps)
        .map(step => ({ ...step, text: step.text.trim() }))
        .filter(step => step.text);

      if (entry.state.controller.signal.aborted) {
        setIsThinking(false);
        return;
      }

      if (!steps.length) {
        // Plan emptied out — just run the request without a plan injection.
        setIsThinking(true);
        await runAgentLoop(entry.state, entry.rawContent);
        return;
      }

      setIsThinking(true);
      setLastError(undefined);

      // Keep the approved checklist visible in the transcript.
      addMessageToConversation(entry.state.conversationId, {
        id: createId(),
        content: `### Approved plan\n${steps.map(step => `- [ ] ${step.text}`).join('\n')}`,
        sender: 'ai',
        timestamp: new Date()
      });

      const planInjection = {
        role: 'user',
        content: [
          'APPROVED PLAN — follow it exactly:',
          ...steps.map((step, index) => `${index + 1}. ${step.text}`),
          '',
          'Execute these steps IN ORDER using real tool calls. Stay strictly within the scope of this plan — do not add unrelated work. Complete EVERY step; never skip or forget one. Track progress with the updateTodoList tool: mark the current step in_progress and mark each step done as you finish it. Before each action, confirm it belongs to a plan step. When all steps are done (and any code changes verified), stop and give a short summary.'
        ].join('\n')
      };

      // Seed the live progress list with the approved plan so the UI shows it
      // immediately; the model keeps it updated via updateTodoList.
      const seededTodos: TodoItem[] = steps.map(step => ({ text: step.text, status: 'pending' }));
      agentTodosRef.current = seededTodos;
      setAgentTodos(seededTodos);

      await runAgentLoop(
        { ...entry.state, apiMessages: [...entry.state.apiMessages, planInjection] },
        entry.rawContent
      );
    },
    [runAgentLoop, addMessageToConversation]
  );

  const rejectPlan = useCallback((id: string) => {
    const entry = pendingPlanExecutionRef.current.get(id);
    pendingPlanExecutionRef.current.delete(id);
    setPendingPlanApproval(null);
    if (entry) {
      try { entry.state.controller.abort(); } catch { /* noop */ }
      addMessageToConversation(entry.state.conversationId, {
        id: createId(),
        content: 'Plan rejected. Adjust your request (or the steps) and send again.',
        sender: 'system',
        timestamp: new Date()
      });
    }
    abortControllerRef.current = null;
    setIsThinking(false);
    setToolStatus(undefined);
  }, [addMessageToConversation]);

  const sendMessage = useCallback(
    async (content: string, options?: SendMessageOptions) => {
      const displayContent = (options?.displayContent ?? content).trim();
      if (!displayContent || !settings.model || isThinking) {
        return undefined;
      }

      const activeConversation = getActiveConversation();
      const conversationId = activeConversation?.id ?? conversations[0].id;

      // Only a plan awaiting approval in THIS conversation blocks sending.
      // A global block let an invisible pending plan from another chat lock
      // the whole app (its approval card only renders in its own chat).
      const hasPendingPlanHere = Array.from(pendingPlanExecutionRef.current.values()).some(
        entry => entry.state.conversationId === conversationId
      );
      if (hasPendingPlanHere) {
        return undefined;
      }
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
      setLastCompactionSaved(undefined);
      // Fresh run — clear the previous run's todo list and token counter.
      agentTodosRef.current = [];
      setAgentTodos([]);
      turnTokensRef.current = { prompt: 0, completion: 0, total: 0 };
      setLastTurnTokens(undefined);

      // Auto-compact if context is >= 85% (best-effort — a failure here must
      // never leave isThinking stuck and block all further sends)
      if (contextUsagePercent >= 85) {
        try {
          const saved = await compactContext(conversationId);
          if (saved > 0) setLastCompactionSaved(saved);
        } catch (error) {
          console.warn('Auto-compaction failed, continuing without it:', error);
        }
      }

      const messagePayload = mapMessages(updatedMessages);
      let systemMessages: Array<{ role: string; content: string }>;
      try {
        systemMessages = await buildSystemMessages(options?.injectSystemPrompt);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setIsThinking(false);
        setLastError(message);
        addMessageToConversation(conversationId, {
          id: createId(),
          content: `Fehler beim Vorbereiten der Anfrage: ${message}`,
          sender: 'system',
          timestamp: new Date()
        });
        return undefined;
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const baseState: AgentLoopState = {
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
        describedToolCallCorrectionSent: false,
        repeatedResponseCount: 0,
        executedTools: [],
        replaceReReadRequiredPaths: [],
        nonMutatingToolRounds: 0,
        completionWithoutMutationCorrectionSent: false,
        autoFixRounds: 0,
        consecutiveEmptyResponses: 0,
        repeatedToolRoundCount: 0,
        todoIncompleteCorrectionSent: false
      };

      // Plan-first gate: for work modes, draft a plan and pause for the user's
      // approval (auto-approved after a countdown) before running anything.
      const shouldPlan =
        settings.planningEnabled &&
        settings.mode !== 'qa' &&
        settings.toolsEnabled &&
        sender === 'user';

      if (shouldPlan) {
        setToolStatus('Planning…');
        let plan: { title: string; steps: string[] } | null = null;
        try {
          plan = await generatePlan(baseState.apiMessages, controller.signal);
        } catch (error) {
          console.warn('Planning step failed, running without a plan:', error);
        }
        if (controller.signal.aborted) {
          setIsThinking(false);
          setToolStatus(undefined);
          return baseState.combinedContent;
        }
        if (plan && plan.steps.length) {
          const planId = createId();
          const steps: PlanStep[] = plan.steps.map(text => ({ id: createId(), text }));
          pendingPlanExecutionRef.current.set(planId, {
            state: baseState,
            rawContent,
            title: plan.title,
            steps
          });
          setPendingPlanApproval({
            id: planId,
            conversationId,
            title: plan.title,
            steps,
            autoApproveSeconds: Math.max(5, Math.round(settings.planAutoApproveSeconds || 60))
          });
          setIsThinking(false);
          setToolStatus(undefined);
          return baseState.combinedContent;
        }
        // No usable plan — fall through and run directly.
        setToolStatus(undefined);
      }

      return runAgentLoop(baseState, rawContent);
    },
    [
      // Note: compactContext/contextUsagePercent are used inside but declared
      // later in the component — listing them here would crash at render time
      // (TDZ). They are intentionally omitted, as before.
      addMessageToConversation,
      buildSystemMessages,
      conversations,
      getActiveConversation,
      isThinking,
      mapMessages,
      runAgentLoop,
      generatePlan,
      settings.model,
      settings.planningEnabled,
      settings.planAutoApproveSeconds,
      settings.mode,
      settings.toolsEnabled
    ]
  );

  const visionSupported = useMemo(() => {
    if (!settings.model) return false;
    // Prefer the catalog/metadata-backed classification (knows Ollama `vision`
    // capability), then fall back to a name heuristic for anything unclassified.
    if (modelClassifications[settings.model]?.vision) return true;
    const lower = settings.model.toLowerCase();
    return /vision|gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|gemini|claude|pixtral|llava|cogvlm|qwen2?-vl|internvl|minicpm/.test(lower);
  }, [settings.model, modelClassifications]);

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

  // The compaction notice belongs to the conversation it happened in — don't
  // let it stick around when the user switches to or starts another chat.
  useEffect(() => {
    setLastCompactionSaved(undefined);
  }, [activeConversationId]);

  const [whisperAutoStartState, setWhisperAutoStartState] = useState<WhisperAutoStartState>({ status: 'idle' });

  const contextUsagePercent = useMemo(() => {
    const conv = conversations.find(c => c.id === activeConversationId);
    if (!conv) return 0;
    const totalChars = conv.messages.reduce((sum, m) => sum + (m.content?.length || 0) + (m.rawContent?.length || 0), 0);
    const estimatedTokens = totalChars / 4;
    // Measure against the model's CONTEXT window (estimated from its id) — not
    // settings.maxTokens, which is the max COMPLETION length and made a normal
    // chat hit "85% full" after a handful of messages and compact every send.
    const windowTokens = guessContextWindow(settings.model);
    return Math.min(100, Math.round((estimatedTokens / windowTokens) * 100));
  }, [conversations, activeConversationId, settings.model]);

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

    // Replace ONLY the messages we actually summarized. Anything that was
    // added while the summary request was running (e.g. the user's newest
    // message) is not in the snapshot and must survive — replacing the list
    // with [summary, ...toKeep] used to silently swallow it.
    const compactedIds = new Set(toCompact.map(m => m.id));
    setConversations(prev => prev.map(c => {
      if (c.id !== conversationId) return c;
      const remaining = c.messages.filter(m => !compactedIds.has(m.id));
      return { ...c, messages: [summaryMessage, ...remaining] };
    }));

    return Math.max(0, Math.round(savedChars / 4));
  }, [conversations, requestCompletion]);

  // Listen for spawnSubAgent events dispatched by the tool handler
  useEffect(() => {
    const handler = (event: Event) => {
      const { agentId, task, systemPrompt } = (event as CustomEvent).detail as { agentId: string; task: string; systemPrompt: string };
      setSubAgents(prev => [...prev, { id: agentId, task, status: 'running' }]);
      const controller = new AbortController();
      // Run a real tool-enabled sub-agent so it can actually read/search/edit,
      // not just produce text.
      runHeadlessAgent(task, systemPrompt, controller.signal, status =>
        setSubAgents(prev => prev.map(a => (a.id === agentId ? { ...a, progress: status } : a)))
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
  }, [runHeadlessAgent]);

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
      modelClassifications,
      visionSupported,
      pendingToolApprovals,
      approvePendingToolApproval,
      rejectPendingToolApproval,
      pendingPlanApproval,
      approvePlan,
      rejectPlan,
      saveProfile,
      deleteProfile,
      selectProfile,
      subAgents,
      spawnSubAgents,
      clearSubAgents,
      streamingDraft,
      agentTodos,
      lastTurnTokens,
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
      models,
      refreshModels,
      isFetchingModels,
      lastError,
      connectionStatus,
      toolStatus,
      toolCallSupported,
      checkToolCallSupport,
      modelClassifications,
      visionSupported,
      pendingToolApprovals,
      approvePendingToolApproval,
      rejectPendingToolApproval,
      pendingPlanApproval,
      approvePlan,
      rejectPlan,
      saveProfile,
      deleteProfile,
      selectProfile,
      subAgents,
      spawnSubAgents,
      clearSubAgents,
      streamingDraft,
      agentTodos,
      lastTurnTokens,
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
