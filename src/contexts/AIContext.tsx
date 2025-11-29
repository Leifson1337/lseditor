import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

export type ChatSender = 'user' | 'ai' | 'system';

export interface Message {
  id: string;
  content: string;
  sender: ChatSender;
  timestamp: Date;
  rawContent?: string;
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
}

interface SendMessageOptions {
  displayContent?: string;
  actualContent?: string;
  sender?: ChatSender;
  injectSystemPrompt?: string;
}

interface AIContextType {
  conversations: Conversation[];
  activeConversationId: string;
  setActiveConversation: (id: string) => void;
  startNewConversation: () => void;
  removeConversation: (id: string) => void;
  sendMessage: (content: string, options?: SendMessageOptions) => Promise<string | undefined>;
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
}

const AIContext = createContext<AIContextType | undefined>(undefined);

const SETTINGS_KEY = 'lseditor.ai.settings';
const defaultSettings: AISettings = {
  provider: 'lmstudio',
  baseUrl: 'http://localhost:1234',
  model: '',
  temperature: 0.7,
  topP: 1,
  maxTokens: 2048
};

const DEFAULT_BASE_PROMPT = 'Du bist LS AI, der integrierte Assistent des LS Editors. Arbeite fokussiert im aktuellen Workspace, antworte knapp und liefere konkrete, umsetzbare Schritte für Code- und Dateiänderungen.';

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

interface CompletionResult {
  content: string;
  finishReason?: string;
  usage?: {
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export const AIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
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
  const abortControllerRef = useRef<AbortController | null>(null);
  const basePromptRef = useRef<string>(DEFAULT_BASE_PROMPT);

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
    return messages.map(message => ({
      role: message.sender === 'user' ? 'user' : message.sender === 'ai' ? 'assistant' : 'system',
      content: message.rawContent ?? message.content
    }));
  }, []);

  const performCompletion = useCallback(
    async (payloadMessages: { role: string; content: string }[], signal: AbortSignal): Promise<CompletionResult> => {
      const response = await fetch(`${sanitizeBaseUrl(settings.baseUrl)}/v1/chat/completions`, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: settings.model,
          temperature: settings.temperature,
          top_p: settings.topP,
          max_tokens: settings.maxTokens,
          messages: payloadMessages
        })
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
      const aiContent = payload?.choices?.[0]?.message?.content?.trim();
      if (!aiContent) {
          throw new Error('Die Antwort enthielt keinen Text.');
      }
      return {
        content: aiContent,
        finishReason: payload?.choices?.[0]?.finish_reason,
        usage: payload?.usage
      };
    },
    [settings]
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

      const basePrompt = await loadBasePrompt();
      const messagePayload = mapMessages(updatedMessages);
      const payloadMessages = [
        ...(basePrompt ? [{ role: 'system', content: basePrompt }] : []),
        ...(options?.injectSystemPrompt ? [{ role: 'system', content: options.injectSystemPrompt }] : []),
        ...messagePayload
      ];

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        let combinedContent = '';
        let continuationMessages = [...payloadMessages];
        let loops = 0;

        const appendResult = (result: CompletionResult) => {
          combinedContent += combinedContent ? `\n\n${result.content}` : result.content;
          continuationMessages = [...continuationMessages, { role: 'assistant', content: result.content }];
        };

        let result = await performCompletion(continuationMessages, controller.signal);
        appendResult(result);

        while (!controller.signal.aborted && shouldContinue(result) && loops < 4) {
          loops += 1;
          continuationMessages = [...continuationMessages, { role: 'user', content: 'Bitte fahre fort.' }];
          result = await performCompletion(continuationMessages, controller.signal);
          appendResult(result);
        }

        const aiMessage: Message = {
          id: createId(),
          content: combinedContent,
          sender: 'ai',
          timestamp: new Date()
        };

        setConversations(prev =>
          prev.map(conv =>
            conv.id === conversationId ? { ...conv, messages: [...conv.messages, aiMessage] } : conv
          )
        );

        return combinedContent;
      } catch (error) {
        const aborted = controller.signal.aborted;
        const message = error instanceof Error ? error.message : String(error);
        setLastError(aborted ? 'Anfrage abgebrochen.' : message);

        const systemMessage: Message = {
          id: createId(),
          content: aborted ? 'Anfrage abgebrochen.' : `âš ï¸ ${message}`,
          sender: 'system',
          timestamp: new Date()
        };

        setConversations(prev =>
          prev.map(conv =>
            conv.id === conversationId ? { ...conv, messages: [...conv.messages, systemMessage] } : conv
          )
        );
        return undefined;
      } finally {
        abortControllerRef.current = null;
        setIsCancelling(false);
        setIsThinking(false);
      }
    },
    [conversations, getActiveConversation, isThinking, loadBasePrompt, mapMessages, performCompletion, settings.model, shouldContinue]
  );

  const value = useMemo<AIContextType>(
    () => ({
      conversations,
      activeConversationId,
      setActiveConversation: setActiveConversationId,
      startNewConversation,
      sendMessage,
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
      connectionStatus
    }),
    [
      conversations,
      activeConversationId,
      startNewConversation,
      sendMessage,
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
      connectionStatus
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

