import React, { useRef, useState } from 'react';
import { CloseIcon } from './Icons';
import { ExtensionActions } from './ExtensionActions';
import '../styles/TabBar.css';

export interface Tab {
  id: string;
  title: string;
  path: string;
  dirty?: boolean;
  content: string;
}

interface TabBarProps {
  tabs: Tab[];
  activeTab: string | null;
  onTabClose: (tabId: string) => void;
  onTabSelect: (tabId: string) => void;
  onTabsReorder?: (newOrder: Tab[]) => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTab,
  onTabClose,
  onTabSelect,
  onTabsReorder
}) => {
  const dragSrcId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, tabId: string) => {
    dragSrcId.current = tabId;
    e.dataTransfer.effectAllowed = 'move';
    // Use empty image so the browser ghost doesn't flicker
    const ghost = document.createElement('div');
    ghost.style.position = 'absolute';
    ghost.style.top = '-1000px';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    requestAnimationFrame(() => document.body.removeChild(ghost));
  };

  const handleDragOver = (e: React.DragEvent, tabId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (tabId !== dragSrcId.current) {
      setDragOverId(tabId);
    }
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDragOverId(null);
    const srcId = dragSrcId.current;
    if (!srcId || srcId === targetId || !onTabsReorder) return;

    const srcIdx = tabs.findIndex(t => t.id === srcId);
    const tgtIdx = tabs.findIndex(t => t.id === targetId);
    if (srcIdx === -1 || tgtIdx === -1) return;

    const next = [...tabs];
    const [removed] = next.splice(srcIdx, 1);
    next.splice(tgtIdx, 0, removed);
    onTabsReorder(next);
  };

  const handleDragEnd = () => {
    dragSrcId.current = null;
    setDragOverId(null);
  };

  return (
    <div className="tab-bar">
      <div className="tabs-scroll-container">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`tab ${tab.id === activeTab ? 'active' : ''} ${dragOverId === tab.id ? 'drag-over' : ''}`}
            onClick={() => onTabSelect(tab.id)}
            draggable
            onDragStart={e => handleDragStart(e, tab.id)}
            onDragOver={e => handleDragOver(e, tab.id)}
            onDrop={e => handleDrop(e, tab.id)}
            onDragEnd={handleDragEnd}
            onDragLeave={() => setDragOverId(null)}
          >
            <span className="tab-title">
              {tab.title}{tab.dirty ? ' *' : ''}
            </span>
            <button
              className="tab-close"
              onClick={e => { e.stopPropagation(); onTabClose(tab.id); }}
              title={`Close ${tab.title}`}
            >
              <CloseIcon />
            </button>
          </div>
        ))}
      </div>
      <ExtensionActions />
    </div>
  );
};
