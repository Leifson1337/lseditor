import React, { createContext, useContext, useState } from 'react';

// EditorContextType defines the shape of the editor context value
interface EditorContextType {
  activeFile: string | null;                        // Path of the currently active file
  setActiveFile: (file: string | null) => void;     // Function to set the active file
  files: { [key: string]: string };                 // Map of file paths to file contents
  setFiles: (files: { [key: string]: string }) => void; // Function to set the files map
}

// Create a React context for editor state management
const EditorContext = createContext<EditorContextType | undefined>(undefined);

// EditorProvider wraps children with editor context and state management
export const EditorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Track the currently active file
  const [activeFile, setActiveFile] = useState<string | null>(null);
  // Track open files and their contents
  const [files, setFiles] = useState<{ [key: string]: string }>({});

  return (
    // Provide the editor context value to wrapped children
    <EditorContext.Provider value={{ activeFile, setActiveFile, files, setFiles }}>
      {children}
    </EditorContext.Provider>
  );
};

// Custom hook to use the editor context
export const useEditor = () => {
  const context = useContext(EditorContext);
  if (context === undefined) {
    throw new Error('useEditor must be used within an EditorProvider');
  }
  return context;
};