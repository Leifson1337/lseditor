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
      setLanguage(extension || 'plaintext');
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