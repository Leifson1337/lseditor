import React from 'react';
import './TabBar.css';

export interface TabBarProps {
  openFiles: string[];
  activeFile: string | null;
  onTabClick: (filePath: string) => void;
  onTabClose: (filePath: string) => void;
}

const TabBar: React.FC<TabBarProps> = ({ 
  openFiles, 
  activeFile, 
  onTabClick, 
  onTabClose 
}) => {
  const getFileName = (filePath: string): string => {
    const parts = filePath.split('/');
    return parts[parts.length - 1];
  };

  return (
    <div className="tab-bar">
      {openFiles.map(filePath => (
        <div 
          key={filePath}
          className={`tab ${activeFile === filePath ? 'active' : ''}`}
          onClick={() => onTabClick(filePath)}
        >
          <span className="tab-title">{getFileName(filePath)}</span>
          <button 
            className="tab-close-button"
            onClick={(e) => {
              e.stopPropagation();
              onTabClose(filePath);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
};

export default TabBar; 