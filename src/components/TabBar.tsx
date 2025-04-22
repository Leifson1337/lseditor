import React from 'react';
import { CloseIcon } from './Icons';
import '../styles/TabBar.css';

interface Tab {
  id: string;
  title: string;
  path: string;
  dirty?: boolean;
}

interface TabBarProps {
  tabs: Tab[];
  activeTab: string | null;
  onTabClose: (tabId: string) => void;
  onTabSelect: (tabId: string) => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTab,
  onTabClose,
  onTabSelect
}) => {
  return (
    <div className="tab-bar">
      {tabs.map(tab => (
        <div
          key={tab.id}
          className={`tab ${tab.id === activeTab ? 'active' : ''}`}
          onClick={() => onTabSelect(tab.id)}
        >
          <span className="tab-title">
            {tab.title}{tab.dirty ? ' *' : ''}
          </span>
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              onTabClose(tab.id);
            }}
            title={`Close ${tab.title}`}
          >
            <CloseIcon />
          </button>
        </div>
      ))}
    </div>
  );
}; 