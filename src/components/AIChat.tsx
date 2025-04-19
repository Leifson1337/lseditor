import React, { useState, useRef, useEffect } from 'react';
import { FaCheck, FaTimes, FaCode, FaQuestion } from 'react-icons/fa';
import { useAI } from '../contexts/AIContext';
import '../styles/ai-chat-modern.css';

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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      sendMessage(input);
      setInput('');
    }
  };

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
        {messages.length === 0 && (
          <div className="ai-chat-modern-empty">Start a conversation with your AI assistant…</div>
        )}
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