import React, { useState } from 'react';
import './AIChatPanel.css';

interface ChatMessage {
  id: string;
  content: string;
  sender: 'user' | 'ai';
  timestamp: Date;
}

const AIChatPanel: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');

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
          <div className="ai-chat-empty">Starte eine Unterhaltung…</div>
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
          placeholder="Frage etwas…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleInputKeyDown}
        />
        <button onClick={handleSend}>Senden</button>
      </div>
    </div>
  );
};

export default AIChatPanel;