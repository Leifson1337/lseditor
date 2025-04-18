import React, { useEffect, useRef } from 'react';
import MonacoEditor from '@monaco-editor/react';
import { useEditorStore } from '../store/editorStore';

interface EditorProps {
  file: string | null;
  onSave: (content: string) => void;
  terminal?: any; // We'll type this properly later
}

export const CodeEditor: React.FC<EditorProps> = ({ file, onSave, terminal }) => {
  const { theme, fontSize, wordWrap, minimap, lineNumbers } = useEditorStore();
  const editorRef = useRef<any>(null);

  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor;
  };

  const handleChange = (value: string | undefined) => {
    if (onSave && value !== undefined) {
      onSave(value);
    }
  };

  return (
    <div className="editor">
      <MonacoEditor
        height="100%"
        defaultLanguage="plaintext"
        defaultValue={file || ''}
        theme={theme}
        options={{
          fontSize,
          wordWrap: wordWrap ? 'on' : 'off',
          minimap: {
            enabled: minimap
          },
          lineNumbers: lineNumbers ? 'on' : 'off',
          automaticLayout: true,
          scrollBeyondLastLine: false,
          renderWhitespace: 'selection',
          tabSize: 2,
          insertSpaces: true,
          autoClosingBrackets: 'always',
          autoClosingQuotes: 'always',
          formatOnPaste: true,
          formatOnType: true,
          suggestOnTriggerCharacters: true,
          acceptSuggestionOnEnter: 'on',
          tabCompletion: 'on',
          wordBasedSuggestions: 'on',
          parameterHints: {
            enabled: true
          }
        }}
        onMount={handleEditorDidMount}
        onChange={handleChange}
      />
      <div className="editor-content">
        {file ? (
          <div>Editing file: {file}</div>
        ) : (
          <div>No file selected</div>
        )}
      </div>
    </div>
  );
}; 