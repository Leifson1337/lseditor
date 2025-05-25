import React, { useState, useEffect } from 'react';
import { Editor } from '@monaco-editor/react';
import { FileExplorer } from './FileExplorer';
import { TabBar } from './TabBar';
import Sidebar from './Sidebar';
// import AIChatPanel from './AIChatPanel'; // Removed
import { TerminalPanel } from './TerminalPanel'; // Import TerminalPanel
import { ThemeProvider } from '../contexts/ThemeContext';
// import { EditorProvider } from '../contexts/EditorContext'; // Will be provided by App.tsx
// import { AIProvider } from '../contexts/AIContext'; // Will be provided by App.tsx
import { useEditor } from '../contexts/EditorContext'; // Use the new EditorContext
import { PluginManagerPanel } from './PluginManagerPanel'; 
import { CommandPalette } from './CommandPalette'; // Import CommandPalette
import '../styles/EditorLayout.css';
import { FaRegFile } from 'react-icons/fa';

// Props for the EditorLayout component
interface EditorLayoutProps {
  initialContent?: string;
  initialLanguage?: string;
  onSave?: (content: string) => void;
  fileStructure: any[];
  activeFile?: string;
  projectPath?: string;
  onEditorChange?: (content: string) => void;
  onOpenFile?: (filePath: string) => void;
}

