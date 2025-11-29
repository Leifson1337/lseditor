import React from 'react';
import './AIToolbar.css';

// Props for the AIToolbar component
interface AIToolbarProps {
  // Callback function to handle AI action events
  onAction: (action: string) => void;
  // Optional prop to determine the orientation of the toolbar (vertical or horizontal)
  isVertical?: boolean;
}

// AIToolbar renders a toolbar for common AI actions (Ask, Explain, Refactor, etc.)
const AIToolbar: React.FC<AIToolbarProps> = ({ onAction, isVertical = false }) => {
  // List of available AI actions, each with an icon and label
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
    // Container element for the toolbar with dynamic class names based on orientation
    <div className={`ai-toolbar ${isVertical ? 'vertical' : 'horizontal'}`}>
      {/* Render a button for each AI action */}
      {aiActions.map(action => (
        // Individual button for each AI action
        <button
          // Unique key for the button
          key={action.id}
          // Class name for styling
          className="ai-toolbar-button"
          // Handle click event by calling the onAction callback with the action ID
          onClick={() => onAction(action.id)}
          // Tooltip text for the button
          title={action.label}
        >
          // Icon for the AI action
          <span className="ai-toolbar-icon">{action.icon}</span>
          // Label for the AI action
          <span className="ai-toolbar-label">{action.label}</span>
        </button>
      ))}
    </div>
  );
};

// Export the AIToolbar component as the default export
export default AIToolbar;