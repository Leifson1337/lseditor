import React, { useEffect, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import '../styles/Editor.css';

interface EditorProps {
  filePath?: string;
  content: string;
  isLoading: boolean;
  onChange?: (value: string) => void;
}

export const Editor: React.FC<EditorProps> = ({ filePath, content, isLoading, onChange }) => {
  const [language, setLanguage] = useState<string>('plaintext');
  const [value, setValue] = useState<string>(content);

  useEffect(() => {
    setValue(content);
  }, [content]);

  useEffect(() => {
    if (filePath && typeof filePath === 'string') {
      const extension = filePath.split('.').pop()?.toLowerCase();
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
        case 'txt': lang = 'text'; break;
        default: lang = 'plaintext';
      }
      setLanguage(lang);
    }
  }, [filePath]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    if (onChange) onChange(e.target.value);
  };

  return (
    <div className="editor-root">
      <div className="editor-header">
        {filePath && <span className="file-name">{filePath}</span>}
      </div>
      <div className="editor-content" style={{ position: 'relative', height: '100%' }}>
        {isLoading ? (
          <div className="editor-loading">Lädt...</div>
        ) : (
          <textarea
            value={value}
            onChange={handleChange}
            className="editor-textarea"
            style={{
              width: '100%',
              height: '100%',
              fontSize: '14px',
              fontFamily: 'Consolas, Monaco, "Andale Mono", "Ubuntu Mono", monospace',
              background: '#1e1e1e',
              color: '#d4d4d4',
              border: 'none',
              resize: 'none',
              outline: 'none',
              padding: '1rem',
              boxSizing: 'border-box',
            }}
          />
        )}
        <div className="editor-syntax-preview" style={{ display: 'none' }}>
          <SyntaxHighlighter
            language={language}
            style={vscDarkPlus}
            customStyle={{
              margin: 0,
              padding: '1rem',
              height: '100%',
              fontSize: '14px',
              lineHeight: '1.5',
              fontFamily: 'Consolas, Monaco, "Andale Mono", "Ubuntu Mono", monospace',
              background: 'transparent',
            }}
          >
            {value}
          </SyntaxHighlighter>
        </div>
      </div>
    </div>
  );
};