import React from 'react';
import { CloseIcon } from './Icons';
import '../styles/TabBar.css';

// Tab represents a single tab in the TabBar
interface Tab {
  id: string;         // Unique identifier for the tab
  title: string;      // Display title of the tab
  path: string;       // Path to the file represented by the tab
  dirty?: boolean;    // True if the tab has unsaved changes
}

// Props for the TabBar component
interface TabBarProps {
  tabs: Tab[];                        // Array of tabs to display
  activeTab: string | null;           // ID of the currently active tab
  onTabClose: (tabId: string) => void; // Callback when a tab is closed
  onTabSelect: (tabId: string) => void; // Callback when a tab is selected
}

// TabBar displays a horizontal list of tabs for open files
export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTab,
  onTabClose,
  onTabSelect
}) => {
  return (
    <div className="tab-bar">
      {/* Render each tab */}
      {tabs.map(tab => (
        <div
          key={tab.id}
          className={`tab ${tab.id === activeTab ? 'active' : ''}`}
          onClick={() => onTabSelect(tab.id)}
        >
          <span className="tab-title">
            {tab.title}{tab.dirty ? ' *' : ''}
          </span>
          {/* Close button for the tab */}
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