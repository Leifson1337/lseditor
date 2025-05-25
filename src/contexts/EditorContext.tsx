import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { EditorService, OpenTab } from '../services/EditorService';
import { AIService } from '../services/AIService'; // Import AIService
import { CodeSuggestion } from '../types/AITypes'; // Import CodeSuggestion
import { useServices } from './ServiceContext';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

export interface TabSummary {
  id: string;
  title: string;
  filePath: string;
  isDirty: boolean;
}

interface EditorContextType {
  editorService: EditorService | null;
  aiService: AIService | null; // Added AIService to context if needed by consumers directly
  tabs: TabSummary[];
  activeTabId: string | null;
  activeTabContent: string;
  activeTabPath: string | undefined;
  activeTabLanguage: string | undefined;
  primaryEditorInstance: monaco.editor.IStandaloneCodeEditor | null;
  
  openFile: (filePath: string) => Promise<string | void>;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  saveActiveTab: () => Promise<void>;
  updateActiveTabContent: (content: string) => void;
  createEditor: (container: HTMLElement) => void;
}

const EditorContext = createContext<EditorContextType | undefined>(undefined);

export const EditorProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { editorService, aiService } = useServices(); // Get EditorService and AIService

  const [tabs, setTabs] = useState<TabSummary[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [activeTabContent, setActiveTabContent] = useState<string>('');
  const [activeTabPath, setActiveTabPath] = useState<string | undefined>(undefined);
  const [activeTabLanguage, setActiveTabLanguage] = useState<string | undefined>(undefined);
  const [primaryEditorInstance, setPrimaryEditorInstance] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);

  const refreshActiveTabData = useCallback((service: EditorService) => {
    const activeTab = service.getActiveTab();
    if (activeTab && activeTab.model) {
      setActiveTabId(activeTab.id);
      setActiveTabContent(activeTab.model.getValue());
      setActiveTabPath(activeTab.filePath);
      setActiveTabLanguage(activeTab.language);
    } else {
      setActiveTabId(null);
      setActiveTabContent('');
      setActiveTabPath(undefined);
      setActiveTabLanguage(undefined);
    }
  }, []);

  useEffect(() => {
    if (!editorService) return;

    setTabs(editorService.getOpenTabsSummary());
    refreshActiveTabData(editorService);
    if(editorService.getPrimaryEditor()){
        setPrimaryEditorInstance(editorService.getPrimaryEditor());
    }

    const handleTabsChanged = (updatedTabsSummary: TabSummary[]) => setTabs(updatedTabsSummary);
    const handleActiveTabChanged = (event: { activeTabId: string | null; activeTabContent?: string; activeTabPath?: string; activeTabLanguage?: string }) => {
      setActiveTabId(event.activeTabId);
      setActiveTabContent(event.activeTabContent !== undefined ? event.activeTabContent : '');
      setActiveTabPath(event.activeTabPath);
      setActiveTabLanguage(event.activeTabLanguage);
      setTabs(editorService.getOpenTabsSummary()); 
    };
    const handleTabDirtyStateChanged = ({ tabId, isDirty }: { tabId: string; isDirty: boolean }) => {
      setTabs(prevTabs => prevTabs.map(tab => tab.id === tabId ? { ...tab, isDirty } : tab));
    };
    const handleModelContentChanged = ({ tabId, newContent }: {tabId: string, newContent: string}) => {
        if (activeTabId === tabId) setActiveTabContent(newContent);
    };
    const handlePrimaryEditorCreated = (editorInstance: monaco.editor.IStandaloneCodeEditor) => {
        setPrimaryEditorInstance(editorInstance);
    };

    editorService.on('tabsChanged', handleTabsChanged);
    editorService.on('activeTabChanged', handleActiveTabChanged);
    editorService.on('tabDirtyStateChanged', handleTabDirtyStateChanged);
    editorService.on('modelContentChanged', handleModelContentChanged);
    editorService.on('primaryEditorCreated', handlePrimaryEditorCreated);

    // Completion Provider Registration
    let completionDisposables: monaco.IDisposable[] = [];
    if (editorService && aiService) {
      const aiCompletionProvider: monaco.languages.CompletionItemProvider = {
        triggerCharacters: ['.', ' ', '(', '=', '{', '[', '>', '<', '"', "'", '`',':',','], // Configurable trigger characters
        provideCompletionItems: async (model, position, context, token) => {
          const filePath = model.uri.fsPath; // Use fsPath for local file paths

          // Basic check to avoid triggering on every character if not desired
          // For example, only trigger if context.triggerKind is Invoke or TriggerCharacter
          // if (context.triggerKind === monaco.languages.CompletionTriggerKind.TriggerCharacter && 
          //     !['.', '(', ' '].includes(context.triggerCharacter || '')) {
          //     return { suggestions: [] };
          // }
          
          console.log(`Completion triggered at ${filePath} L${position.lineNumber}C${position.column} Kind: ${context.triggerKind} Char: ${context.triggerCharacter}`);

          try {
            const aiSuggestions: CodeSuggestion[] = await aiService.getCodeCompletion(filePath, position);
            
            const monacoSuggestions: monaco.languages.CompletionItem[] = aiSuggestions.map((s, index) => {
              // Determine the range to replace. If a trigger character initiated, include it.
              let range = new monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column
              );
              
              // If triggered by a character, Monaco often expects suggestions to replace that character
              // or start from it. Adjusting the range might be needed based on how Monaco handles it.
              // For simplicity, starting the replacement at the current cursor.
              // A more advanced range could be:
              // model.getWordUntilPosition(position).word -> this gives the word to replace
              // const word = model.getWordUntilPosition(position);
              // range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);

              return {
                label: s.label || s.text, // Prefer text if no label
                kind: monaco.languages.CompletionItemKind.Snippet, // Default to Snippet
                insertText: s.text,
                // insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, // if s.text is a snippet
                range: range, 
                documentation: s.description,
                detail: s.detail,
                sortText: `z${index.toString().padStart(3, '0')}` // Sort AI suggestions after others
              };
            });
            
            return { suggestions: monacoSuggestions, incomplete: false }; // Set incomplete to true if results are partial
          } catch (error) {
            console.error('AI Completion Provider Error:', error);
            return { suggestions: [] };
          }
        },
      };

      const languagesToRegister = ['typescript', 'javascript', 'python', 'html', 'css', 'json', 'markdown']; // Add more as needed
      languagesToRegister.forEach(langId => {
        completionDisposables.push(editorService.registerCompletionProvider(langId, aiCompletionProvider));
      });
    }

    return () => {
      editorService.off('tabsChanged', handleTabsChanged);
      editorService.off('activeTabChanged', handleActiveTabChanged);
      editorService.off('tabDirtyStateChanged', handleTabDirtyStateChanged);
      editorService.off('modelContentChanged', handleModelContentChanged);
      editorService.off('primaryEditorCreated', handlePrimaryEditorCreated);
      completionDisposables.forEach(d => d.dispose()); // Dispose completion providers
    };
  }, [editorService, aiService, refreshActiveTabData, activeTabId]); // Added aiService

  const openFileContext = async (filePath: string): Promise<string | void> => {
    if (!editorService) return;
    return await editorService.openFile(filePath);
  };

  const closeTabContext = (tabId: string) => {
    if (!editorService) return;
    editorService.closeTab(tabId);
  };

  const setActiveTabContext = (tabId: string) => {
    if (!editorService) return;
    editorService.setActiveTabById(tabId);
  };

  const saveActiveTabContext = async () => {
    if (!editorService) return;
    await editorService.saveActiveTab();
  };

  const updateActiveTabContentContext = (content: string) => {
    if (!editorService) return;
    const activeTab = editorService.getActiveTab();
    if (activeTab && activeTab.model) {
      if (activeTab.model.getValue() !== content) {
        activeTab.model.setValue(content); 
      }
    }
  };
  
  const createEditorContext = (container: HTMLElement) => {
    if (!editorService) {
        console.error("EditorService not available to create editor");
        return;
    }
    if (!editorService.getPrimaryEditor()) {
        editorService.createPrimaryEditor(container);
    } else {
        console.warn("Primary editor already exists in EditorService. Ensuring context reflects this.");
        setPrimaryEditorInstance(editorService.getPrimaryEditor());
    }
  };

  return (
    <EditorContext.Provider value={{
      editorService,
      aiService, // Expose AIService
      tabs,
      activeTabId,
      activeTabContent,
      activeTabPath,
      activeTabLanguage,
      primaryEditorInstance,
      openFile: openFileContext,
      closeTab: closeTabContext,
      setActiveTab: setActiveTabContext,
      saveActiveTab: saveActiveTabContext,
      updateActiveTabContent: updateActiveTabContentContext,
      createEditor: createEditorContext,
    }}>
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