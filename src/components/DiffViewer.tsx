import React from 'react';
import { DiffResult, GitDiffChange } from '../services/GitService'; // Assuming GitDiffChange is exported from GitService or a types file
import './DiffViewer.css';

interface DiffViewerProps {
  diffResult: DiffResult;
  filePath: string;
}

const DiffViewer: React.FC<DiffViewerProps> = ({ diffResult, filePath }) => {
  // Helper function to determine line class based on type
  const getLineClass = (changeType?: 'added' | 'removed' | 'modified') => {
    switch (changeType) {
      case 'added':
        return 'diff-line added';
      case 'removed':
        return 'diff-line removed';
      default:
        return 'diff-line context'; // For unchanged lines or headers
    }
  };

  // simple-git's DiffResult.raw already provides a unified diff.
  // We can split it by lines and then process each line.
  // For more structured data, diffResult.changed could be used if it provides enough context (e.g. original line numbers).
  // For now, let's try parsing the raw diff.

  const renderRawDiff = (rawDiff: string) => {
    const lines = rawDiff.split('\\n');
    let lineNumber = 0;

    return lines.map((line, index) => {
      if (line.startsWith('@@')) {
        // Attempt to extract line numbers from hunk header, e.g., @@ -1,3 +1,4 @@
        // This is a simplified parser for hunk headers.
        const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          // For simplicity, we'll just use the starting line number of the new file part.
          // A more robust parser would track both old and new line numbers.
          lineNumber = parseInt(match[2], 10) -1; // -1 because we increment before rendering the first content line
        }
        return (
          <div key={index} className="diff-line hunk-header">
            <span className="line-content">{line}</span>
          </div>
        );
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        lineNumber++;
        return (
          <div key={index} className={getLineClass('added')}>
            <span className="line-number new-line-number">{lineNumber}</span>
            <span className="line-prefix">+</span>
            <span className="line-content">{line.substring(1)}</span>
          </div>
        );
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        // We don't increment the main lineNumber for removed lines,
        // as they don't appear in the "new" version.
        // A side-by-side view or a more complex inline view would track old line numbers.
        return (
          <div key={index} className={getLineClass('removed')}>
            <span className="line-number old-line-number"> </span>
            <span className="line-prefix">-</span>
            <span className="line-content">{line.substring(1)}</span>
          </div>
        );
      } else if (line.startsWith(' ')) { // Context line
        lineNumber++;
        return (
          <div key={index} className={getLineClass()}>
            <span className="line-number new-line-number">{lineNumber}</span>
            <span className="line-prefix"> </span>
            <span className="line-content">{line.substring(1)}</span>
          </div>
        );
      }
      // Ignore other lines like diff header (e.g. "diff --git a/file b/file") for now
      // or render them as simple context if needed.
      if (line.startsWith('diff --git') || line.startsWith('index') || line.startsWith('--- a/') || line.startsWith('+++ b/')) {
         return (
          <div key={index} className="diff-line diff-meta-header">
            <span className="line-content">{line}</span>
          </div>
        );
      }
      return null; // Or render as plain text if unexpected line format
    });
  };

  return (
    <div className="diff-viewer">
      <h4>Diff for {filePath}</h4>
      <pre className="diff-content">
        {renderRawDiff(diffResult.raw)}
      </pre>
    </div>
  );
};

export default DiffViewer;
