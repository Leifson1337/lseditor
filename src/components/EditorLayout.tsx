import React, { useState, useEffect, useCallback } from 'react';
import { Editor } from '@monaco-editor/react';
import { FileExplorer } from './FileExplorer';
import { TabBar } from './TabBar';
import Sidebar from './Sidebar';
import AIChatPanelWrapper from './AIChatPanelWrapper';
import { TerminalPanel } from './TerminalPanel'; // Import TerminalPanel
import { ThemeProvider } from '../contexts/ThemeContext';
import { EditorProvider } from '../contexts/EditorContext';
import { AIProvider } from '../contexts/AIContext';
import '../styles/EditorLayout.css';
import { FaRegFile } from 'react-icons/fa';
import { Resizable } from 're-resizable';
import { ChatMessage } from './AIChatPanel';

// Define FileNode interface for the file structure
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  content?: string;
  language?: string;
}

// Define Tab interface for editor tabs
interface EditorTab {
  id: string;
  title: string;
  path: string;
  content: string;
  dirty: boolean;
  language?: string;
}

// Props for the EditorLayout component
interface EditorLayoutProps {
  initialContent?: string;
  initialLanguage?: string;
  onSave?: (content: string) => void;
  fileStructure: FileNode[];
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
  onOpenFile
}) => {
  // State for currently active editor tab
  const [activeTab, setActiveTab] = useState<string | null>(null);
  // State for all open editor tabs
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  // State for selected sidebar tab (explorer, extensions, etc.)
  const [sidebarTab, setSidebarTab] = useState<string>('explorer');
  // State for AI chat panel visibility
  const [isChatOpen, setIsChatOpen] = useState<boolean>(false);
  // State for terminal panel visibility
  const [isTerminalPanelOpen, setIsTerminalPanelOpen] = useState(false);
  // State for sidebar panel width with localStorage persistence
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const savedWidth = localStorage.getItem('sidebarWidth');
    return savedWidth ? parseInt(savedWidth, 10) : 260;
  });

  // State for chat messages and active chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    const savedMessages = localStorage.getItem('chatMessages');
    return savedMessages ? JSON.parse(savedMessages) : [];
  });
  const [activeChatId, setActiveChatId] = useState<string>(() => {
    return localStorage.getItem('activeChatId') || Date.now().toString();
  });

  // Save chat messages to localStorage when they change
  useEffect(() => {
    if (chatMessages.length > 0) {
      localStorage.setItem('chatMessages', JSON.stringify(chatMessages));
      localStorage.setItem('activeChatId', activeChatId);
    }
  }, [chatMessages, activeChatId]);

  // Get the language mode based on file extension
  const getLanguageFromFileName = (fileName: string): string => {
    if (!fileName) return 'plaintext';
    
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    const fileNameLower = fileName.toLowerCase();
    
    // Language mappings
    const languageMap: Record<string, string> = {
      // Script files
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'rb': 'ruby',
      'java': 'java',
      'c': 'c',
      'cpp': 'cpp',
      'h': 'cpp',
      'hpp': 'cpp',
      'cs': 'csharp',
      'go': 'go',
      'php': 'php',
      'rs': 'rust',
      'swift': 'swift',
      'kt': 'kotlin',
      'scala': 'scala',
      'sh': 'shell',
      'ps1': 'powershell',
      'bat': 'bat',
      'cmd': 'cmd',
      
      // Web files
      'html': 'html',
      'htm': 'html',
      'xhtml': 'html',
      'css': 'css',
      'scss': 'scss',
      'less': 'less',
      'sass': 'sass',
      'vue': 'vue',
      'svelte': 'svelte',
      'json': 'json',
      'yaml': 'yaml',
      'yml': 'yaml',
      'xml': 'xml',
      'svg': 'xml',
      'graphql': 'graphql',
      'gql': 'graphql',
      
      // Config files
      'toml': 'toml',
      'ini': 'ini',
      'env': 'properties',
      'gitignore': 'gitignore',
      'editorconfig': 'editorconfig',
      
      // Document files
      'md': 'markdown',
      'markdown': 'markdown',
      'txt': 'plaintext',
      'log': 'log',
      
      // SQL
      'sql': 'sql',
      'pgsql': 'pgsql',
      'mysql': 'mysql',
      'psql': 'pgsql',
      
      // Docker
      'dockerfile': 'dockerfile',
      'docker-compose': 'yaml',
      
      // Makefiles
      'makefile': 'makefile',
      'gnumakefile': 'makefile'
    };
    
    // Special handling for files without extension or with multiple dots
    if (fileNameLower === 'dockerfile') return 'dockerfile';
    if (fileNameLower === 'makefile') return 'makefile';
    if (fileNameLower === '.gitignore') return 'gitignore';
    if (fileNameLower.endsWith('dockerfile')) return 'dockerfile';
    
    return languageMap[extension] || 'plaintext';
  };

  // Get the language for the current tab
  const getCurrentLanguage = (): string => {
    if (!activeTab) return 'plaintext';
    const tab = tabs.find(t => t.id === activeTab);
    if (!tab) return 'plaintext';
    return getLanguageFromFileName(tab.path);
  };

  // Type definition for Monaco editor instance
  interface Monaco {
    languages: {
      getLanguages: () => Array<{ id: string }>;
      python?: {
        pythonDefaults?: {
          setDiagnosticsOptions: (options: {
            validate: boolean;
            linting: boolean;
            typeCheckingMode: string;
          }) => void;
          setLanguageConfiguration: (languageId: string, config: any) => void;
        };
      };
      registerCompletionItemProvider: (languageId: string, provider: any) => void;
    };
  }

  // Configure Monaco Editor
  const configureEditor = (monaco: Monaco) => {
    try {
      // Only configure Python if the language is available
      if (monaco.languages.getLanguages().some(lang => lang.id === 'python')) {
        // Configure Python language features if available
        if (monaco.languages.python?.pythonDefaults) {
          monaco.languages.python.pythonDefaults.setDiagnosticsOptions({
            validate: true,
            linting: true,
            typeCheckingMode: 'basic',
          });

          // Configure Python language server options
          monaco.languages.python.pythonDefaults.setLanguageConfiguration('python', {
            comments: {
              lineComment: '#',
            },
            brackets: [
              ['{', '}'],
              ['[', ']'],
              ['(', ')'],
            ],
            autoClosingPairs: [
              { open: '{', close: '}' },
              { open: '[', close: ']' },
              { open: '(', close: ')' },
              { open: "'", close: "'" },
              { open: '"', close: '"' },
            ],
            surroundingPairs: [
              { open: '{', close: '}' },
              { open: '[', close: ']' },
              { open: '(', close: ')' },
              { open: "'", close: "'" },
              { open: '"', close: '"' },
            ],
          });
        } else {
          console.warn('Python language features not available in this Monaco Editor instance');
        }
      } else {
        console.log('Python language not registered in Monaco Editor');
      }
    } catch (error) {
      console.error('Error configuring Monaco Editor:', error);
    }
  };

  // Get the content of the currently active tab with error handling
  const activeTabContent = React.useMemo(() => {
    try {
      return tabs.find(t => t.id === activeTab)?.content || '';
    } catch (error) {
      console.error('Error getting active tab content:', error);
      return '';
    }
  }, [tabs, activeTab]);

  // Open a file in a new or existing tab and load its content
  const openFileInTab = async (filePath: string) => {
    console.log('Opening file:', filePath);
    try {
      // Basic validation
      if (!filePath || typeof filePath !== 'string') {
        console.warn('Invalid file path:', filePath);
        return;
      }

      // Check if file is already open
      const existingTab = tabs.find(tab => tab.path === filePath);
      if (existingTab) {
        console.log('Tab already exists, activating:', existingTab.id);
        setActiveTab(existingTab.id);
        return;
      }

      // Initialize with empty content
      let content = '';
      
      // Safely try to read file content
      try {
        if (window.electron?.ipcRenderer?.invoke) {
          console.log('Reading file content...');
          const fileContent = await window.electron.ipcRenderer.invoke('fs:readFile', filePath);
          content = String(fileContent || '');
          console.log('File content loaded, length:', content.length);
        }
      } catch (error) {
        console.warn('Could not read file content:', error);
        content = `// Error loading file: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }

      // Create new tab with safe defaults
      const newTab = {
        id: `tab-${Date.now()}`,
        title: filePath.split(/[\\/]/).pop() || 'Untitled',
        path: filePath,
        content: content,
        dirty: false
      };

      console.log('Adding new tab:', newTab.id, 'with content length:', content.length);
      
      // Update state in a single batch
      setTabs(prevTabs => {
        const newTabs = [...prevTabs, newTab];
        console.log('New tabs state:', newTabs);
        return newTabs;
      });
      
      setActiveTab(newTab.id);
      
    } catch (error) {
      console.error('Failed to open file:', error);
      // Show error in UI
      const errorTab = {
        id: `error-${Date.now()}`,
        title: 'Error',
        path: 'error',
        content: `Failed to open file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        dirty: false
      };
      
      setTabs(prevTabs => [...prevTabs, errorTab]);
      setActiveTab(errorTab.id);
    }
  };

  // When activeFile changes, open the file in a tab
  useEffect(() => {
    console.log('Active file changed:', activeFile);
    if (activeFile) {
      console.log('Opening file from activeFile change');
      openFileInTab(activeFile);
    }
    // eslint-disable-next-line
  }, [activeFile]);

  // Handle editor content change
  const handleEditorChange = (val: string | undefined) => {
    if (!activeTab) return;
    setTabs(tabs.map(tab =>
      tab.id === activeTab ? { ...tab, content: val ?? '', dirty: true } : tab
    ));
    if (onEditorChange) onEditorChange(val ?? '');
  };

  // Handle tab reorder
  const handleTabMove = (dragIndex: number, hoverIndex: number) => {
    const newTabs = [...tabs];
    const [draggedTab] = newTabs.splice(dragIndex, 1);
    newTabs.splice(hoverIndex, 0, draggedTab);
    setTabs(newTabs);
  };

  // Save the currently active tab
  const saveActiveTab = async () => {
    const tab = tabs.find(t => t.id === activeTab);
    if (!tab) return;
    if (window.electron && window.electron.ipcRenderer) {
      try {
        await window.electron.ipcRenderer.invoke('fs:writeFile', tab.path, tab.content);
        setTabs(tabs.map(t => t.id === tab.id ? { ...t, dirty: false } : t));
      } catch (e) {
        console.error('Failed to save file:', e);
      }
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
    if (activeTab === tabId) {
      setActiveTab(tabs.length > 1 ? tabs[tabs.length - 2].id : null);
    }
  };

  // Helper function to check if a file is a media file
  const isMediaFile = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (!ext) return false;
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'];
    const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
    return imageExts.includes(ext) || videoExts.includes(ext);
  };

  // Save sidebar width to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('sidebarWidth', sidebarWidth.toString());
  }, [sidebarWidth]);

  // Handle terminal panel toggle
  const toggleTerminalPanel = useCallback((isOpen: boolean) => {
    const newState = isOpen !== undefined ? isOpen : !isTerminalPanelOpen;
    setIsTerminalPanelOpen(newState);
    
    // Wenn das Terminal geöffnet wird, schließe den Chat, um Überlappungen zu vermeiden
    if (newState) {
      setIsChatOpen(false);
      
      // Wechsle zum Explorer-Tab, wenn das Terminal über das Toggle geöffnet wird
      if (sidebarTab !== 'terminal') {
        setSidebarTab('explorer');
      }
    }
  }, [isTerminalPanelOpen, sidebarTab]);

  // Handle sidebar tab changes
  const handleSidebarTabChange = useCallback((tab: string) => {
    if (tab === 'ai') {
      setIsChatOpen(prev => !prev);
      return;
    }
    
    setSidebarTab(tab);
    // Close terminal if opening a different tab
    if (tab !== 'terminal' && isTerminalPanelOpen) {
      setIsTerminalPanelOpen(false);
    } else if (tab === 'terminal') {
      setIsTerminalPanelOpen(true);
    }
  }, [isTerminalPanelOpen]);
  
  // Handle window resize to ensure minimum and maximum widths are respected
  const handleResize = useCallback((e: any, direction: any, ref: any, d: any) => {
    const newWidth = Math.max(200, Math.min(600, sidebarWidth + d.width));
    setSidebarWidth(newWidth);
  }, [sidebarWidth]);

  return (
    <ThemeProvider>
      <EditorProvider>
        <AIProvider>
          <div className="editor-layout-root">
            {/* Sidebar is always visible */}
            <Sidebar activeTab={sidebarTab} onTabChange={handleSidebarTabChange} />
            
            {/* Main content area: Sidebar panel and Editor */}
            <div className="editor-layout-main">
              {/* Sidebar panel (Explorer, Extensions) */}
              <Resizable
                size={{ width: sidebarWidth, height: '100%' }}
                minWidth={200}
                maxWidth={600}
                enable={{ right: true }}
                className="resizable-sidebar"
                onResizeStop={handleResize}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  backgroundColor: 'var(--editor-background, #1e1e1e)',
                  borderRight: '1px solid var(--border-color, #333)',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div className="sidebar-panel" style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  width: '100%',
                  height: '100%',
                }}>
                  {sidebarTab === 'explorer' && (
                    <FileExplorer
                      fileStructure={fileStructure}
                      onOpenFile={openFileInTab}
                      activeFile={tabs.find(t => t.id === activeTab)?.path || ''}
                      projectPath={projectPath}
                    />
                  )}
                  
                  {sidebarTab === 'extensions' && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '100%',
                      color: 'var(--description-foreground, #858585)',
                      fontSize: '14px',
                      fontStyle: 'italic'
                    }}>
                      Coming Soon..
                    </div>
                  )}
                </div>
              </Resizable>
              
              {/* Main editor area with chat panel */}
              <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                minWidth: 0,
                minHeight: 0,
                height: '100%',
                boxSizing: 'border-box',
                padding: 0,
                margin: 0,
                position: 'relative',
                overflow: 'hidden',
              }}>
                {/* Editor content area with right margin for chat panel */}
                <div style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  minWidth: 0,
                  minHeight: 0,
                  height: '100%',
                  boxSizing: 'border-box',
                  padding: 0,
                  margin: 0,
                  marginRight: sidebarTab === 'ai' ? '300px' : 0,
                  transition: 'margin-right 0.3s ease',
                }}>
                  {/* TabBar at the top */}
                  <div style={{
                    height: 36,
                    minHeight: 36,
                    maxHeight: 36,
                    margin: 0,
                    padding: 0,
                    borderBottom: '1px solid #333',
                    boxSizing: 'border-box',
                    backgroundColor: 'var(--editor-background, #1e1e1e)',
                    zIndex: 5,
                  }}>
                    <TabBar
                      tabs={tabs}
                      activeTab={activeTab}
                      onTabClose={handleTabClose}
                      onTabSelect={setActiveTab}
                    />
                  </div>
                  
                  {/* Editor container takes remaining space */}
                  <div style={{ 
                    flex: 1, 
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    position: 'relative',
                    backgroundColor: 'var(--editor-background, #1e1e1e)',
                    width: '100%',
                    height: '100%',
                    boxSizing: 'border-box',
                    zIndex: 1,
                  }}>
                    {tabs.length > 0 && activeTab ? (
                      <div key={`editor-wrapper-${activeTab}`} style={{ 
                        flex: 1, 
                        overflow: 'hidden',
                        position: 'relative',
                        minHeight: 0,
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column'
                      }}>
                        <Editor
                          key={activeTab}
                          height="100%"
                          width="100%"
                          language={getCurrentLanguage()}
                          value={tabs.find(t => t.id === activeTab)?.content || ''}
                          onChange={handleEditorChange}
                          theme={document.documentElement.getAttribute('data-theme') === 'light' ? 'vs' : 'vs-dark'}
                          beforeMount={configureEditor}
                          onMount={(editor) => {
                            // Force a layout update after mounting
                            setTimeout(() => {
                              editor.layout();
                            }, 0);
                          }}
                          onValidate={(markers) => {
                            console.log('Validation markers:', markers);
                          }}
                          options={{
                            scrollBeyondLastLine: true,
                            minimap: { enabled: true },
                            fontSize: 14,
                            wordWrap: 'on',
                            automaticLayout: true,
                            lineNumbers: 'on',
                            glyphMargin: true,
                            lineDecorationsWidth: 10,
                            renderLineHighlight: 'all',
                            scrollbar: {
                              vertical: 'auto',
                              horizontal: 'auto',
                              alwaysConsumeMouseWheel: false
                            },
                            padding: {
                              top: 10,
                              bottom: 10
                            },
                            tabSize: 2,
                            insertSpaces: true,
                            autoIndent: 'full',
                            formatOnPaste: true,
                            formatOnType: true,
                            suggestOnTriggerCharacters: true,
                            selectionHighlight: true,
                            renderWhitespace: 'selection',
                            renderIndentGuides: true,
                            showFoldingControls: 'always',
                            folding: true,
                            foldingHighlight: true,
                            foldingStrategy: 'auto',
                            renderLineHighlightOnlyWhenFocus: false,
                            overviewRulerLanes: 5,
                            overviewRulerBorder: true,
                            cursorBlinking: 'smooth',
                            cursorSmoothCaretAnimation: true,
                            cursorStyle: 'line',
                            cursorWidth: 2,
                            fontLigatures: true,
                            bracketPairColorization: {
                              enabled: true,
                              independentColorPoolPerBracketType: true
                            },
                            guides: {
                              bracketPairs: true,
                              bracketPairsHorizontal: true,
                              highlightActiveBracketPair: true,
                              indentation: true,
                              highlightActiveIndentation: true
                            },
                            smoothScrolling: true,
                            mouseWheelZoom: true,
                            multiCursorModifier: 'alt',
                            quickSuggestions: {
                              comments: true,
                              strings: true,
                              other: true
                            },
                            suggest: {
                              filterGraceful: true,
                              snippetsPreventQuickSuggestions: false,
                              localityBonus: true,
                              shareSuggestSelections: true,
                              showIcons: true
                            },
                            inlayHints: {
                              enabled: 'on'
                            },
                            unicodeHighlight: {
                              ambiguousCharacters: true,
                              invisibleCharacters: true,
                              nonBasicASCII: true
                            }
                          }}
                        />
                      </div>
                    ) : (
                      <div className="editor-empty-ui" style={{ 
                        flex: 1, 
                        height: '100%', 
                        width: '100%', 
                        minHeight: 0, 
                        minWidth: 0, 
                        display: 'flex', 
                        flexDirection: 'column',
                        alignItems: 'center', 
                        justifyContent: 'center',
                        color: '#888',
                        textAlign: 'center',
                        padding: '20px'
                      }}>
                        <FaRegFile size={64} style={{ marginBottom: '16px' }} />
                        <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '8px' }}>No file opened</div>
                        <div style={{ fontSize: '14px' }}>Select a file in the explorer or create a new file to get started.</div>
                      </div>
                    )}
                  </div>
                </div>
                {/* Terminal panel at the bottom */}
                <div 
                  style={{
                    position: 'fixed',
                    left: `${sidebarWidth}px`,
                    right: 0,
                    bottom: 0,
                    height: isTerminalPanelOpen ? '300px' : '0',
                    zIndex: 100,
                    backgroundColor: '#1e1e1e',
                    borderTop: isTerminalPanelOpen ? '1px solid #333' : 'none',
                    boxShadow: isTerminalPanelOpen ? '0 -2px 10px rgba(0, 0, 0, 0.3)' : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'height 0.2s ease-in-out, border-top 0.2s ease-in-out',
                    overflow: 'hidden'
                  }}
                >
                  <TerminalPanel 
                    isVisible={isTerminalPanelOpen}
                    onClose={() => toggleTerminalPanel(false)} 
                  />
                </div>
                
                {/* Persistent AI Chat Panel on the right side */}
                {isChatOpen && (
                  <div style={{
                    position: 'fixed',
                    top: '32px',
                    right: 0,
                    bottom: 0,
                    width: '400px',
                    zIndex: 1000,
                    backgroundColor: 'var(--editor-background, #1e1e1e)',
                    borderLeft: '1px solid var(--border-color, #333)',
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: '-2px 0 15px rgba(0, 0, 0, 0.3)',
                    transition: 'transform 0.3s ease-out',
                    transform: 'translateX(0)'
                  }}>
                    <AIChatPanelWrapper
                      key={activeChatId}
                      fileStructure={fileStructure}
                      projectPath={projectPath}
                      messages={chatMessages}
                      onMessagesChange={setChatMessages}
                      onNewChat={() => {
                        setChatMessages([]);
                        setActiveChatId(Date.now().toString());
                      }}
                      onClose={() => setIsChatOpen(false)}
                      onCodeProposal={(code, filePath) => {
                        if (filePath) {
                          openFileInTab(filePath);
                          setTabs(prevTabs => 
                            prevTabs.map(tab => 
                              tab.path === filePath 
                                ? { ...tab, content: code, dirty: true } 
                                : tab
                            )
                          );
                        } else if (activeTab) {
                          setTabs(prevTabs => 
                            prevTabs.map(tab => 
                              tab.id === activeTab 
                                ? { ...tab, content: code, dirty: true } 
                                : tab
                            )
                          );
                        }
                      }}
                      readFile={async (filePath) => {
                        try {
                          if (!window.electron) {
                            throw new Error('Electron API is not available');
                          }
                          const content = await window.electron.ipcRenderer.invoke('fs:readFile', filePath);
                          return String(content || '');
                        } catch (error) {
                          console.error('Error reading file:', error);
                          throw error;
                        }
                      }}
                    />
                  </div>
                )}
                
                {/* Global styles for the chat panel */}
                <style dangerouslySetInnerHTML={{
                  __html: `
                    @keyframes slideIn {
                      from { transform: translateX(100%); }
                      to { transform: translateX(0); }
                    }
                    
                    @keyframes fadeIn {
                      from { opacity: 0; }
                      to { opacity: 1; }
                    }
                    
                    /* Ensure the editor content doesn't shift when chat is open */
                    .editor-content {
                      transition: none !important;
                    }
                    
                    /* No overlay needed for persistent chat panel */
                    
                    /* Adjust editor content to make room for chat panel */
                    .editor-content {
                      transition: margin-right 0.3s ease;
                    }
                    
                    .editor-content.chat-open {
                      margin-right: 400px;
                    }
                  `
                }} />
              </div>
            </div>
          </div>
        </AIProvider>
      </EditorProvider>
    </ThemeProvider>
  );
};