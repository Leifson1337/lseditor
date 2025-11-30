import React, { useState, useRef, useEffect } from 'react';
import { FaCheck, FaTimes, FaCode, FaQuestion } from 'react-icons/fa';
import { useAI } from '../contexts/AIContext';
import '../styles/ai-chat-modern.css';

// Message represents a single chat message in the AI chat panel
interface Message {
  id: string;
  content: string;
  sender: 'user' | 'ai';
  timestamp: Date;
}

// Props for the AIChat component
interface AIChatProps {
  messages: Message[]; // List of chat messages
  onSendMessage: (message: string) => void; // Callback to send a message
  isOpen: boolean; // Whether the chat panel is open
  onClose: () => void; // Callback to close the chat panel
  onInsertCode: (code: string) => void; // Callback to insert code into editor
  onExplain: (code: string) => void; // Callback to explain code
}

// AIChat provides a modern chat interface for interacting with an AI assistant
export const AIChat: React.FC<AIChatProps> = ({
  messages,
  onSendMessage,
  isOpen,
  onClose,
  onInsertCode,
  onExplain
}) => {
  // State for the current input value
  const [input, setInput] = useState('');
  // Access AI context for sending messages
  const { sendMessage } = useAI();
  // Ref to scroll to the end of the messages list
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Effect to scroll to the latest message when messages change
  useEffect(() => {
    // Scroll to the latest message when messages change
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle sending a message via the input form
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      sendMessage(input);
      setInput('');
    }
  };

  // If the chat panel is not open, return null
  if (!isOpen) return null;

  return (
    <div className="ai-chat-modern-panel">
      <div className="ai-chat-modern-header">
        <h3>AI Assistant</h3>
        <button onClick={onClose} className="ai-chat-modern-close" title="Close chat">
          <FaTimes />
        </button>
      </div>
      <div className="ai-chat-modern-messages">
        {/* Show placeholder if there are no messages */}
        {messages.length === 0 && (
          <div className="ai-chat-modern-empty">Start a conversation with your AI assistant…</div>
        )}
        {/* Render each chat message */}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`ai-chat-modern-message ${message.sender === 'user' ? 'user' : 'ai'}`}
          >
            <div className="ai-chat-modern-message-content">{message.content}</div>
            <div className="ai-chat-modern-message-meta">
              {message.sender === 'user' ? 'You' : 'AI'} · {message.timestamp.toLocaleTimeString()}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={handleSubmit} className="ai-chat-modern-input-form">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything…"
          className="ai-chat-modern-input"
        />
        <button type="submit" title="Send message" className="ai-chat-modern-send">
          <FaCheck />
        </button>
      </form>
    </div>
  );
};

export default AIChat;