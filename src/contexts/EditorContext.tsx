import React, { createContext, useContext, useState } from 'react';

interface EditorContextType {
  activeFile: string | null;
  setActiveFile: (file: string | null) => void;
  files: { [key: string]: string };
  setFiles: (files: { [key: string]: string }) => void;
}

const EditorContext = createContext<EditorContextType | undefined>(undefined);

export const EditorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [files, setFiles] = useState<{ [key: string]: string }>({});

  return (
    <EditorContext.Provider value={{ activeFile, setActiveFile, files, setFiles }}>
      {children}
    </EditorContext.Provider>
  );
};

export const useEditor = () => {
  const context = useContext(EditorContext);
  if (context === undefined) {
    throw new Error('useEditor must be used within an EditorProvider');
  }
  return context;
}; 