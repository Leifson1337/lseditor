import React, { useState, useCallback, useRef, useEffect } from 'react';
import { TerminalPanel } from './TerminalPanel';
import './TerminalTabs.css';

interface TerminalTabsProps {
  projectPath?: string;
  onClose: () => void;
}

interface TerminalTab {
  id: number;
  title: string;
}

export const TerminalTabs: React.FC<TerminalTabsProps> = ({ projectPath, onClose }) => {
  const [tabs, setTabs] = useState<TerminalTab[]>([{ id: 1, title: 'Terminal 1' }]);
  const [activeTab, setActiveTab] = useState(1);
  const nextIdRef = useRef(2);

  const addTab = useCallback(() => {
    setTabs(prev => {
      const newId = nextIdRef.current++;
      const newTab = { id: newId, title: `Terminal ${newId}` };
      setActiveTab(newId);
      return [...prev, newTab];
    });
  }, []);

  const closeTab = useCallback(
    (id: number) => {
      setTabs(prev => {
        if (prev.length === 1) {
          onClose();
          return prev;
        }

        const updated = prev.filter(tab => tab.id !== id);
        if (id === activeTab && updated.length > 0) {
          const closedIndex = prev.findIndex(tab => tab.id === id);
          const fallback = updated[Math.max(0, closedIndex - 1)] ?? updated[0];
          if (fallback) {
            setActiveTab(fallback.id);
          }
        }
        return updated;
      });
    },
    [activeTab, onClose]
  );

  useEffect(() => {
    if (!tabs.some(tab => tab.id === activeTab) && tabs.length) {
      setActiveTab(tabs[0].id);
    }
  }, [tabs, activeTab]);

  return (
    <div className="terminal-tabs-container">
      <div className="terminal-tabs">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`terminal-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.title}
            <button
              type="button"
              className="close-tab"
              onClick={event => {
                event.stopPropagation();
                closeTab(tab.id);
              }}
              title="Tab schließen"
            >
              x
            </button>
          </div>
        ))}
        <button type="button" className="add-tab" onClick={addTab} title="Neuen Tab öffnen">
          +
        </button>
      </div>
      <div className="terminal-content">
        {tabs.map(tab =>
          activeTab === tab.id ? (
            <TerminalPanel key={tab.id} projectPath={projectPath} onClose={() => closeTab(tab.id)} />
          ) : null
        )}
      </div>
    </div>
  );
};
