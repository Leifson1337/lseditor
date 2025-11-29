import React from 'react';
import {
  FiHelpCircle,
  FiCodesandbox,
  FiRefreshCw,
  FiTool,
  FiTrendingUp,
  FiBookOpen,
  FiEye
} from 'react-icons/fi';
import './AIToolbar.css';

interface AIToolbarAction {
  id: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
}

interface AIToolbarProps {
  onAction: (action: string) => void;
  isVertical?: boolean;
}

const ACTIONS: AIToolbarAction[] = [
  { id: 'ask', label: 'Ask AI', hint: 'Quick question', icon: <FiHelpCircle /> },
  { id: 'explain', label: 'Explain', hint: 'Summaries', icon: <FiBookOpen /> },
  { id: 'refactor', label: 'Refactor', hint: 'Improve code', icon: <FiRefreshCw /> },
  { id: 'fix', label: 'Fix issues', hint: 'Detect bugs', icon: <FiTool /> },
  { id: 'optimize', label: 'Optimize', hint: 'Speed & memory', icon: <FiTrendingUp /> },
  { id: 'document', label: 'Document', hint: 'Doc blocks', icon: <FiCodesandbox /> },
  { id: 'review', label: 'Review', hint: 'Code quality', icon: <FiEye /> }
];

const AIToolbar: React.FC<AIToolbarProps> = ({ onAction, isVertical = false }) => {
  const orientation = isVertical ? 'vertical' : 'horizontal';

  return (
    <div className={`ai-toolbar ${orientation}`} role="toolbar" aria-orientation={orientation}>
      {ACTIONS.map(action => (
        <button
          key={action.id}
          type="button"
          className="ai-toolbar-button"
          onClick={() => onAction(action.id)}
          title={`${action.label} · ${action.hint}`}
          aria-label={action.label}
        >
          <span className="ai-toolbar-icon" aria-hidden="true">
            {action.icon}
          </span>
          <span className="ai-toolbar-label">
            {action.label}
            <small>{action.hint}</small>
          </span>
        </button>
      ))}
    </div>
  );
};

export default AIToolbar;
