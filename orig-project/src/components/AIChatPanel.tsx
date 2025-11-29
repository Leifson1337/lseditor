import React, { useState } from 'react';
import './AIChatPanel.css';

// ChatMessage describes a single message in the AI chat panel
interface ChatMessage {
  id: string;
  content: string;
  sender: 'user' | 'ai';
  timestamp: Date;
}

// AIChatPanel provides a simple chat interface for user/AI interaction
const AIChatPanel: React.FC = () => {
  // State for all chat messages
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // State for the current input value
  const [input, setInput] = useState('');

  // Handle sending a message (user input)
  const handleSend = () => {
    if (input.trim()) {
      setMessages([...messages, {
        id: Date.now().toString(),
        content: input,
        sender: 'user',
        timestamp: new Date()
      }]);
      setInput('');
    }
  };

  // Handle Enter key to send message
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSend();
  };

  return (
    <div className="ai-chat-panel">
      <div className="ai-chat-header">
        <h3>AI Assistant</h3>
      </div>
      <div className="ai-chat-messages">
        {messages.length === 0 ? (
          <div className="ai-chat-empty">Start a conversation…</div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className={`ai-chat-message ${msg.sender}`}>
              <span className="ai-chat-message-content">{msg.content}</span>
            </div>
          ))
        )}
      </div>
      <div className="ai-chat-input">
        <input
          type="text"
          placeholder="Ask something…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleInputKeyDown}
        />
        <button onClick={handleSend}>Send</button>
      </div>
    </div>
  );
};

export default AIChatPanel;