import React, { useState, useEffect, useCallback } from 'react';
import AIChatPanel from './AIChatPanel';
import { FileNode } from './EditorLayout';
import { ChatMessage } from './AIChatPanel';
import { FaTimes, FaPlus } from 'react-icons/fa';

interface AIChatPanelWrapperProps {
  fileStructure: FileNode[];
  projectPath: string;
  onCodeProposal: (code: string, filePath?: string) => void;
  readFile: (path: string) => Promise<string>;
  messages?: ChatMessage[];
  onMessagesChange?: (messages: ChatMessage[]) => void;
  onNewChat?: () => void;
  onClose?: () => void; // Add onClose prop
}

const AIChatPanelWrapper: React.FC<AIChatPanelWrapperProps> = ({
  fileStructure,
  projectPath,
  onCodeProposal,
  readFile,
  messages: externalMessages = [],
  onMessagesChange,
  onNewChat,
  onClose
}) => {
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [activeChatId, setActiveChatId] = useState<string>(() => Date.now().toString());

  // Determine if we're in controlled or uncontrolled mode
  const isControlled = onMessagesChange !== undefined;
  
  // Use external messages if provided, otherwise use local state
  const messages = isControlled ? externalMessages : localMessages;
  
  // Create a setMessages function that works in both modes
  const setMessages = useCallback((newMessages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    if (isControlled) {
      if (typeof newMessages === 'function') {
        onMessagesChange?.(newMessages(messages));
      } else {
        onMessagesChange?.(newMessages);
      }
    } else {
      if (typeof newMessages === 'function') {
        setLocalMessages(prev => newMessages([...prev]));
      } else {
        setLocalMessages(newMessages);
      }
    }
  }, [isControlled, messages, onMessagesChange]);

  // Reset local state when a new chat is requested
  const handleNewChat = () => {
    if (isControlled && onNewChat) {
      onNewChat();
    } else {
      setLocalMessages([]);
      setActiveChatId(Date.now().toString());
    }
  };
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      width: '100%',
      minWidth: 0,
      overflow: 'hidden'
    }}>
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        height: '100%',
        backgroundColor: 'var(--editor-background, #1e1e1e)'
      }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 16px',
          borderBottom: '1px solid var(--border-color, #333)',
          backgroundColor: 'var(--titleBar-activeBackground, #2d2d2d)'
        }}>
          <h3 style={{ 
            margin: 0, 
            fontSize: '13px',
            fontWeight: 600,
            color: 'var(--titleBar-activeForeground, #ffffff)'
          }}>
            AI Assistant
          </h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button 
              onClick={handleNewChat}
              style={{
                background: 'transparent',
                color: 'var(--titleBar-activeForeground, #ffffff)',
                border: '1px solid var(--button-border, #3c3c3c)',
                borderRadius: '3px',
                padding: '2px 8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '12px',
                transition: 'all 0.2s ease'
              }}
              onMouseOver={(e) => e.currentTarget.style.background = 'rgba(90, 93, 94, 0.5)'}
              onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <FaPlus size={12} />
              <span>New Chat</span>
            </button>
            {onClose && (
              <button 
                onClick={onClose}
                style={{
                  background: 'transparent',
                  color: 'var(--titleBar-activeForeground, #ffffff)',
                  border: '1px solid var(--button-border, #3c3c3c)',
                  borderRadius: '3px',
                  width: '24px',
                  height: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
                onMouseOver={(e) => e.currentTarget.style.background = 'rgba(90, 93, 94, 0.5)'}
                onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <FaTimes size={12} />
              </button>
            )}
          </div>
        </div>
        <AIChatPanel 
          key={activeChatId}
          style={{ 
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            width: '100%',
            minWidth: 0,
            overflow: 'hidden',
          }}
          fileStructure={fileStructure}
          projectPath={projectPath}
          messages={messages}
          onMessagesChange={setMessages}
          onCodeProposal={onCodeProposal}
          readFile={readFile}
        />
      </div>
    </div>
  );
};

export default AIChatPanelWrapper;
