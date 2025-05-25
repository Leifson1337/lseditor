import React from 'react';
import { GitFileDiffSummary } from '../types/GitTypes'; // Assuming GitFileDiffSummary is here
import './MultiFileDiffViewer.css';

interface MultiFileDiffViewerProps {
  diffSummary: GitFileDiffSummary[];
  title: string;
  onFileSelect: (filePath: string, status: GitFileDiffSummary['status'], fromPath?: string) => void;
}

const getStatusClass = (status: GitFileDiffSummary['status']): string => {
  switch (status) {
    case 'A': return 'status-added';
    case 'M': return 'status-modified';
    case 'D': return 'status-deleted';
    case 'R': return 'status-renamed';
    case 'C': return 'status-copied';
    case 'T': return 'status-type-changed';
    case 'U': return 'status-unmerged';
    case '?': return 'status-untracked';
    case '!': return 'status-ignored';
    default: return '';
  }
};

export const MultiFileDiffViewer: React.FC<MultiFileDiffViewerProps> = ({
  diffSummary,
  title,
  onFileSelect,
}) => {
  return (
    <div className="multi-file-diff-viewer">
      <h4>{title} ({diffSummary.length})</h4>
      {diffSummary.length === 0 ? (
        <p className="no-changes-message">No changes.</p>
      ) : (
        <ul className="file-summary-list">
          {diffSummary.map((file) => (
            <li
              key={file.filePath + (file.fromPath || '')}
              className={`file-summary-item ${getStatusClass(file.status)}`}
              onClick={() => onFileSelect(file.filePath, file.status, file.fromPath)}
              title={`Click to view details for ${file.filePath}`}
            >
              <span className={`file-status-badge ${getStatusClass(file.status)}`}>
                {file.status}
              </span>
              <span className="file-path">
                {file.filePath}
                {file.fromPath && (
                  <span className="file-from-path"> (from {file.fromPath})</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default MultiFileDiffViewer;
