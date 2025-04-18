import { create } from 'zustand';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

interface FileTab {
  id: string;
  path: string;
  content: string;
  language: string;
  isActive: boolean;
}

interface EditorState {
  files: FileTab[];
  activeFileId: string | null;
  editor: monaco.editor.IStandaloneCodeEditor | null;
  theme: 'light' | 'dark' | 'high-contrast';
  fontSize: number;
  wordWrap: boolean;
  minimap: boolean;
  lineNumbers: boolean;
  setEditor: (editor: monaco.editor.IStandaloneCodeEditor) => void;
  addFile: (file: Omit<FileTab, 'id'>) => void;
  removeFile: (id: string) => void;
  setActiveFile: (id: string) => void;
  updateFileContent: (id: string, content: string) => void;
  setTheme: (theme: 'light' | 'dark' | 'high-contrast') => void;
  setFontSize: (size: number) => void;
  toggleWordWrap: () => void;
  toggleMinimap: () => void;
  toggleLineNumbers: () => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  files: [],
  activeFileId: null,
  editor: null,
  theme: 'dark',
  fontSize: 14,
  wordWrap: false,
  minimap: true,
  lineNumbers: true,
  setEditor: (editor) => set({ editor }),
  addFile: (file) => set((state) => ({
    files: [...state.files, { ...file, id: Math.random().toString(36).substr(2, 9) }]
  })),
  removeFile: (id) => set((state) => ({
    files: state.files.filter(f => f.id !== id),
    activeFileId: state.activeFileId === id ? null : state.activeFileId
  })),
  setActiveFile: (id) => set({ activeFileId: id }),
  updateFileContent: (id, content) => set((state) => ({
    files: state.files.map(f => f.id === id ? { ...f, content } : f)
  })),
  setTheme: (theme) => set({ theme }),
  setFontSize: (fontSize) => set({ fontSize }),
  toggleWordWrap: () => set((state) => ({ wordWrap: !state.wordWrap })),
  toggleMinimap: () => set((state) => ({ minimap: !state.minimap })),
  toggleLineNumbers: () => set((state) => ({ lineNumbers: !state.lineNumbers }))
})); 