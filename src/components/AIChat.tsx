import React, { useState, useRef, useEffect } from 'react';
import { FaCheck, FaTimes, FaCode, FaQuestion } from 'react-icons/fa';
import { useAI } from '../contexts/AIContext';
import '../styles/aichat.css';

interface Message {
  id: string;
  content: string;
  sender: 'user' | 'ai';
  timestamp: Date;
}

interface AIChatProps {
  messages: Message[];
  onSendMessage: (message: string) => void;
  isOpen: boolean;
  onClose: () => void;
  onInsertCode: (code: string) => void;
  onExplain: (code: string) => void;
}

export const AIChat: React.FC<AIChatProps> = ({
  messages,
  onSendMessage,
  isOpen,
  onClose,
  onInsertCode,
  onExplain
}) => {
  const [input, setInput] = useState('');
  const { sendMessage } = useAI();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      sendMessage(input);
      setInput('');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="ai-chat">
      <div className="chat-header">
        <h3>AI Assistant</h3>
        <button onClick={onClose} className="close-button" title="Close chat">
          <FaTimes />
        </button>
      </div>
      <div className="chat-messages">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`message ${message.sender === 'user' ? 'user-message' : 'ai-message'}`}
          >
            <div className="message-content">{message.content}</div>
            <div className="message-timestamp">
              {message.timestamp.toLocaleTimeString()}
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="chat-input-form">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message..."
          className="chat-input"
        />
        <button type="submit" title="Send message" className="send-button">
          Send
        </button>
      </form>
    </div>
  );
};

export default AIChat; 