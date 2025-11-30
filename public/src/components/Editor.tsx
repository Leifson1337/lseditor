import React, { useEffect, useState } from 'react';
import { Editor as MonacoEditor } from '@monaco-editor/react';
import '../styles/editor.css';

// Props for the Editor component
interface EditorProps {
  filePath?: string;
  content: string;
  onChange?: (value: string) => void;
  language?: string;
  wordWrap?: 'on' | 'off' | 'wordWrapColumn' | 'bounded';
  onMount?: (editor: any) => void;
}

// Editor provides a simple text/code editing area using Monaco Editor
export const Editor: React.FC<EditorProps> = ({
  filePath,
  content,
  onChange,
  language = 'plaintext',
  wordWrap = 'on',
  onMount
}) => {
  // State for the current editor value
  const [value, setValue] = useState<string>(content);

  // Update editor value when content prop changes
  useEffect(() => {
    setValue(content);
  }, [content]);

  // Handle editor value change
  const handleChange = (newValue: string | undefined) => {
    const val = newValue || '';
    setValue(val);
    if (onChange) {
      onChange(val);
    }
  };

  return (
    <div className="editor-root">
      <div className="editor-header">
        {/* Display file name if available */}
        {filePath && <span className="file-name">{filePath}</span>}
      </div>
      <div className="editor-content">
        <MonacoEditor
          height="100%"
          language={language}
          value={value}
          onChange={handleChange}
          onMount={onMount}
          theme="vs-dark"
          options={{
            fontSize: 16,
            minimap: { enabled: true },
            wordWrap: wordWrap,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            lineNumbers: 'on',
            glyphMargin: true,
            renderLineHighlight: 'all',
            scrollbar: {
              vertical: 'auto',
              horizontal: 'auto'
            }
          }}
        />
      </div>
    </div>
  );
};
