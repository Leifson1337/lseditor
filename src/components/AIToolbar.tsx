import React from 'react';
import './AIToolbar.css';

interface AIToolbarProps {
  onAction: (action: string) => void;
  isVertical?: boolean;
}

const AIToolbar: React.FC<AIToolbarProps> = ({ onAction, isVertical = false }) => {
  const aiActions = [
    { id: 'ask', icon: '💬', label: 'Ask AI' },
    { id: 'explain', icon: '📝', label: 'Explain' },
    { id: 'refactor', icon: '🔄', label: 'Refactor' },
    { id: 'fix', icon: '🔧', label: 'Fix' },
    { id: 'optimize', icon: '⚡', label: 'Optimize' },
    { id: 'document', icon: '📚', label: 'Document' },
    { id: 'review', icon: '👀', label: 'Review' }
  ];

  return (
    <div className={`ai-toolbar ${isVertical ? 'vertical' : 'horizontal'}`}>
      {aiActions.map(action => (
        <button
          key={action.id}
          className="ai-toolbar-button"
          onClick={() => onAction(action.id)}
          title={action.label}
        >
          <span className="ai-toolbar-icon">{action.icon}</span>
          <span className="ai-toolbar-label">{action.label}</span>
        </button>
      ))}
    </div>
  );
};

export default AIToolbar; 