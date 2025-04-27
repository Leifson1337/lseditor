// editorStore.ts
// Zustand store for managing editor state in the application

import { create } from 'zustand';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

/**
 * FileTab represents a file opened in the editor.
 */
interface FileTab {
  /**
   * Unique identifier for the file tab.
   */
  id: string;
  /**
   * Path of the file.
   */
  path: string;
  /**
   * Content of the file.
   */
  content: string;
  /**
   * Language mode of the file (e.g., 'typescript', 'python').
   */
  language: string;
  /**
   * Whether the file tab is currently active.
   */
  isActive: boolean;
}

/**
 * EditorState defines the shape of the editor state managed by the store.
 */
interface EditorState {
  /**
   * Array of file tabs.
   */
  files: FileTab[];
  /**
   * ID of the currently active file tab.
   */
  activeFileId: string | null;
  /**
   * Reference to the Monaco editor instance.
   */
  editor: monaco.editor.IStandaloneCodeEditor | null;
  /**
   * Editor theme.
   */
  theme: 'light' | 'dark' | 'high-contrast';
  /**
   * Font size of the editor.
   */
  fontSize: number;
  /**
   * Whether word wrap is enabled.
   */
  wordWrap: boolean;
  /**
   * Whether the minimap is enabled.
   */
  minimap: boolean;
  /**
   * Whether line numbers are enabled.
   */
  lineNumbers: boolean;
  /**
   * Sets the Monaco editor instance.
   */
  setEditor: (editor: monaco.editor.IStandaloneCodeEditor) => void;
  /**
   * Adds a new file tab.
   */
  addFile: (file: Omit<FileTab, 'id'>) => void;
  /**
   * Removes a file tab by ID.
   */
  removeFile: (id: string) => void;
  /**
   * Sets the active file tab by ID.
   */
  setActiveFile: (id: string) => void;
  /**
   * Updates the content of a file tab by ID.
   */
  updateFileContent: (id: string, content: string) => void;
  /**
   * Sets the editor theme.
   */
  setTheme: (theme: 'light' | 'dark' | 'high-contrast') => void;
  /**
   * Sets the font size of the editor.
   */
  setFontSize: (size: number) => void;
  /**
   * Toggles word wrap.
   */
  toggleWordWrap: () => void;
  /**
   * Toggles the minimap.
   */
  toggleMinimap: () => void;
  /**
   * Toggles line numbers.
   */
  toggleLineNumbers: () => void;
}

/**
 * useEditorStore is a Zustand store hook for managing editor state.
 */
export const useEditorStore = create<EditorState>((set) => ({
  /**
   * Initial array of file tabs.
   */
  files: [],
  /**
   * Initial active file tab ID.
   */
  activeFileId: null,
  /**
   * Initial Monaco editor instance.
   */
  editor: null,
  /**
   * Initial editor theme.
   */
  theme: 'dark',
  /**
   * Initial font size of the editor.
   */
  fontSize: 14,
  /**
   * Initial word wrap state.
   */
  wordWrap: false,
  /**
   * Initial minimap state.
   */
  minimap: true,
  /**
   * Initial line numbers state.
   */
  lineNumbers: true,
  /**
   * Sets the Monaco editor instance.
   */
  setEditor: (editor) => set({ editor }),
  /**
   * Adds a new file tab.
   */
  addFile: (file) => set((state) => ({
    files: [...state.files, { ...file, id: Math.random().toString(36).substr(2, 9) }]
  })),
  /**
   * Removes a file tab by ID.
   */
  removeFile: (id) => set((state) => ({
    files: state.files.filter(f => f.id !== id),
    activeFileId: state.activeFileId === id ? null : state.activeFileId
  })),
  /**
   * Sets the active file tab by ID.
   */
  setActiveFile: (id) => set({ activeFileId: id }),
  /**
   * Updates the content of a file tab by ID.
   */
  updateFileContent: (id, content) => set((state) => ({
    files: state.files.map(f => f.id === id ? { ...f, content } : f)
  })),
  /**
   * Sets the editor theme.
   */
  setTheme: (theme) => set({ theme }),
  /**
   * Sets the font size of the editor.
   */
  setFontSize: (fontSize) => set({ fontSize }),
  /**
   * Toggles word wrap.
   */
  toggleWordWrap: () => set((state) => ({ wordWrap: !state.wordWrap })),
  /**
   * Toggles the minimap.
   */
  toggleMinimap: () => set((state) => ({ minimap: !state.minimap })),
  /**
   * Toggles line numbers.
   */
  toggleLineNumbers: () => set((state) => ({ lineNumbers: !state.lineNumbers }))
}));