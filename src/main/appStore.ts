import Store from 'electron-store';

export type BackendChoice = 'ollama' | 'lmstudio' | 'none' | 'bundled';

/** Serialized AI chat for persistence (timestamps as ISO strings). */
export interface PersistedChatMessage {
  id: string;
  content: string;
  sender: string;
  timestamp: string;
  rawContent?: string;
  reasoning?: string;
  toolCalls?: unknown;
  images?: unknown;
}

export interface PersistedConversation {
  id: string;
  title: string;
  createdAt: number;
  messages: PersistedChatMessage[];
}

export interface AIChatPersistedState {
  conversations: PersistedConversation[];
  activeConversationId: string;
}

export interface AppStoreSchema {
  /** After the user has seen (or skipped) the GPU wizard */
  firstTimeGpuSetupShown: boolean;
  /** When both Ollama and LM Studio are installed, which local stack to prefer for URLs and autostart */
  preferredLocalBackend?: 'ollama' | 'lmstudio';
  /** Backend chosen at first-time setup or saved preference */
  backendChoice: BackendChoice;
  /** Preferred default model for local AI */
  preferredDefaultModel: string;
  /** OpenAI-compatible base URL for system Ollama or LM Studio (e.g. http://127.0.0.1:11434/v1) */
  localOpenAIBaseURL?: string;
  /** AI panel conversation history */
  aiChatState?: AIChatPersistedState;
  /** JSON string of AI panel settings (provider, baseUrl, model, temperature, …) */
  aiPanelSettingsJson?: string;
  /** One-shot flag: open AI settings page on next renderer startup */
  openAISettingsOnLaunch: boolean;
}

const defaults: AppStoreSchema = {
  firstTimeGpuSetupShown: false,
  backendChoice: 'bundled',
  preferredDefaultModel: 'phi3:mini',
  openAISettingsOnLaunch: false
};

export const appStore = new Store<AppStoreSchema>({
  name: 'lseditor-settings',
  defaults
});
