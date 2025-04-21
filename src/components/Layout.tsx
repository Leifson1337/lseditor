import React, { useState, useEffect, useRef } from 'react';
import './Layout.css';
import Sidebar from './Sidebar';
import StatusBar from './StatusBar';
import AIToolbar from './AIToolbar';
import AIChat from './AIChat';
import { FileExplorer } from './FileExplorer';
import { Terminal } from './Terminal';
import Titlebar from './Titlebar';
import MenuBar from './MenuBar';

// Hilfsfunktion für dirname
function dirname(filePath: string) {
  if (!filePath) return '';
  return filePath.substring(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')));
}

interface LayoutProps {
  children: React.ReactNode;
  initialContent?: string;
  initialLanguage?: string;
  fileStructure?: any[];
  onOpenFile?: (filePath: string) => void;
  activeFile?: string;
  terminalPort?: number;
  isTerminalOpen?: boolean;
  onTerminalOpen?: () => void;
  onTerminalClose?: () => void;
  recentProjects?: string[];
  projectPath?: string;
}

interface FindInFilesResult {
  file: string;
  line: number;
  content: string;
  matchStart?: number;
  matchEnd?: number;
}

const Layout: React.FC<LayoutProps> = ({ 
  children, 
  initialContent = '', 
  initialLanguage = 'plaintext',
  fileStructure = [],
  onOpenFile = () => {},
  activeFile = '',
  terminalPort = 3001,
  isTerminalOpen = false,
  onTerminalOpen = () => {},
  onTerminalClose = () => {},
  recentProjects = [],
  projectPath = ''
}) => {
  const [activeTab, setActiveTab] = useState('explorer');
  const [isAIChatOpen, setIsAIChatOpen] = useState(true);
  const [messages, setMessages] = useState<any[]>([]);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showAccessibilityFeatures, setShowAccessibilityFeatures] = useState(false);
  const [showProcessInfo, setShowProcessInfo] = useState(false);
  const [processInfo, setProcessInfo] = useState<any>(null);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [showEditorPlayground, setShowEditorPlayground] = useState(false);
  const [showFindDialog, setShowFindDialog] = useState(false);
  const [showReplaceDialog, setShowReplaceDialog] = useState(false);
  const [showFindInFilesDialog, setShowFindInFilesDialog] = useState(false);
  const [showReplaceInFilesDialog, setShowReplaceInFilesDialog] = useState(false);

  // Editor-Zustände für Dateibearbeitung
  const [currentFileContent, setCurrentFileContent] = useState<string>(initialContent);
  const [currentLanguage, setCurrentLanguage] = useState<string>(initialLanguage);
  const [openedFile, setOpenedFile] = useState<string | null>(activeFile || null);

  // Effekt zum Überprüfen der Monaco-Verfügbarkeit
  useEffect(() => {
    // Nicht benötigt, da wir den Monaco-Editor durch einen einfachen Textbereich ersetzen
  }, []);

  // --- Suchfunktion für "In Dateien suchen" ---
  const [findInFilesQuery, setFindInFilesQuery] = useState('');
  const [findInFilesResults, setFindInFilesResults] = useState<any[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showFindInFilesDialog && searchInputRef.current) {
      searchInputRef.current.focus();
    }
    // Listener für Suchergebnisse vom Main-Prozess
    let didRegister = false;
    const handler = (_event: any, results: any[]) => setFindInFilesResults(results);
    if (typeof window !== 'undefined' && window.electron && window.electron.ipcRenderer) {
      window.electron.ipcRenderer.on('editor:findInFilesResults', handler);
      didRegister = true;
    }
    return () => {
      if (
        didRegister &&
        typeof window !== 'undefined' &&
        window.electron &&
        window.electron.ipcRenderer
      ) {
        window.electron.ipcRenderer.removeListener('editor:findInFilesResults', handler);
      }
    };
  }, [showFindInFilesDialog]);

  const handleFindInFiles = async () => {
    if (!findInFilesQuery.trim()) return;
    setFindInFilesResults([]);
    // Sende Suchanfrage an den Main-Prozess
    if (typeof window !== 'undefined' && window.electron && window.electron.ipcRenderer) {
      await window.electron.ipcRenderer.invoke('editor:findInFiles', findInFilesQuery, process.cwd());
    }
  };

  const handleResultClick = (file: string, line: number) => {
    if (onOpenFile) {
      onOpenFile(file);
      setShowFindInFilesDialog(false);
      // Optional: Scroll zu Zeile im Editor
    }
  };

  useEffect(() => {
    // Listen for events from main process
    if (typeof window !== 'undefined' && window.electron && window.electron.ipcRenderer) {
      window.electron.ipcRenderer.on('show-commands-palette', () => {
        setShowCommandPalette(true);
      });
      
      window.electron.ipcRenderer.on('show-accessibility-features', () => {
        setShowAccessibilityFeatures(true);
      });
      
      window.electron.ipcRenderer.on('show-process-info', (info) => {
        setProcessInfo(info);
        setShowProcessInfo(true);
      });
      
      window.electron.ipcRenderer.on('checking-for-updates', () => {
        setUpdateInfo({ status: 'checking' });
        setShowUpdateDialog(true);
      });
      
      window.electron.ipcRenderer.on('update-check-result', (result) => {
        setUpdateInfo(result);
      });
      
      window.electron.ipcRenderer.on('open-editor-playground', () => {
        setShowEditorPlayground(true);
      });
    }
    
    return () => {
      // Clean up event listeners
      if (typeof window !== 'undefined' && window.electron && window.electron.ipcRenderer) {
        window.electron.ipcRenderer.removeListener('show-commands-palette', () => {});
        window.electron.ipcRenderer.removeListener('show-accessibility-features', () => {});
        window.electron.ipcRenderer.removeListener('show-process-info', () => {});
        window.electron.ipcRenderer.removeListener('checking-for-updates', () => {});
        window.electron.ipcRenderer.removeListener('update-check-result', () => {});
        window.electron.ipcRenderer.removeListener('open-editor-playground', () => {});
      }
    };
  }, []);

  const handleAIAction = (action: string) => {
    setIsAIChatOpen(true);
    console.log('AI Action:', action);
  };

  const handleSendMessage = (message: string) => {
    console.log('Sending message:', message);
  };

  const handleInsertCode = (code: string) => {
    console.log('Inserting code:', code);
  };

  const handleExplain = (code: string) => {
    console.log('Explaining code:', code);
  };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if (tab === 'terminal') {
      setShowTerminal(true);
      if (onTerminalOpen) onTerminalOpen();
    } else {
      setShowTerminal(false);
      if (onTerminalClose) onTerminalClose();
    }
  };

  const handleHelpAction = async (action: string) => {
    console.log('Help action:', action);
    
    if (typeof window !== 'undefined' && window.electron && window.electron.ipcRenderer) {
      switch (action) {
        case 'showCommands':
          await window.electron.ipcRenderer.invoke('help:showCommands');
          break;
        case 'editorPlayground':
          await window.electron.ipcRenderer.invoke('help:editorPlayground');
          break;
        case 'accessibility':
          await window.electron.ipcRenderer.invoke('help:accessibility');
          break;
        case 'reportIssue':
          await window.electron.ipcRenderer.invoke('help:reportIssue');
          break;
        case 'devTools':
          await window.electron.ipcRenderer.invoke('help:toggleDevTools');
          break;
        case 'processExplorer':
          await window.electron.ipcRenderer.invoke('help:openProcessExplorer');
          break;
        case 'checkUpdates':
          await window.electron.ipcRenderer.invoke('help:checkForUpdates');
          break;
        case 'about':
          await window.electron.ipcRenderer.invoke('help:about');
          break;
      }
    }
  };

  const handleFileAction = async (action: string, data?: any) => {
    console.log('File action:', action, data);
    
    if (typeof window !== 'undefined' && window.electron && window.electron.ipcRenderer) {
      switch (action) {
        case 'newTextFile':
          await window.electron.ipcRenderer.invoke('file:newTextFile');
          break;
        
        case 'newWindow':
          await window.electron.ipcRenderer.invoke('file:newWindow');
          break;
        
        case 'openFile':
          const filePath = await window.electron.ipcRenderer.invoke('file:openFile');
          if (filePath && onOpenFile) {
            onOpenFile(filePath);
          }
          break;
        
        case 'openFolder':
          const folderPath = await window.electron.ipcRenderer.invoke('file:openFolder');
          if (folderPath) {
            // Öffne den Ordner als Projekt
            window.location.reload(); // Temporäre Lösung - in einer echten App würde hier ein Event an App.tsx gesendet
          }
          break;
        
        case 'openWorkspaceFromFile':
          const workspaceResult = await window.electron.ipcRenderer.invoke('file:openWorkspaceFromFile');
          if (workspaceResult) {
            // Workspace-Datei wurde geöffnet, verarbeite die Workspace-Konfiguration
            console.log('Workspace opened:', workspaceResult);
            // In einer echten App würde hier die Workspace-Konfiguration verarbeitet werden
          }
          break;
        
        case 'openRecent':
          if (data && data.path) {
            // Öffne ein kürzlich geöffnetes Projekt
            window.location.href = `?project=${encodeURIComponent(data.path)}`;
          }
          break;
        
        case 'clearRecentProjects':
          // Lösche die Liste der kürzlich geöffneten Projekte
          localStorage.removeItem('recentProjects');
          break;
        
        case 'addFolderToWorkspace':
          const additionalFolder = await window.electron.ipcRenderer.invoke('file:addFolderToWorkspace');
          if (additionalFolder) {
            // Füge den Ordner zum aktuellen Workspace hinzu
            console.log('Folder added to workspace:', additionalFolder);
            // In einer echten App würde hier der Ordner zum Workspace hinzugefügt werden
          }
          break;
        
        case 'saveWorkspaceAs':
          // Aktuelle Workspace-Konfiguration sammeln
          const currentWorkspace = {
            folders: [{ path: activeFile ? dirname(activeFile) : '' }],
            settings: {}
          };
          
          const savedWorkspacePath = await window.electron.ipcRenderer.invoke('file:saveWorkspaceAs', currentWorkspace);
          if (savedWorkspacePath) {
            console.log('Workspace saved as:', savedWorkspacePath);
          }
          break;
        
        case 'duplicateWorkspace':
          await window.electron.ipcRenderer.invoke('file:duplicateWorkspace');
          break;
        
        case 'save':
          if (activeFile) {
            // Hier würden wir den aktuellen Dateiinhalt abrufen
            const content = document.querySelector('.editor-content')?.textContent || '';
            const result = await window.electron.ipcRenderer.invoke('fs:writeFile', activeFile, content);
            if (result) {
              console.log('File saved:', result);
            } else {
              console.error('Error saving file:', result);
            }
          } else {
            // Wenn keine Datei aktiv ist, verhalte dich wie "Speichern unter"
            handleFileAction('saveAs');
          }
          break;
        
        case 'saveAs':
          // Hier würden wir den aktuellen Dateiinhalt abrufen
          const content = document.querySelector('.editor-content')?.textContent || '';
          const defaultPath = activeFile || '';
          const saveResult = await window.electron.ipcRenderer.invoke('fs:writeFile', defaultPath, content);
          
          if (saveResult) {
            console.log('File saved as:', saveResult);
            if (onOpenFile) {
              onOpenFile(saveResult);
            }
          } else {
            console.error('Error saving file:', saveResult);
          }
          break;
        
        case 'saveAll':
          // In einer echten App würden wir hier alle geöffneten Dateien sammeln
          const openFilesWithContent = [
            { path: activeFile || '', content: document.querySelector('.editor-content')?.textContent || '' }
          ];
          
          const saveAllResults = await window.electron.ipcRenderer.invoke('file:saveAll', openFilesWithContent);
          console.log('Save all results:', saveAllResults);
          break;
        
        case 'share':
          if (activeFile) {
            const fileContent = document.querySelector('.editor-content')?.textContent || '';
            await window.electron.ipcRenderer.invoke('file:share', activeFile, fileContent);
          }
          break;
        
        case 'autoSave':
          // Toggle Auto-Save-Einstellung
          const isAutoSaveEnabled = data?.isChecked;
          localStorage.setItem('autoSave', String(isAutoSaveEnabled));
          console.log('Auto save:', isAutoSaveEnabled);
          break;
        
        case 'revertFile':
          if (activeFile) {
            const revertResult = await window.electron.ipcRenderer.invoke('file:revertFile', activeFile);
            if (revertResult) {
              console.log('File reverted:', activeFile);
              // In einer echten App würden wir hier den Editor-Inhalt aktualisieren
            } else {
              console.error('Error reverting file:', revertResult);
            }
          }
          break;
        
        case 'closeEditor':
          await window.electron.ipcRenderer.invoke('file:closeEditor');
          break;
        
        case 'closeFolder':
          await window.electron.ipcRenderer.invoke('file:closeFolder');
          break;
        
        case 'closeWindow':
          await window.electron.ipcRenderer.invoke('file:closeWindow');
          break;
        
        case 'exit':
          await window.electron.ipcRenderer.invoke('file:exit');
          break;
        default:
          // Zeige einen Hinweis, dass die Funktion noch nicht implementiert ist
          alert(`Aktion: "${action}" wurde ausgelöst.`);
      }
    } else {
      alert(`Aktion: "${action}" wurde ausgelöst.`);
    }
  };

  const handleEditAction = async (action: string, data?: any) => {
    console.log('Edit action:', action, data);
    
    // Hilfsfunktion zum Ausführen von Editor-Befehlen
    const executeEditorCommand = (command: string) => {
      if (typeof window !== 'undefined' && window.electron && window.electron.ipcRenderer) {
        window.electron.ipcRenderer.send('editor:executeCommand', command);
      }
    };
    
    // Hilfsfunktion zum Ausführen von Befehlen über die Zwischenablage
    const executeClipboardCommand = (command: string) => {
      try {
        if (command === 'cut') {
          document.execCommand('cut');
        } else if (command === 'copy') {
          document.execCommand('copy');
        } else if (command === 'paste') {
          document.execCommand('paste');
        }
      } catch (error) {
        console.error(`Error executing clipboard command ${command}:`, error);
      }
    };
    
    switch (action) {
      case 'undo':
        executeEditorCommand('undo');
        break;
        
      case 'redo':
        executeEditorCommand('redo');
        break;
        
      case 'cut':
        executeClipboardCommand('cut');
        break;
        
      case 'copy':
        executeClipboardCommand('copy');
        break;
        
      case 'paste':
        executeClipboardCommand('paste');
        break;
        
      case 'find':
        setShowFindDialog(true);
        break;
        
      case 'replace':
        setShowReplaceDialog(true);
        break;
        
      case 'findInFiles':
        setShowFindInFilesDialog(true);
        break;
        
      case 'replaceInFiles':
        setShowReplaceInFilesDialog(true);
        break;
        
      case 'toggleLineComment':
        executeEditorCommand('toggleLineComment');
        break;
        
      case 'toggleBlockComment':
        executeEditorCommand('toggleBlockComment');
        break;
    }
  };

  // Funktion zum Laden und Öffnen einer Datei
  const handleOpenFile = async (filePath: string) => {
    console.log('Opening file:', filePath);
    try {
      // Dateiinhalt laden
      if (typeof window !== 'undefined' && window.electron && window.electron.ipcRenderer) {
        let fileContent;
        
        // Versuche zuerst mit fs:readFile
        try {
          fileContent = await window.electron.ipcRenderer.invoke('fs:readFile', filePath);
          console.log('File content loaded with fs:readFile:', fileContent ? 'Content loaded' : 'No content');
        } catch (readError) {
          console.error('Error with fs:readFile, trying readFile:', readError);
          // Fallback auf alten Handler
          try {
            fileContent = await window.electron.ipcRenderer.invoke('readFile', filePath);
            console.log('File content loaded with readFile:', fileContent ? 'Content loaded' : 'No content');
          } catch (fallbackError) {
            console.error('Both file reading methods failed:', fallbackError);
            throw new Error('Konnte Datei nicht lesen');
          }
        }
        
        // Dateiendung bestimmen für Syntax-Highlighting
        const extension = filePath.split('.').pop()?.toLowerCase() || '';
        let language = 'plaintext';
        
        // Sprachzuordnung basierend auf Dateiendung
        switch (extension) {
          case 'js': language = 'javascript'; break;
          case 'jsx': language = 'javascript'; break;
          case 'ts': language = 'typescript'; break;
          case 'tsx': language = 'typescript'; break;
          case 'html': language = 'html'; break;
          case 'css': language = 'css'; break;
          case 'json': language = 'json'; break;
          case 'md': language = 'markdown'; break;
          default: language = 'plaintext';
        }
        
        console.log('Setting file content and language:', language);
        // Datei im Editor öffnen
        setCurrentFileContent(fileContent || '');
        setCurrentLanguage(language);
        setOpenedFile(filePath);
        // Editor-Textarea fokussieren, damit sofort getippt werden kann
        setTimeout(() => {
          const textarea = document.querySelector('.simple-editor-container textarea') as HTMLTextAreaElement;
          if (textarea) textarea.focus();
        }, 100);
        // Auch die übergebene onOpenFile-Funktion aufrufen (falls vorhanden)
        if (onOpenFile) {
          onOpenFile(filePath);
        }
      }
    } catch (error) {
      console.error('Error opening file:', error);
      alert(`Fehler beim Öffnen der Datei: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleSaveFile = async () => {
    if (!openedFile) return;
    
    try {
      if (typeof window !== 'undefined' && window.electron && window.electron.ipcRenderer) {
        // Holen Sie den aktuellen Inhalt aus dem Textarea
        const content = currentFileContent;
        
        let success = false;
        
        // Versuche zuerst mit fs:writeFile
        try {
          success = await window.electron.ipcRenderer.invoke('fs:writeFile', openedFile, content);
          console.log('File saved with fs:writeFile:', success ? 'Success' : 'Failed');
        } catch (writeError) {
          console.error('Error with fs:writeFile, trying writeFile:', writeError);
          // Fallback auf alten Handler
          try {
            success = await window.electron.ipcRenderer.invoke('writeFile', openedFile, content);
            console.log('File saved with writeFile:', success ? 'Success' : 'Failed');
          } catch (fallbackError) {
            console.error('Both file writing methods failed:', fallbackError);
            throw new Error('Konnte Datei nicht speichern');
          }
        }
        
        if (success) {
          console.log('File saved:', openedFile);
        } else {
          console.error('Error saving file');
          alert('Fehler beim Speichern der Datei');
        }
      }
    } catch (error) {
      console.error('Error saving file:', error);
      alert(`Fehler beim Speichern der Datei: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const renderSidebarContent = () => {
    switch (activeTab) {
      case 'explorer':
        return (
          <FileExplorer 
            fileStructure={fileStructure} 
            onOpenFile={handleOpenFile}
            activeFile={activeFile}
          />
        );
      case 'terminal':
        return null; // Terminal wird jetzt im Editor-Bereich angezeigt
      default:
        return <div className="empty-sidebar-content">Wählen Sie eine Option aus</div>;
    }
  };

  // --- MiniStatusBar unten ---
  const [errorCount, setErrorCount] = useState(0);
  const [problemCount, setProblemCount] = useState(0);
  const [portForwardCount, setPortForwardCount] = useState(0);

  return (
    <div className="app-container">
      <Titlebar>
        <MenuBar 
          onHelpAction={handleHelpAction} 
          onFileAction={handleFileAction} 
          onEditAction={handleEditAction}
          recentProjects={recentProjects} 
        />
      </Titlebar>
      <div className="main-content">
        {/* Linke Seite mit Sidebar und Sidebar-Inhalt */}
        <div className="left-panel">
          <StatusBar
            activeFile={activeFile}
            terminalPort={terminalPort}
            isTerminalConnected={isTerminalOpen}
            errorCount={errorCount}
            problemCount={problemCount}
            portForwardCount={portForwardCount}
          />
          <Sidebar
            activeTab={activeTab}
            onTabChange={handleTabChange}
          />
          <div className="sidebar-content-panel">
            {renderSidebarContent()}
          </div>
        </div>
        
        {/* Mittlerer Bereich mit Editor und Terminal */}
        <div className="editor-container">
          <div className="editor-area">
            <div className="editor-content">
              {showEditorPlayground ? (
                <div className="editor-playground">
                  <h2>Editor Playground</h2>
                  <p>Hier können Sie verschiedene Editor-Funktionen ausprobieren und testen.</p>
                  <button onClick={() => setShowEditorPlayground(false)}>Schließen</button>
                </div>
              ) : openedFile ? (
                <div className="simple-editor-container" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ padding: '8px', background: '#1e1e1e', color: '#ddd', borderBottom: '1px solid #333' }}>
                    <strong>Datei:</strong> {openedFile}
                  </div>
                  <textarea 
                    style={{ 
                      flex: 1, 
                      background: '#1e1e1e', 
                      color: '#ddd', 
                      border: 'none', 
                      padding: '12px',
                      fontFamily: 'monospace',
                      fontSize: '14px',
                      resize: 'none',
                      outline: 'none'
                    }}
                    value={currentFileContent}
                    onChange={(e) => setCurrentFileContent(e.target.value)}
                    spellCheck={false}
                  />
                </div>
              ) : (
                <div className="empty-editor">
                  <h2>Keine Datei geöffnet</h2>
                  <p>Wählen Sie eine Datei aus dem Explorer aus, um sie zu bearbeiten.</p>
                </div>
              )}
            </div>
            {showTerminal && (
              <div className="terminal-container">
                <div className="terminal-header">
                  <span>Terminal</span>
                  <button 
                    className="terminal-close-btn"
                    onClick={() => {
                      setShowTerminal(false);
                      if (onTerminalClose) onTerminalClose();
                      setActiveTab('explorer'); // Explorer als Fallback aktivieren
                    }}
                  >
                    ×
                  </button>
                </div>
                <Terminal 
                  onData={(data) => console.log('Terminal data:', data)}
                  onResize={(cols, rows) => console.log('Terminal resize:', cols, rows)}
                />
              </div>
            )}
          </div>
        </div>
        
        {/* Rechte Seite mit KI-Chat */}
        <div className="right-panel">
          <div className="ai-sidebar">
            <AIToolbar onAction={handleAIAction} isVertical={true} />
          </div>
          <div className="ai-content">
            <AIChat
              isOpen={isAIChatOpen}
              messages={messages}
              onSendMessage={handleSendMessage}
              onClose={() => setIsAIChatOpen(false)}
              onInsertCode={handleInsertCode}
              onExplain={handleExplain}
            />
          </div>
        </div>
      </div>
      
      {/* Dialoge für Help-Menü-Funktionen */}
      {showCommandPalette && (
        <div className="dialog-overlay">
          <div className="dialog command-palette">
            <div className="dialog-header">
              <h3>Command Palette</h3>
              <button onClick={() => setShowCommandPalette(false)}>×</button>
            </div>
            <div className="dialog-content">
              <input type="text" placeholder="Befehl eingeben..." autoFocus />
              <div className="command-list">
                <div className="command-item">Datei öffnen</div>
                <div className="command-item">Datei speichern</div>
                <div className="command-item">Neues Terminal</div>
                <div className="command-item">Git: Commit</div>
                <div className="command-item">Git: Push</div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {showAccessibilityFeatures && (
        <div className="dialog-overlay">
          <div className="dialog accessibility-dialog">
            <div className="dialog-header">
              <h3>Accessibility Features</h3>
              <button onClick={() => setShowAccessibilityFeatures(false)}>×</button>
            </div>
            <div className="dialog-content">
              <h4>Tastaturkürzel</h4>
              <ul>
                <li><strong>Strg+F1</strong> - Sprachausgabe aktivieren</li>
                <li><strong>Strg+F2</strong> - Kontrast erhöhen</li>
                <li><strong>Strg+F3</strong> - Schriftgröße erhöhen</li>
                <li><strong>Strg+F4</strong> - Schriftgröße verringern</li>
              </ul>
              <h4>Einstellungen</h4>
              <div className="accessibility-options">
                <label>
                  <input type="checkbox" /> Hoher Kontrast
                </label>
                <label>
                  <input type="checkbox" /> Animationen reduzieren
                </label>
                <label>
                  <input type="checkbox" /> Sprachausgabe aktivieren
                </label>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {showProcessInfo && (
        <div className="dialog-overlay">
          <div className="dialog process-info-dialog">
            <div className="dialog-header">
              <h3>Process Explorer</h3>
              <button onClick={() => setShowProcessInfo(false)}>×</button>
            </div>
            <div className="dialog-content">
              {processInfo && (
                <div className="process-details">
                  <p><strong>Process ID:</strong> {processInfo.pid}</p>
                  <p><strong>Parent Process ID:</strong> {processInfo.ppid}</p>
                  <p><strong>Uptime:</strong> {Math.floor(processInfo.uptime / 60)} min {Math.floor(processInfo.uptime % 60)} sec</p>
                  <h4>Memory Usage</h4>
                  <ul>
                    <li>RSS: {Math.round(processInfo.memory.rss / 1024 / 1024)} MB</li>
                    <li>Heap Total: {Math.round(processInfo.memory.heapTotal / 1024 / 1024)} MB</li>
                    <li>Heap Used: {Math.round(processInfo.memory.heapUsed / 1024 / 1024)} MB</li>
                    <li>External: {Math.round(processInfo.memory.external / 1024 / 1024)} MB</li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      {showUpdateDialog && (
        <div className="dialog-overlay">
          <div className="dialog update-dialog">
            <div className="dialog-header">
              <h3>Updates</h3>
              <button onClick={() => setShowUpdateDialog(false)}>×</button>
            </div>
            <div className="dialog-content">
              {updateInfo && (
                updateInfo.status === 'checking' ? (
                  <p>Suche nach Updates...</p>
                ) : (
                  <div className="update-info">
                    <p><strong>Aktuelle Version:</strong> {updateInfo.version}</p>
                    <p>{updateInfo.message}</p>
                    {updateInfo.hasUpdate && (
                      <button className="update-button">Update installieren</button>
                    )}
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}
      
      {showFindDialog && (
        <div className="dialog-overlay">
          <div className="dialog find-dialog">
            <div className="dialog-header">
              <h3>Finden</h3>
              <button onClick={() => setShowFindDialog(false)}>×</button>
            </div>
            <div className="dialog-content">
              <input type="text" placeholder="Suchen..." autoFocus />
              <button>Suchen</button>
            </div>
          </div>
        </div>
      )}
      
      {showReplaceDialog && (
        <div className="dialog-overlay">
          <div className="dialog replace-dialog">
            <div className="dialog-header">
              <h3>Ersetzen</h3>
              <button onClick={() => setShowReplaceDialog(false)}>×</button>
            </div>
            <div className="dialog-content">
              <input type="text" placeholder="Suchen..." autoFocus />
              <input type="text" placeholder="Ersetzen..." />
              <button>Ersetzen</button>
            </div>
          </div>
        </div>
      )}
      
      {showFindInFilesDialog && (
        <div className="dialog-overlay">
          <div className="dialog find-in-files-dialog">
            <div className="dialog-header">
              <h3>In Dateien suchen</h3>
              <button onClick={() => setShowFindInFilesDialog(false)}>×</button>
            </div>
            <div className="dialog-content">
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Suchen..."
                value={findInFilesQuery}
                onChange={e => setFindInFilesQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleFindInFiles(); }}
                autoFocus
              />
              <button onClick={handleFindInFiles}>Suchen</button>
              <div className="search-results">
                {findInFilesResults.length === 0 && findInFilesQuery && (
                  <div className="no-results">Keine Treffer gefunden.</div>
                )}
                {findInFilesResults.map((result: any, idx: number) => (
                  <div
                    key={idx}
                    className="search-result"
                    onClick={() => handleResultClick(result.file, result.line)}
                  >
                    <span className="result-file">{result.file}</span>:
                    <span className="result-line">{result.line}</span>
                    <span className="result-content">{result.content}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {showReplaceInFilesDialog && (
        <div className="dialog-overlay">
          <div className="dialog replace-in-files-dialog">
            <div className="dialog-header">
              <h3>In Dateien ersetzen</h3>
              <button onClick={() => setShowReplaceInFilesDialog(false)}>×</button>
            </div>
            <div className="dialog-content">
              <input type="text" placeholder="Suchen..." autoFocus />
              <input type="text" placeholder="Ersetzen..." />
              <button>Ersetzen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Layout;