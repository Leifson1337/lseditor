import React, { useEffect, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import '../styles/Editor.css';

// Props for the Editor component
interface EditorProps {
  filePath?: string;
  content: string;
  isLoading: boolean;
  onChange?: (value: string) => void;
}

// Editor provides a simple text/code editing area with syntax highlighting preview
export const Editor: React.FC<EditorProps> = ({ filePath, content, isLoading, onChange }) => {
  // State for detected language (for syntax highlighting)
  const [language, setLanguage] = useState<string>('plaintext');
  // State for the current editor value
  const [value, setValue] = useState<string>(content);

  // Update editor value when content prop changes
  useEffect(() => {
    setValue(content);
  }, [content]);

  // Detect language based on file extension when filePath changes
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

  // Handle textarea value change
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    if (onChange) onChange(e.target.value);
  };

  return (
    <div className="editor-root">
      <div className="editor-header">
        {/* Display file name if available */}
        {filePath && <span className="file-name">{filePath}</span>}
      </div>
      <div className="editor-content" style={{ position: 'relative', height: '100%' }}>
        {isLoading ? (
          // Show loading indicator while content is loading
          <div className="editor-loading">Loading...</div>
        ) : (
          // Main editable textarea for code/content
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
        {/* Syntax preview (hidden by default, can be enabled if needed) */}
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