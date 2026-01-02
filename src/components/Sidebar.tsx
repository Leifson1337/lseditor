import React, { useEffect, useState, useRef } from 'react';
import './Sidebar.css';
import { FaFolder, FaCode, FaBrain, FaGitAlt, FaTerminal, FaPuzzlePiece, FaGithub, FaPlus, FaExclamationCircle, FaCodeBranch, FaArrowRight } from 'react-icons/fa';

// Props for the Sidebar component
interface SidebarProps {
  onTabChange?: (tab: string) => void;
  activeTab?: string;
  aiActive?: boolean;
  terminalActive?: boolean;
}

import { ExtensionService } from '../services/ExtensionService';

// Sidebar provides navigation tabs for main app areas (Explorer, Git, GitHub, AI, Terminal, Extensions)
const Sidebar: React.FC<SidebarProps> = ({ onTabChange, activeTab, aiActive = false, terminalActive = false }) => {
  const [showGithubDropdown, setShowGithubDropdown] = useState(false);
  const githubDropdownRef = useRef<HTMLDivElement>(null);
  const [extensionTabs, setExtensionTabs] = useState<{ id: string; label: string; iconUrl?: string }[]>([]);
  useEffect(() => {
    // Subscribe to extension changes
    const unsubscribe = ExtensionService.getInstance().subscribe(async () => {
      // Whenever contributions change, re-fetch the sidebar items
      const items = ExtensionService.getInstance().getSidebarItems();

      // Resolve icons
      const itemsWithIcons = await Promise.all(items.map(async (item) => {
        let iconUrl = undefined;
        if (item.icon) {
          iconUrl = await ExtensionService.getInstance().resolveIcon(item.extensionId, item.icon);
        }
        return { ...item, iconUrl };
      }));

      setExtensionTabs(itemsWithIcons.map(item => ({
        id: item.id,
        label: item.title,
        iconUrl: item.iconUrl
      })));
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    // ... items ...
    const handleClickOutside = (event: MouseEvent) => {
      if (githubDropdownRef.current && !githubDropdownRef.current.contains(event.target as Node)) {
        setShowGithubDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [activeTab]);

  const tabs = [
    { id: 'explorer', icon: <FaFolder />, label: 'Explorer', action: () => onTabChange?.('explorer') },
    { id: 'git', icon: <FaGitAlt />, label: 'Git', action: () => onTabChange?.('git') },
    { id: 'github', icon: <FaGithub />, label: 'GitHub', action: () => setShowGithubDropdown(!showGithubDropdown) },
    { id: 'ai', icon: <FaBrain />, label: 'AI', action: () => onTabChange?.('ai') },
    { id: 'terminal', icon: <FaTerminal />, label: 'Terminal', action: () => onTabChange?.('terminal') },
    { id: 'extensions', icon: <FaPuzzlePiece />, label: 'Extensions', action: () => onTabChange?.('extensions') },
    ...extensionTabs.map(ext => ({
      id: ext.id,
      // Use resolved icon if available, else placeholder
      icon: (ext as any).iconUrl ? <img src={(ext as any).iconUrl} style={{ width: 20, height: 20 }} alt={ext.label} /> : <FaPuzzlePiece />,
      label: ext.label,
      action: () => onTabChange?.(ext.id)
    }))
  ];

  const isTabActive = (tabId: string) => {
    if (tabId === 'ai') {
      return aiActive;
    }
    if (tabId === 'terminal') {
      return terminalActive;
    }
    return activeTab === tabId;
  };

  // Handle a GitHub dropdown action (e.g., Issues, PRs, Repos)
  const handleGithubAction = (action: string) => {
    setShowGithubDropdown(false);
    onTabChange?.('git');
    // Dispatch a custom event that GitPanel can listen for
    const event = new CustomEvent('github-action', {
      detail: { action }
    });
    document.dispatchEvent(event);
  };

  console.log('Sidebar rendering');

  return (
    <div className="sidebar">
      <div className="sidebar-tabs">
        {/* Render navigation button for each tab */}
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`sidebar-tab ${isTabActive(tab.id) ? 'active' : ''}`}
            onClick={tab.action}
            title={tab.label}
          >
            {tab.icon}
          </button>
        ))}
      </div>

      {/* GitHub dropdown menu for advanced GitHub actions */}
      {showGithubDropdown && (
        <div className="github-dropdown" ref={githubDropdownRef}>
          <div className="github-dropdown-header">
            <FaGithub />
            <span>GitHub</span>
          </div>
          <div className="github-dropdown-content">
            <button onClick={() => handleGithubAction('issues')}>
              <FaExclamationCircle />
              <span>Issues</span>
            </button>
            <button onClick={() => handleGithubAction('pullRequests')}>
              <FaArrowRight />
              <span>Pull Requests</span>
            </button>
            <button onClick={() => handleGithubAction('repositories')}>
              <FaCodeBranch />
              <span>Repositories</span>
            </button>
            <button onClick={() => handleGithubAction('newRepo')}>
              <FaPlus />
              <span>New Repository</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Sidebar;
