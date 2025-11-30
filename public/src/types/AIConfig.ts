// AIConfig.ts
// Type definitions for AI configuration settings used by the application.

/**
 * AIConfig defines the configuration options for the AI service.
 * It encapsulates various settings that control the behavior of the AI model.
 */
export interface AIConfig {
  /**
   * The API key for the AI provider.
   * This is a required field for authentication purposes.
   */
  apiKey: string;

  /**
   * The model name or version to be used by the AI service.
   * This field determines the specific AI model that will be utilized.
   */
  model: string;

  /**
   * The temperature value for sampling AI responses.
   * This field is optional and controls the level of randomness in the AI's output.
   */
  temperature: number;

  /**
   * The maximum number of tokens in the AI response.
   * This field is optional and limits the length of the AI's output.
   */
  maxTokens: number;

  /**
   * The context window size for the AI model.
   * This field determines the amount of context that the AI model will consider.
   */
  contextWindow: number;

  /**
   * Flag indicating whether to use a local AI model.
   * If true, the application will use a local AI model instead of a cloud-based one.
   */
  useLocalModel: boolean;

  /**
   * The path to the local AI model.
   * This field is required if useLocalModel is set to true.
   */
  localModelPath: string;

  /**
   * An array of stop sequences for the AI model.
   * These sequences determine when the AI model should stop generating output.
   */
  stopSequences: string[];

  /**
   * The top P value for the AI model.
   * This field is optional and controls the level of diversity in the AI's output.
   */
  topP?: number;

  /**
   * Configuration options for the OpenAI service.
   * This field is optional and provides additional settings for the OpenAI service.
   */
  openAIConfig?: {
    /**
     * The API key for the OpenAI service.
     * This field is required for authentication purposes.
     */
    apiKey: string;

    /**
     * The model name or version to be used by the OpenAI service.
     * This field determines the specific AI model that will be utilized.
     */
    model: string;

    /**
     * The maximum number of tokens in the OpenAI response.
     * This field is optional and limits the length of the OpenAI's output.
     */
    maxTokens: number;

    /**
     * The temperature value for sampling OpenAI responses.
     * This field is optional and controls the level of randomness in the OpenAI's output.
     */
    temperature: number;
  };

  /**
   * Configuration options for the local AI model.
   * This field is optional and provides additional settings for the local AI model.
   */
  localModelConfig?: {
    /**
     * The endpoint URL for the local AI model.
     * This field is required for communication with the local AI model.
     */
    endpoint: string;

    /**
     * The maximum number of tokens in the local AI response.
     * This field is optional and limits the length of the local AI's output.
     */
    maxTokens?: number;

    /**
     * The temperature value for sampling local AI responses.
     * This field is optional and controls the level of randomness in the local AI's output.
     */
    temperature?: number;
  };
}

/**
 * AIConversation represents a conversation between the user and the AI.
 * It encapsulates the conversation ID, messages, context, and timestamp.
 */
export interface AIConversation {
  /**
   * The unique ID of the conversation.
   * This field is required for identifying the conversation.
   */
  id: string;

  /**
   * An array of messages in the conversation.
   * This field contains the messages exchanged between the user and the AI.
   */
  messages: AIMessage[];

  /**
   * An array of context strings for the conversation.
   * This field provides additional context for the conversation.
   */
  context: string[];

  /**
   * The timestamp of the conversation.
   * This field indicates when the conversation took place.
   */
  timestamp: number;
}

/**
 * AIMessage represents a single message in a conversation.
 * It encapsulates the role, content, and timestamp of the message.
 */
export interface AIMessage {
  /**
   * The role of the message sender (user, assistant, or system).
   * This field determines the type of message being sent.
   */
  role: 'user' | 'assistant' | 'system';

  /**
   * The content of the message.
   * This field contains the actual text of the message.
   */
  content: string;

  /**
   * The timestamp of the message.
   * This field indicates when the message was sent.
   */
  timestamp: number;
}