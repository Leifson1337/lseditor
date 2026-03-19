import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { AI_TOOLS, executeToolCall, ToolCall, ToolResult } from '../services/AIToolService';

export type ChatSender = 'user' | 'ai' | 'system' | 'tool';

export interface ToolCallInfo {
  name: string;
  arguments: string;
  result?: string;
  status: 'pending' | 'running' | 'done' | 'error';
}

export interface Message {
  id: string;
  content: string;
  sender: ChatSender;
  timestamp: Date;
  rawContent?: string;
  toolCalls?: ToolCallInfo[];
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
}

interface SendMessageOptions {
  displayContent?: string;
  actualContent?: string;
  sender?: ChatSender;
  injectSystemPrompt?: string;
}

interface CompletionRequestOptions {
  injectSystemPrompt?: string;
  signal?: AbortSignal;
  includeBasePrompt?: boolean;
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
  toolsEnabled: true
};

const DEFAULT_BASE_PROMPT = `Du bist LS AI, der integrierte Assistent des LS Editors. Du hast Zugriff auf Tools zum Lesen, Schreiben, Suchen und Ausfuehren von Dateien und Befehlen im Workspace des Benutzers.

WICHTIG - Tool-Nutzung:
- Wenn der Benutzer dich bittet Code zu schreiben, eine Datei zu erstellen oder zu aendern: Benutze IMMER das writeFile Tool um den Code direkt in die Datei zu schreiben. Gib den Code NICHT als Text aus.
- Wenn der Benutzer dich bittet etwas zu testen: Benutze IMMER das runCommand Tool (z.B. "python datei.py", "node datei.js", "npm test")
- Lies Dateien mit readFile bevor du sie aenderst
- Wenn der genaue Dateipfad unbekannt ist, benutze zuerst findFile
- Fuehre Befehle mit runCommand aus wenn noetig (z.B. npm install, git status, npm test, npm run build)

Ablauf wenn der Benutzer Code will:
1. Lies die Datei mit readFile (falls sie existiert)
2. Schreibe den neuen Code mit writeFile in die Datei
3. Optional: Teste mit runCommand
4. Antworte kurz was du getan hast

Verboten:
- Gib NIEMALS Code als Antworttext aus wenn du ihn stattdessen mit writeFile schreiben kannst
- Behaupte niemals, dass eine Datei geaendert wurde, ohne writeFile aufgerufen zu haben
- Gib niemals interne Gedanken, Analyse oder Pseudo-Tool-Protokoll aus
- Antworte IMMER in normalem Text. Benutze NIEMALS interne Protokoll-Marker oder Channel-Tags`;

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

const containsPseudoToolProtocol = (content: string): boolean => {
  if (!content) return false;
  return /<\|channel\|>|<\|message\|>|<\|constrain\|>|<\|start\|>|<\|end\|>|<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>|analysis\s+to=|to=commentary|to=assistant|json<\|message\|>|^functions\.\w+/im.test(content);
};

