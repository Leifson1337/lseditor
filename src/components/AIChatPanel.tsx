import React from 'react';
import './AIChatPanel.css';

const AIChatPanel: React.FC = () => {
  return (
    <div className="ai-chat-panel">
      <div className="ai-chat-header">
        <h3>AI Assistant</h3>
      </div>
      <div className="ai-chat-messages">
        {/* Chat messages will be rendered here */}
      </div>
      <div className="ai-chat-input">
        <input type="text" placeholder="Ask a question..." />
        <button>Send</button>
      </div>
    </div>
  );
};

export default AIChatPanel; 