export const EditorLayout: React.FC<EditorLayoutProps> = ({
  initialContent = '',
  initialLanguage = 'typescript',
  onSave,
  fileStructure,
  activeFile = '',
  projectPath = '',
  onEditorChange,
  onOpenFile,
  onOpenFile,
  // onGenerateAndOpenTests prop will be implicitly handled by adding the function
}) => {
  const { 
    activeTabId, 
    setActiveTab: contextSetActiveTab,
    activeTabContent, // Destructure activeTabContent
    activeTabPath,    // Destructure activeTabPath
    activeTabLanguage, // Destructure activeTabLanguage
    updateActiveTabContent // Destructure updateActiveTabContent
  } = useEditor(); 

  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
  // Removed: const [activeTab, setActiveTab] = useState<string | null>(null);
  // State for all open tabs - will be replaced with context.tabs later
  const [tabs, setTabs] = useState<Array<{ id: string; title: string; path: string; content: string; dirty: boolean }>>([]);
  // State for selected sidebar tab
  const [sidebarTab, setSidebarTab] = useState<string>('explorer');
  const [isTerminalPanelOpen, setIsTerminalPanelOpen] = useState(false); // State für Terminal-Panel
  const [isPaletteOpen, setIsPaletteOpen] = useState(false); // State for CommandPalette
  const { uiService } = useServices(); // Get UIService from context

  // activeTabContent is now directly from useEditor()
  // const activeTabContent = editorContext.activeTabContent; // This was from previous step, now directly use destructured one

  const handleGenerateAndOpenTests = async (originalFilePath: string, testContent: string, framework: string) => {
    const pathParts = originalFilePath.split(/[\\/]/);
    const originalFileName = pathParts.pop() || '';
    const directory = pathParts.join('/');

    const extensionMatch = originalFileName.match(/\.(tsx|ts|jsx|js)$/);
    const baseName = extensionMatch ? originalFileName.substring(0, extensionMatch.index) : originalFileName;
    const extension = extensionMatch ? extensionMatch[1] : 'ts'; // Default to 'ts' if no extension found (should not happen for testable files)

    // Determine test file suffix based on framework or a general one
    // For simplicity, using .test.ext, common for Jest/Vitest
    const testFileSuffix = `.test.${extension}`;
    const testFileName = `${baseName}${testFileSuffix}`;
    const testFilePath = directory ? `${directory}/${testFileName}` : testFileName;

    // Check if tab for this test file already exists
    let tab = tabs.find(t => t.path === testFilePath);
    if (tab) {
      // If tab exists, update its content and make it active
      setTabs(tabs.map(t => t.id === tab!.id ? { ...tab!, content: testContent, dirty: true } : t));
      setActiveTab(tab.id);
    } else {
      // Create a new tab for the test file
      tab = {
        id: Math.random().toString(36).substr(2, 9),
        title: testFileName,
        path: testFilePath, // This path might not exist on disk yet
        content: testContent,
        dirty: true, // Mark as dirty since it's new content
      };
      setTabs(prevTabs => [...prevTabs, tab!]);
      setActiveTab(tab!.id);
    }
    // Optionally, bring the editor area into focus or the specific tab
    // This might require more direct manipulation or a ref to the editor/tab component
    alert(`Test file "${testFileName}" generated and opened in a new tab. Please save it.`);
  };

  // Open a file in a new or existing tab and load its content
  const openFileInTab = async (filePath: string) => {
    if (!filePath) return;
    let tab = tabs.find(tab => tab.path === filePath);
    if (!tab) {
      let content = '';
      if (window.electron && window.electron.ipcRenderer) {
        content = await window.electron.ipcRenderer.invoke('fs:readFile', filePath);
        if (!content) content = await window.electron.ipcRenderer.invoke('file:read', filePath);
        if (!content) content = await window.electron.ipcRenderer.invoke('readFile', filePath);
      }
      tab = {
        id: Math.random().toString(36).substr(2, 9),
        title: filePath.split(/[\\/]/).pop() || filePath,
        path: filePath,
        content: typeof content === 'string' ? content : '',
        dirty: false
      };
      setTabs([...tabs, tab]);
      contextSetActiveTab(tab.id); // Use context action
    } else {
      contextSetActiveTab(tab.id); // Use context action
    }
  };

  // When activeFile changes, open the file in a tab
  useEffect(() => {
    if (activeFile) openFileInTab(activeFile);
    // eslint-disable-next-line
  }, [activeFile]);

  // Handle editor content change
  const handleEditorChange = (val: string | undefined) => {
    if (activeTabId && val !== undefined) { // Use activeTabId from context
      updateActiveTabContent(val); // Call context action
    }
    // The original onEditorChange prop call can be kept if App.tsx still needs to react directly,
    // but ideally, App.tsx should also react to changes via context or service events if needed.
    if (onEditorChange) onEditorChange(val ?? ''); // Prop from App.tsx (still passed for now)
  };

  // Save the currently active tab
  const saveActiveTab = async () => {
    const tab = tabs.find(t => t.id === activeTab);
    if (!tab) return;
    if (window.electron && window.electron.ipcRenderer) {
      await window.electron.ipcRenderer.invoke('file:save', tab.path, tab.content);
      setTabs(tabs.map(t => t.id === tab.id ? { ...t, dirty: false } : t));
    }
    if (onSave && tab) onSave(tab.content);
  };

  // Listen for CTRL+S (or CMD+S) to trigger save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveActiveTab();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line
  }, [activeTab, tabs]);

  // Handle closing a tab
  const handleTabClose = (tabId: string) => {
    setTabs(tabs.filter(tab => tab.id !== tabId));
    if (activeTabId === tabId) { // Use context state
      // The actual logic of deciding the next active tab is now in EditorService,
      // triggered by contextSetActiveTab if it calls editorService.closeTab.
      // For now, this component shouldn't directly set the active tab after close.
      // The context and service events will handle updating activeTabId.
      // contextSetActiveTab(tabs.length > 1 ? tabs[tabs.length - 2].id : null); // Old direct logic
    }
    // The actual call to close the tab via context will be added in a later step
    // For now, this function will be modified to just call context's closeTab.
    // For this step, we are only removing local activeTab state and its direct setter.
  };

  // Helper function to check if a file is a media file
  const isMediaFile = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (!ext) return false;
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'];
    const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
    return imageExts.includes(ext) || videoExts.includes(ext);
  };

  // Toggle terminal panel visibility when sidebar tab changes
  useEffect(() => {
    setIsTerminalPanelOpen(sidebarTab === 'terminal');
  }, [sidebarTab]);

  // Placeholder for UIService integration for opening command palette
  // In a real setup, UIService would emit an event or call a registered action.
  // For now, we can use a keyboard shortcut directly in EditorLayout for demo.
  useEffect(() => {
    // const handleOpenPaletteShortcut = (e: KeyboardEvent) => {
    //   if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
    //     e.preventDefault();
    //     setIsPaletteOpen(prev => !prev);
    //   }
    // };
    // document.addEventListener('keydown', handleOpenPaletteShortcut);
    // return () => document.removeEventListener('keydown', handleOpenPaletteShortcut);
    
    // Listen to UIService event for toggling command palette
    const togglePalette = () => setIsPaletteOpen(prev => !prev);
    uiService?.on('toggleCommandPalette', togglePalette);
    return () => {
      uiService?.off('toggleCommandPalette', togglePalette);
      // document.removeEventListener('keydown', handleOpenPaletteShortcut); // If still using direct shortcut
    };
  }, [uiService]); // Add uiService to dependency array

  return (
    <ThemeProvider>
      <EditorProvider>
        <AIProvider>
          <div className="editor-layout-root" style={{ display: 'flex', height: '100vh', width: '100vw' }}>
            <CommandPalette isOpen={isPaletteOpen} onClose={() => setIsPaletteOpen(false)} />
            {/* Sidebar is always visible */}
            <Sidebar activeTab={sidebarTab} onTabChange={setSidebarTab} />
            {/* Main content area: Explorer und Editor nebeneinander */}
            <div className="editor-layout-main" style={{ display: 'flex', height: '100%', minHeight: 0 }}>
              {/* File explorer */}
              <div style={{
                width: 260,
                minWidth: 260,
                maxWidth: 260,
                background: '#222',
                borderRight: '1px solid #333',
                height: '100%',
                boxSizing: 'border-box',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column'
              }}>
                {sidebarTab === 'explorer' && (
                  <FileExplorer
                    fileStructure={fileStructure}
                    onOpenFile={openFileInTab}
                    activeFile={tabs.find(t => t.id === activeTabId)?.path || ''} // Use context state
                    projectPath={projectPath}
                    onGenerateAndOpenTests={handleGenerateAndOpenTests} // Pass the new handler
                  />
                )}
                {sidebarTab === 'plugins' && (
                  <PluginManagerPanel />
                )}
                {/* Add other panels for 'git', 'ai' etc. if they have dedicated components */}
              </div>
              {/* Editor content area: TabBar und Editor vertikal gestapelt */}
              <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                minWidth: 0,
                minHeight: 0,
                height: '100%',
                boxSizing: 'border-box',
                padding: 0,
                margin: 0
              }}>
                {/* TabBar direkt oben, bündig mit Explorer */}
                <div style={{
                  height: 36,
                  minHeight: 36,
                  maxHeight: 36,
                  margin: 0,
                  padding: 0,
                  borderBottom: '1px solid #333',
                  boxSizing: 'border-box'
                }}>
                  <TabBar
                    tabs={tabs} // This will be replaced by context.tabs later
                    activeTab={activeTabId} // Use context state
                    onTabClose={handleTabClose} // This will call context.closeTab later
                    onTabSelect={contextSetActiveTab} // Use context action
                  />
                </div>
                {/* Editor nimmt restlichen Platz */}
                <div style={{ flex: 1, minHeight: 0, minWidth: 0, position: 'relative', boxSizing: 'border-box' }}>
                  {tabs.length > 0 && activeTabId ? ( // Use context state
                    <Editor
                      height="100%"
                      // defaultLanguage and defaultValue are less relevant when path/language are explicit
                      language={activeTabLanguage || 'plaintext'} // Use language from context
                      path={activeTabPath} // Use path from context for model identity
                      value={activeTabContent} // Use content from context
                      onChange={handleEditorChange} // This will call editorService.handleModelContentChange
                      theme="vs-dark" // Or from context/config
                      options={{
                        fontSize: 16,
                        minimap: { enabled: false },
                        wordWrap: 'on',
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        lineNumbers: 'on',
                        glyphMargin: true,
                        renderLineHighlight: 'all',
                        scrollbar: { vertical: 'visible', horizontal: 'visible' },
                        readOnly: !activeTabId, // Ensure editor is read-only if no tab is active
                      }}
                    />
                  ) : (
                    <div className="editor-empty-ui" style={{ flex: 1, height: '100%', width: '100%', minHeight: 0, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <FaRegFile size={64} color="#888" style={{marginBottom: 16}} />
                      <div className="editor-empty-title">No file opened</div>
                      <div className="editor-empty-desc">Select a file in the explorer or create a new file to get started.</div>
                    </div>
                  )}
                  {/* Terminal panel as an overlay */}
                  {isTerminalPanelOpen && (
                    <div style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      bottom: 0,
                      height: 320,
                      zIndex: 20,
                      background: '#181818',
                      borderTop: '1px solid #333'
                    }}>
                      <TerminalPanel onClose={() => setIsTerminalPanelOpen(false)} />
                    </div>
                  )}
                </div>
              </div>
            </div>
            {isAIPanelOpen && (
              <div style={{ width: 340, minWidth: 260, maxWidth: 600, height: '100%', position: 'relative', display: 'flex' }}>
                {/* <AIChatPanel /> */} {/* Removed */}
              </div>
            )}
          </div>
        </AIProvider>
      </EditorProvider>
    </ThemeProvider>
  );
};