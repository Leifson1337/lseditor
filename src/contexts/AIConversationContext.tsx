import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { AIService } from '../services/AIService';
import { AIConversation, AIMessage, AIConfig } from '../types/AITypes';

// Placeholder AIConfig (same as used before)
const placeholderAIConfig: AIConfig = {
  useLocalModel: false,
  model: 'gpt-3.5-turbo',
  temperature: 0.7,
  maxTokens: 2048,
  contextWindow: 4096,
  stopSequences: [],
  openAIConfig: {
    apiKey: process.env.REACT_APP_OPENAI_API_KEY || 'your-api-key-placeholder', // Use placeholder
    model: 'gpt-3.5-turbo',
    temperature: 0.7,
    maxTokens: 2048,
  },
};

export interface ConversationSummary {
  id: string;
  name: string;
  lastMessageTimestamp?: Date;
  messageCount: number;
}

interface AIConversationContextType {
  aiService: AIService | null;
  conversationList: ConversationSummary[];
  activeConversationMessages: AIMessage[];
  activeConversationId: string | null;
  isLoading: boolean;
  error: Error | null;
  sendMessageToActiveConversation: (content: string) => Promise<void>; // Renamed for clarity
  startNewConversationAndSetActive: () => Promise<void>; // Renamed for clarity
  setActiveConversation: (id: string) => Promise<void>; // Now async due to loadData
  deleteConversationFromList: (id: string) => Promise<void>; // Renamed for clarity
}

const AIConversationContext = createContext<AIConversationContextType | undefined>(undefined);

export const AIConversationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [aiService, setAiService] = useState<AIService | null>(null);
  const [conversationList, setConversationList] = useState<ConversationSummary[]>([]);
  const [activeConversationMessages, setActiveConversationMessages] = useState<AIMessage[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const refreshDataFromService = useCallback(async (service: AIService) => {
    setIsLoading(true);
    setError(null);
    try {
      setConversationList(service.getConversationList());
      const currentActiveId = service.getActiveConversation();
      setActiveConversationId(currentActiveId);

      if (currentActiveId) {
        const activeConv = service.getConversations().find(c => c.id === currentActiveId);
        setActiveConversationMessages(activeConv ? activeConv.messages : []);
      } else {
        setActiveConversationMessages([]);
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error('Failed to refresh data from AI service');
      setError(err);
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const serviceInstance = AIService.getInstance(placeholderAIConfig);
    setAiService(serviceInstance);

    const initializeAndLoad = async () => {
      setIsLoading(true);
      try {
        if (!serviceInstance.isInitialized) {
          await serviceInstance.initialize(); // This now loads from localStorage
        }
        await refreshDataFromService(serviceInstance);
      } catch (e) {
        const err = e instanceof Error ? e : new Error('Failed to initialize AI Service or load initial data');
        setError(err);
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };

    initializeAndLoad();

    // Listener for changes from AIService
    const handleConversationsChanged = () => {
      if (serviceInstance) {
        refreshDataFromService(serviceInstance);
      }
    };
    
    serviceInstance.on('conversationsChanged', handleConversationsChanged);

    return () => {
      serviceInstance.off('conversationsChanged', handleConversationsChanged);
    };

  }, [refreshDataFromService]);

  const sendMessageToActiveConversation = async (content: string) => {
    if (!aiService || !activeConversationId) {
      setError(new Error('AI Service or active conversation not available for sending message.'));
      return;
    }
    setIsLoading(true);
    try {
      await aiService.sendMessage(activeConversationId, content);
      // AIService now emits 'conversationsChanged' which triggers refreshDataFromService
      // No need to call refreshDataFromService explicitly here if eventing is reliable.
      // However, for immediate feedback, or if eventing has delays, direct call might be kept:
      // await refreshDataFromService(aiService); 
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to send message'));
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const startNewConversationAndSetActive = async () => {
    if (!aiService) {
      setError(new Error('AI Service not available for starting new conversation.'));
      return;
    }
    setIsLoading(true);
    try {
      await aiService.startConversation(); // This sets the new one active in AIService and saves
      // Event 'conversationsChanged' should handle UI update.
      // await refreshDataFromService(aiService); 
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to start new conversation'));
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const setActiveConversation = async (id: string) => {
    if (!aiService) {
      setError(new Error('AI Service not available for setting active conversation.'));
      return;
    }
    // Optimistically update active ID for responsiveness, then let refreshDataFromService sync messages
    // setActiveConversationId(id); 
    // setIsLoading(true); // Consider if this is too flashy for just a switch
    try {
      aiService.setActiveConversation(id); // This saves to localStorage and emits 'conversationsChanged'
      // Event 'conversationsChanged' should handle UI update.
      // await refreshDataFromService(aiService);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to set active conversation'));
      console.error(e);
      // Potentially revert optimistic update if needed
    } finally {
      // setIsLoading(false);
    }
  };

  const deleteConversationFromList = async (id: string) => {
    if (!aiService) {
      setError(new Error('AI Service not available for deleting conversation.'));
      return;
    }
    setIsLoading(true);
    try {
      await aiService.endConversation(id); // This saves to localStorage and emits 'conversationsChanged'
      // Event 'conversationsChanged' should handle UI update.
      // await refreshDataFromService(aiService);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Failed to delete conversation'));
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AIConversationContext.Provider value={{
      aiService,
      conversationList,
      activeConversationMessages,
      activeConversationId,
      isLoading,
      error,
      sendMessageToActiveConversation,
      startNewConversationAndSetActive,
      setActiveConversation,
      deleteConversationFromList,
    }}>
      {children}
    </AIConversationContext.Provider>
  );
};

export const useAIConversation = () => {
  const context = useContext(AIConversationContext);
  if (context === undefined) {
    throw new Error('useAIConversation must be used within an AIConversationProvider');
  }
  return context;
};
