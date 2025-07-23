import React from 'react';
import { FileNode } from '../types/FileNode';

interface TabsProps {
  files: string[];
  activeFile: string;
  onFileSelect: (filePath: string) => void;
  onFileClose: (filePath: string) => void;
}

export const Tabs: React.FC<TabsProps> = ({
  files,
  activeFile,
  onFileSelect,
  onFileClose,
}) => {
  if (!files.length) {
    return null;
  }

  return (
    <div className="tabs-container">
      <div className="tabs">
        {files.map((filePath) => (
          <div
            key={filePath}
            className={`tab ${activeFile === filePath ? 'active' : ''}`}
            onClick={() => onFileSelect(filePath)}
          >
            <span className="tab-label">
              {filePath.split('/').pop()}
            </span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onFileClose(filePath);
              }}
              title="Close tab"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Tabs;