const claimsFileMutationWithoutTool = (content: string): boolean => {
  if (!content) return false;
  return /(updated|created|deleted|renamed|fixed|changed|modified|wrote|saved|aktualisiert|erstellt|geloescht|umbenannt|gefixt|geaendert|gespeichert)/i.test(content);
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

interface CompletionResult {
  content: string;
  finishReason?: string;
  toolCalls?: ToolCall[];
  usage?: {
    completion_tokens?: number;
    total_tokens?: number;
  };
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
  const abortControllerRef = useRef<AbortController | null>(null);
  const basePromptRef = useRef<string>(DEFAULT_BASE_PROMPT);
  const projectPathRef = useRef(projectPath);

  useEffect(() => {
    projectPathRef.current = projectPath;
  }, [projectPath]);

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
          if (fetched.length) break;
        } catch (error) {
          lastErrorMessage = error instanceof Error ? error.message : String(error);
        }
      }

      if (!fetched.length) {
        throw new Error(lastErrorMessage || 'Keine Modelle gefunden');
      }

      setModels(fetched);
      setConnectionStatus('ready');
      setLastError(undefined);

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
    } finally {
      setIsFetchingModels(false);
    }
  }, [settings.baseUrl]);

  useEffect(() => {
    refreshModels();
  }, [refreshModels]);

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
      .filter(m => m.sender !== 'tool')
      .map(message => ({
        role: message.sender === 'user' ? 'user' : message.sender === 'ai' ? 'assistant' : 'system',
        content: message.rawContent ?? message.content
      }));
  }, []);

  const performCompletion = useCallback(
    async (
      payloadMessages: any[],
      signal: AbortSignal,
      useTools: boolean = false
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
        body.tools = AI_TOOLS;
        body.tool_choice = 'auto';
      }

      const response = await fetch(`${sanitizeBaseUrl(settings.baseUrl)}/v1/chat/completions`, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {})
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        let detail = '';
        try {
          const problem = await response.json();
          detail = problem?.error?.message || problem?.message || JSON.stringify(problem);
        } catch {
          detail = await response.text();
        }
        throw new Error(detail || `LM Studio antwortete mit Status ${response.status}`);
      }

      const payload = await response.json();
      const choice = payload?.choices?.[0];
      const aiContent = sanitizeAssistantContent(choice?.message?.content?.trim() || '');
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
      }

      if (!aiContent && !toolCalls?.length) {
        // If the raw content had pseudo-tool protocol but sanitization removed everything,
        // return empty so the caller can re-prompt instead of erroring.
        const rawContent = choice?.message?.content?.trim() || '';
        if (rawContent && containsPseudoToolProtocol(rawContent)) {
          return { content: '', finishReason: choice?.finish_reason, toolCalls: undefined, usage: payload?.usage };
        }
        throw new Error('Die Antwort enthielt keinen Text.');
      }

      return {
        content: aiContent,
        finishReason: choice?.finish_reason,
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
    [loadBasePrompt]
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
        timestamp: new Date()
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
      let apiMessages: any[] = [...systemMessages, ...messagePayload];

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        let combinedContent = '';
        let loops = 0;
        const maxToolLoops = 10;
        let performedMutationTool = false;
        let mutationCorrectionSent = false;
        let toolProtocolCorrectionSent = false;

        while (loops < maxToolLoops && !controller.signal.aborted) {
          loops += 1;
          const useTools = settings.toolsEnabled && loops <= maxToolLoops;
          const result = await performCompletion(apiMessages, controller.signal, useTools);

          // Handle tool calls
          if (result.toolCalls && result.toolCalls.length > 0) {
            const toolCallInfos: ToolCallInfo[] = result.toolCalls.map(tc => ({
              name: tc.function.name,
              arguments: tc.function.arguments,
              status: 'pending' as const
            }));

            // Add assistant message with tool calls to API messages
            apiMessages = [
              ...apiMessages,
              {
                role: 'assistant',
                content: result.content || null,
                tool_calls: result.toolCalls.map(tc => ({
                  id: tc.id,
                  type: 'function',
                  function: { name: tc.function.name, arguments: tc.function.arguments }
                }))
              }
            ];

            // Show tool execution status
            const toolMsg: Message = {
              id: createId(),
              content: result.content || '',
              sender: 'tool',
              timestamp: new Date(),
              toolCalls: toolCallInfos
            };
            addMessageToConversation(conversationId, toolMsg);

            // Execute each tool call
            const toolResults: ToolResult[] = [];
            for (const tc of result.toolCalls) {
              setToolStatus(`Running: ${tc.function.name}...`);
              if (['writeFile', 'createDirectory', 'deleteFile', 'renameFile'].includes(tc.function.name)) {
                performedMutationTool = true;
              }
              const toolResult = await executeToolCall(tc, projectPathRef.current);
              toolResults.push(toolResult);

              // Update tool call status in the message
              const idx = toolCallInfos.findIndex(t => t.name === tc.function.name && t.status === 'pending');
              if (idx !== -1) {
                toolCallInfos[idx].status = 'done';
                toolCallInfos[idx].result = toolResult.content.substring(0, 500);
              }
            }

            // Add tool results to API messages
            for (const tr of toolResults) {
              apiMessages.push({
                role: 'tool',
                tool_call_id: tr.tool_call_id,
                content: tr.content
              });
            }

            setToolStatus(undefined);
            continue;
          }

          // No tool calls - this is the final text response
          if (result.content) {
            if (
              settings.toolsEnabled &&
              !toolProtocolCorrectionSent &&
              containsPseudoToolProtocol(result.content)
            ) {
              toolProtocolCorrectionSent = true;
              apiMessages = [
                ...apiMessages,
                {
                  role: 'user',
                  content: 'Do not print internal tool protocol, analysis tags, channel markers, or pseudo function calls like "functions.readFile". If you need to inspect or change files, use proper tool calls. Otherwise answer normally in plain text.'
                }
              ];
              continue;
            }
          } else if (!result.content && !result.toolCalls?.length && loops < maxToolLoops) {
            // Content was empty (protocol noise sanitized away, or model returned nothing).
            // Always re-prompt to get a real answer instead of showing "(No response)".
            apiMessages = [
              ...apiMessages,
              {
                role: 'user',
                content: toolProtocolCorrectionSent
                  ? 'Please provide your answer now. Summarize what you did and any results.'
                  : 'Your previous response was empty or contained only internal protocol markers. Please respond normally in plain text. Use proper tool calls if you need to access files.'
              }
            ];
            toolProtocolCorrectionSent = true;
            continue;
          }

          if (result.content) {

            if (
              settings.toolsEnabled &&
              !performedMutationTool &&
              !mutationCorrectionSent &&
              claimsFileMutationWithoutTool(result.content)
            ) {
              mutationCorrectionSent = true;
              apiMessages = [
                ...apiMessages,
                {
                  role: 'user',
                  content: 'You have not modified any file yet. If you intend to change files, call the appropriate tool first. Otherwise answer without claiming a file change.'
                }
              ];
              continue;
            }

            // Detect when the AI outputs code blocks instead of using writeFile
            if (
              settings.toolsEnabled &&
              !performedMutationTool &&
              !mutationCorrectionSent &&
              containsCodeBlockThatShouldBeWritten(result.content)
            ) {
              mutationCorrectionSent = true;
              apiMessages = [
                ...apiMessages,
                {
                  role: 'user',
                  content: 'Do NOT output code as text. Use the writeFile tool to write the code directly into the file. Call writeFile now with the correct path and the full file content.'
                }
              ];
              continue;
            }

            combinedContent += combinedContent ? `\n\n${result.content}` : result.content;
            apiMessages = [...apiMessages, { role: 'assistant', content: result.content }];
          }

          // Check if we need to continue (token limit hit)
          if (!shouldContinue(result)) {
            break;
          }

          apiMessages = [...apiMessages, { role: 'user', content: 'Bitte fahre fort.' }];
        }

        const aiMessage: Message = {
          id: createId(),
          content: combinedContent || '(No response)',
          sender: 'ai',
          timestamp: new Date()
        };

        addMessageToConversation(conversationId, aiMessage);
        return combinedContent;
      } catch (error) {
        const aborted = controller.signal.aborted;
        const message = error instanceof Error ? error.message : String(error);
        setLastError(aborted ? 'Anfrage abgebrochen.' : message);

        const systemMessage: Message = {
          id: createId(),
          content: aborted ? 'Anfrage abgebrochen.' : `Fehler: ${message}`,
          sender: 'system',
          timestamp: new Date()
        };

        addMessageToConversation(conversationId, systemMessage);
        return undefined;
      } finally {
        abortControllerRef.current = null;
        setIsCancelling(false);
        setIsThinking(false);
        setToolStatus(undefined);
      }
    },
    [addMessageToConversation, buildSystemMessages, conversations, getActiveConversation, isThinking, mapMessages, performCompletion, settings.model, settings.toolsEnabled, shouldContinue]
  );

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
      toolStatus
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
      toolStatus
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
