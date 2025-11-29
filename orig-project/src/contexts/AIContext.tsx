import React, { createContext, useContext, useState } from 'react';

// Message represents a single chat message between the user and the AI
interface Message {
  id: string;                // Unique identifier for the message
  content: string;           // Text content of the message
  sender: 'user' | 'ai';     // Who sent the message
  timestamp: Date;           // When the message was sent
}

// AIContextType defines the shape of the AI context value
interface AIContextType {
  messages: Message[];                   // Array of chat messages
  sendMessage: (content: string) => void; // Function to send a new message
  clearMessages: () => void;              // Function to clear all messages
}

// Create a React context for AI chat functionality
const AIContext = createContext<AIContextType | undefined>(undefined);

// AIProvider wraps children with AI chat context and state management
export const AIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Initialize an empty array of messages
  const [messages, setMessages] = useState<Message[]>([]);

  // Send a new message from the user
  const sendMessage = (content: string) => {
    // Create a new message object with a unique ID, content, sender, and timestamp
    const newMessage: Message = {
      id: Date.now().toString(),
      content,
      sender: 'user',
      timestamp: new Date()
    };
    // Append the new message to the existing array of messages
    setMessages(prev => [...prev, newMessage]);
    // TODO: Implement AI response logic
  };

  // Clear all chat messages
  const clearMessages = () => {
    // Reset the messages array to empty
    setMessages([]);
  };

  return (
    // Provide the AI context value to the wrapped children
    <AIContext.Provider value={{ messages, sendMessage, clearMessages }}>
      {children}
    </AIContext.Provider>
  );
};

// Custom hook to use the AI chat context
export const useAI = () => {
  // Get the AI context value
  const context = useContext(AIContext);
  // Throw an error if the hook is used outside of an AIProvider
  if (context === undefined) {
    throw new Error('useAI must be used within an AIProvider');
  }
  // Return the AI context value
  return context;
};