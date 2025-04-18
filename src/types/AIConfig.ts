export interface AIConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  contextWindow: number;
  apiKey: string;
  useLocalModel: boolean;
  localModelPath: string;
  openAIConfig?: {
    apiKey: string;
    model: string;
    maxTokens: number;
    temperature: number;
  };
  localModelConfig?: {
    endpoint: string;
    maxTokens?: number;
    temperature?: number;
  };
}

export interface AIConversation {
  id: string;
  messages: AIMessage[];
  context: string[];
  timestamp: number;
}

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}
 