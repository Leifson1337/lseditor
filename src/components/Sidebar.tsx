import React, { useEffect } from 'react';
import './Sidebar.css';
import { FaFolder, FaCode, FaBrain, FaGitAlt, FaSearch, FaTerminal, FaPuzzlePiece } from 'react-icons/fa';

interface SidebarProps {
  children: React.ReactNode;
  onTabChange?: (tab: string) => void;
  activeTab?: string;
}

const Sidebar: React.FC<SidebarProps> = ({ children, onTabChange, activeTab }) => {
  useEffect(() => {
    console.log('Sidebar component mounted');
    console.log('Sidebar activeTab:', activeTab);
  }, [activeTab]);

  const tabs = [
    { id: 'explorer', icon: <FaFolder />, label: 'Explorer', action: () => onTabChange?.('explorer') },
    { id: 'git', icon: <FaGitAlt />, label: 'Git', action: () => onTabChange?.('git') },
    { id: 'search', icon: <FaSearch />, label: 'Search', action: () => onTabChange?.('search') },
    { id: 'ai', icon: <FaBrain />, label: 'AI', action: () => onTabChange?.('ai') },
    { id: 'terminal', icon: <FaTerminal />, label: 'Terminal', action: () => onTabChange?.('terminal') },
    { id: 'extensions', icon: <FaPuzzlePiece />, label: 'Extensions', action: () => onTabChange?.('extensions') },
  ];

  console.log('Sidebar rendering');

  return (
    <div className="sidebar">
      <div className="sidebar-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`sidebar-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={tab.action}
            title={tab.label}
          >
            {tab.icon}
          </button>
        ))}
      </div>
      <div className="sidebar-content">
        {children}
      </div>
    </div>
  );
};

export default Sidebar; 