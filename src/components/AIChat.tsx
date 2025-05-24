import React, { useState, useRef, useEffect } from 'react';
import { FaPaperPlane, FaTimes, FaPlus, FaComments, FaTrash, FaSync } from 'react-icons/fa';
import { useAIConversation, ConversationSummary } from '../contexts/AIConversationContext'; // Updated import
import { AIMessage } from '../types/AITypes'; // Direct import for AIMessage
import '../styles/ai-chat-modern.css'; // Assuming this CSS is suitable or will be adapted

// Props for the AIChat component
interface AIChatProps {
  // Messages are now sourced from AIConversationContext
  // onSendMessage is now sourced from AIConversationContext
  isOpen: boolean;
  onClose: () => void;
  onInsertCode?: (code: string) => void; // Optional: if you have code insertion logic
  // onExplain?: (code: string) => void; // Optional: if you have code explanation logic
}

export const AIChat: React.FC<AIChatProps> = ({
  isOpen,
  onClose,
  onInsertCode,
  // onExplain // Not used in this refactor directly, but could be added
}) => {
  const {
    conversationList,
    activeConversationMessages,
    activeConversationId,
    isLoading, // Loading state from context
    error, // Error state from context
    sendMessageToActiveConversation,
    startNewConversationAndSetActive,
    setActiveConversation,
    deleteConversationFromList,
  } = useAIConversation();

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true); // For conversation list

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConversationMessages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && activeConversationId) {
      try {
        await sendMessageToActiveConversation(input);
        setInput('');
      } catch (err) {
        console.error("Failed to send message:", err);
        // Error is also set in context, could display it from there
      }
    } else if (!activeConversationId) {
        // Optionally handle case where no conversation is active, e.g., start a new one
        if (input.trim()) {
            await startNewConversationAndSetActive();
            // sendMessageToActiveConversation will be called in the next input
            // This is a basic handling, might need refinement based on UX preference
            // For now, let's assume user starts a new chat, then types message
        }
    }
  };
  
  const handleStartNewChat = async () => {
    await startNewConversationAndSetActive();
    setIsSidebarOpen(false); // Close sidebar on new chat for mobile-like UX
  };

  const handleSelectConversation = async (id: string) => {
    await setActiveConversation(id);
    setIsSidebarOpen(false); // Close sidebar on selection
  };

  const handleDeleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent selection when deleting
    if (window.confirm('Are you sure you want to delete this conversation?')) {
      await deleteConversationFromList(id);
    }
  };


  if (!isOpen) return null;

  const renderMessageContent = (content: string) => {
    // Basic markdown-like rendering for code blocks
    // A more robust solution would use a library like 'marked' or 'react-markdown'
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      // Text before code block
      if (match.index > lastIndex) {
        parts.push(<span key={`text-${lastIndex}`}>{content.substring(lastIndex, match.index)}</span>);
      }
      // Code block
      const lang = match[1] || 'plaintext';
      const code = match[2];
      parts.push(
        <div key={`code-${match.index}`} className="ai-chat-code-block-container">
          <pre className={`language-${lang}`}>
            <code>{code}</code>
          </pre>
          {onInsertCode && (
            <button 
              onClick={() => onInsertCode(code)} 
              className="ai-chat-insert-code-btn"
              title="Insert code into editor"
            >
              Insert Code
            </button>
          )}
        </div>
      );
      lastIndex = codeBlockRegex.lastIndex;
    }

    // Remaining text after the last code block
    if (lastIndex < content.length) {
      parts.push(<span key={`text-${lastIndex}`}>{content.substring(lastIndex)}</span>);
    }
    
    return parts.length > 0 ? parts : content; // Return content directly if no code blocks
  };


  return (
    <div className={`ai-chat-modern-panel ${isSidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="ai-chat-sidebar">
        <button onClick={handleStartNewChat} className="ai-chat-new-chat-button">
          <FaPlus /> New Chat
        </button>
        <div className="ai-chat-conversation-list">
          {conversationList.length === 0 && <p className="ai-chat-no-convos">No conversations yet.</p>}
          {conversationList.map((conv) => (
            <div
              key={conv.id}
              className={`ai-chat-conversation-item ${conv.id === activeConversationId ? 'active' : ''}`}
              onClick={() => handleSelectConversation(conv.id)}
              title={conv.name}
            >
              <span className="ai-chat-conversation-name">{conv.name}</span>
              <span className="ai-chat-conversation-timestamp">
                {conv.lastMessageTimestamp ? new Date(conv.lastMessageTimestamp).toLocaleTimeString() : ''}
              </span>
               <button 
                onClick={(e) => handleDeleteConversation(conv.id, e)} 
                className="ai-chat-delete-conversation-btn"
                title="Delete conversation"
              >
                <FaTrash />
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="ai-chat-main-content">
        <div className="ai-chat-modern-header">
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="ai-chat-toggle-sidebar">
            <FaComments />
          </button>
          <h3>AI Assistant {activeConversationId ? `(${conversationList.find(c=>c.id === activeConversationId)?.name.substring(0,15)}...)` : ''}</h3>
          <button onClick={onClose} className="ai-chat-modern-close" title="Close chat">
            <FaTimes />
          </button>
        </div>

        {isLoading && <div className="ai-chat-loading"><FaSync className="fa-spin"/> Loading...</div>}
        {error && <div className="ai-chat-error">Error: {error.message}</div>}
        
        <div className="ai-chat-modern-messages">
          {activeConversationMessages.length === 0 && !isLoading && (
            <div className="ai-chat-modern-empty">
              {activeConversationId ? 'No messages in this chat yet. Send one below!' : 'Select a conversation or start a new one.'}
            </div>
          )}
          {activeConversationMessages.map((message: AIMessage) => ( // Explicitly type message
            <div
              key={message.timestamp.toISOString() + message.role} // More robust key
              className={`ai-chat-modern-message ${message.role === 'user' ? 'user' : 'ai'}`}
            >
              <div className="ai-chat-modern-message-content">
                {renderMessageContent(message.content)}
              </div>
              <div className="ai-chat-modern-message-meta">
                {message.role === 'user' ? 'You' : 'AI'} · {new Date(message.timestamp).toLocaleTimeString()}
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
            placeholder={activeConversationId ? "Type your message..." : "Start a new chat or select one"}
            className="ai-chat-modern-input"
            disabled={isLoading || !activeConversationId && input.trim() === ''} // Disable if no active chat unless starting one
          />
          <button 
            type="submit" 
            title="Send message" 
            className="ai-chat-modern-send"
            disabled={isLoading || !input.trim()}
          >
            <FaPaperPlane />
          </button>
        </form>
      </div>
    </div>
  );
};

export default AIChat;