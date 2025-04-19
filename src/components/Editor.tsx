import React, { useEffect, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import '../styles/Editor.css';

interface EditorProps {
  filePath?: string;
  content: string;
  isLoading: boolean;
}

export const Editor: React.FC<EditorProps> = ({ filePath, content, isLoading }) => {
  const [language, setLanguage] = useState<string>('plaintext');

  useEffect(() => {
    if (filePath && typeof filePath === 'string') {
      const extension = filePath.split('.').pop()?.toLowerCase();
      // Mappe Dateiendungen auf SyntaxHighlighter-Sprachen
      let lang = 'plaintext';
      switch (extension) {
        case 'js': lang = 'javascript'; break;
        case 'ts': lang = 'typescript'; break;
        case 'tsx': lang = 'tsx'; break;
        case 'jsx': lang = 'jsx'; break;
        case 'json': lang = 'json'; break;
        case 'css': lang = 'css'; break;
        case 'html': lang = 'html'; break;
        case 'md': lang = 'markdown'; break;
        case 'py': lang = 'python'; break;
        case 'sh': lang = 'bash'; break;
        case 'yml':
        case 'yaml': lang = 'yaml'; break;
        case 'xml': lang = 'xml'; break;
        case 'c': lang = 'c'; break;
        case 'cpp': lang = 'cpp'; break;
        case 'java': lang = 'java'; break;
        case 'go': lang = 'go'; break;
        case 'php': lang = 'php'; break;
        case 'rs': lang = 'rust'; break;
        case 'swift': lang = 'swift'; break;
        case 'rb': lang = 'ruby'; break;
        case 'sql': lang = 'sql'; break;
        default: lang = extension || 'plaintext'; break;
      }
      setLanguage(lang);
    } else {
      setLanguage('plaintext');
    }
  }, [filePath]);

  if (isLoading) {
    return (
      <div className="editor-container">
        <div className="editor-loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="editor-container">
      <div className="editor-header">
        {filePath && <span className="file-name">{filePath}</span>}
      </div>
      <div className="editor-content">
        <SyntaxHighlighter
          language={language}
          style={vscDarkPlus}
          customStyle={{
            margin: 0,
            padding: '1rem',
            height: '100%',
            fontSize: '14px',
            lineHeight: '1.5',
            fontFamily: 'Consolas, Monaco, "Andale Mono", "Ubuntu Mono", monospace'
          }}
        >
          {content}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}; 