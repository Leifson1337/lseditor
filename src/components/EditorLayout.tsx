import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import path from 'path';
import { Editor } from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import { FileExplorer } from './FileExplorer';
import { TabBar } from './TabBar';
import Sidebar from './Sidebar';
import AIChatPanel from './AIChatPanel';
import { IntegratedTerminal } from './IntegratedTerminal';
import ExtensionsPanel from './ExtensionsPanel';
import { ThemeProvider } from '../contexts/ThemeContext';
import { EditorProvider } from '../contexts/EditorContext';
import { AIProvider } from '../contexts/AIContext';
import '../styles/EditorLayout.css';
import { FaRegFile } from 'react-icons/fa';
import { Resizable } from 're-resizable';
import {
  collapseDuplicateProjectRoot,
  normalizeProjectRoot,
  stripFileProtocol,
  stripRelativeDrivePrefix
} from '../utils/pathUtils';
import { ExtensionHostKind, registerExtension } from '@codingame/monaco-vscode-api/extensions';
import { pathToFileURL } from 'url';

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

const getLanguageFromPath = (filePath?: string) => {
  if (!filePath) return 'plaintext';
  const extension = filePath.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'js':
      return 'javascript';
    case 'ts':
      return 'typescript';
    case 'tsx':
      return 'typescript';
    case 'jsx':
      return 'javascript';
    case 'json':
      return 'json';
    case 'css':
      return 'css';
    case 'html':
    case 'htm':
      return 'html';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'py':
      return 'python';
    case 'sh':
      return 'shell';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'xml':
      return 'xml';
    case 'rs':
      return 'rust';
    case 'java':
      return 'java';
    case 'c':
    case 'cpp':
    case 'h':
    case 'hpp':
      return 'cpp';
    case 'txt':
      return 'plaintext';
    default:
      return 'plaintext';
  }
};

const configureDiagnostics = (monaco: Monaco) => {
  if (monaco?.languages?.typescript) {
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true
    });
  }

  const languages = monaco?.languages as Monaco['languages'] & {
    javascript?: Monaco['languages']['typescript'];
  };

  if (languages?.javascript) {
    languages.javascript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true
    });
  }
};

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
  // State for AI panel visibility
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
  // State for currently active tab
  const [activeTab, setActiveTab] = useState<string | null>(null);
  // State for all open tabs
  const [tabs, setTabs] = useState<Array<{ id: string; title: string; path: string; content: string; dirty: boolean }>>([]);
  // State for selected sidebar tab
  const [sidebarTab, setSidebarTab] = useState<string>('explorer');
  const [wordWrapEnabled, setWordWrapEnabled] = useState(true);
  // State for terminal panel visibility
  const [isTerminalPanelOpen, setIsTerminalPanelOpen] = useState(false); // State für Terminal-Panel
  const emitTerminalAction = useCallback((type: string, payload?: any) => {
    window.dispatchEvent(new CustomEvent('terminal:action', { detail: { type, payload } }));
  }, []);
  const handleSidebarTabChange = useCallback((tabId: string) => {
    if (tabId === 'terminal') {
      setIsTerminalPanelOpen(value => !value);
      return;
    }
    if (tabId === 'ai') {
      setIsAIPanelOpen(value => !value);
      return;
    }
    setSidebarTab(tabId);
  }, []);

  // Get the content of the currently active tab
  const activeTabData = useMemo(() => tabs.find(t => t.id === activeTab), [tabs, activeTab]);
  const activeTabContent = activeTabData?.content || '';
  const editorLanguage = getLanguageFromPath(activeTabData?.path || activeTabData?.title) || initialLanguage;
  const editorRef = useRef<any>(null);
  type ExtensionRegistration = {
    dispose?: () => void | Promise<void>;
    registerFileUrl?: (filePath: string, url: string) => any;
  };

  const registeredExtensionsRef = useRef<Map<string, ExtensionRegistration>>(new Map());

  const normalizeExtensionManifest = (manifest: any, directoryName: string) => {
    const fallbackParts = directoryName.split('.');
    const name = manifest?.name || (fallbackParts.length > 1 ? fallbackParts.slice(1).join('.') : directoryName);
    const publisher = manifest?.publisher || (fallbackParts.length > 1 ? fallbackParts[0] : 'local');
    const engines = {
      ...(manifest?.engines ?? {}),
      vscode: manifest?.engines?.vscode ?? '*'
    };

    return {
      ...manifest,
      name,
      publisher,
      engines
    };
  };

  // Function to load and register extensions from a directory
  const loadExtensionsFromDir = async (dirPath: string, seenExtensions: Set<string>) => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;

    try {
      const exists = await ipc.invoke('fs:checkPathExistsAndIsDirectory', dirPath);
      if (!exists) return;

      const entries = await ipc.invoke('fs:readDir', dirPath);
      for (const entry of entries) {
        if (!entry.isDirectory) continue;
        const extDir = path.join(dirPath, entry.name);
        const packageJsonPath = path.join(extDir, 'package.json');
        const extensionJsonPath = path.join(extDir, 'extension.json');

        try {
          let manifestContent: string | null = null;
          if (await ipc.invoke('fs:exists', packageJsonPath)) {
            manifestContent = await ipc.invoke('fs:readFile', packageJsonPath);
          } else if (await ipc.invoke('fs:exists', extensionJsonPath)) {
            manifestContent = await ipc.invoke('fs:readFile', extensionJsonPath);
          }

          if (!manifestContent) continue;

          const manifest = normalizeExtensionManifest(JSON.parse(manifestContent), entry.name);
          const extensionId = `${manifest.publisher}.${manifest.name}`;
          if (seenExtensions.has(extensionId)) continue;
          seenExtensions.add(extensionId);

          if (!registeredExtensionsRef.current.has(extensionId)) {
            const hostKind = manifest.browser && !manifest.main
              ? ExtensionHostKind.LocalWebWorker
              : ExtensionHostKind.LocalProcess;
            const registration = registerExtension(
              manifest,
              hostKind,
              { path: `/extensions/${extensionId}` }
            ) as unknown as ExtensionRegistration;
            registeredExtensionsRef.current.set(extensionId, registration);

            if (registration.registerFileUrl) {
              const files: string[] = await ipc.invoke('fs:listFilesRecursive', extDir);
              for (const filePath of files) {
                const relativePath = `/${path.relative(extDir, filePath).replace(/\\/g, '/')}`;
                const fileUrl = pathToFileURL(filePath).toString();
                registration.registerFileUrl(relativePath, fileUrl);
              }
            }
          }
        } catch (e) {
          console.warn(`Failed to load extension at ${extDir}`, e);
        }
      }
    } catch (err) {
      console.error(`Failed to load extensions from ${dirPath}`, err);
    }
  };

  // Function to load and register extensions
  const loadExtensions = useCallback(async () => {
    const seenExtensions = new Set<string>();

    if (projectPath) {
      // Load project-specific extensions
      const projectExtensionsDir = path.join(projectPath, 'extensions');
      await loadExtensionsFromDir(projectExtensionsDir, seenExtensions);
    }

    const appRoot = typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : '';
    if (appRoot) {
      const vsCodeMainExtensionsDir = path.join(appRoot, 'vscode-main', 'extensions');
      await loadExtensionsFromDir(vsCodeMainExtensionsDir, seenExtensions);
    }

    for (const [extensionId, registration] of registeredExtensionsRef.current.entries()) {
      if (!seenExtensions.has(extensionId)) {
        await Promise.resolve(registration.dispose?.());
        registeredExtensionsRef.current.delete(extensionId);
      }
    }
  }, [projectPath]);

  useEffect(() => {
    loadExtensions();
  }, [loadExtensions]);

  useEffect(() => {
    const handler = () => {
      loadExtensions();
    };
    window.addEventListener('extensions:changed', handler);
    return () => window.removeEventListener('extensions:changed', handler);
  }, [loadExtensions]);

  const handleEditorMount = useCallback((editorInstance: any) => {
    editorRef.current = editorInstance;
  }, []);

  const normalizedProjectRoot = useMemo(() => normalizeProjectRoot(projectPath), [projectPath]);

  const normalizeEditorFilePath = useCallback(
    (targetPath: string) => {
      const trimmed = targetPath?.trim();
      if (!trimmed) return '';

      const sanitized = stripRelativeDrivePrefix(stripFileProtocol(trimmed));
      let normalized = path.normalize(sanitized);
      normalized = collapseDuplicateProjectRoot(normalized, normalizedProjectRoot);

      if (path.isAbsolute(normalized)) {
        return normalized;
      }

      if (normalizedProjectRoot) {
        const joined = path.normalize(path.join(normalizedProjectRoot, normalized));
        return collapseDuplicateProjectRoot(joined, normalizedProjectRoot);
      }

      return collapseDuplicateProjectRoot(path.resolve(normalized), normalizedProjectRoot);
    },
    [normalizedProjectRoot]
  );

  const readFileContent = useCallback(async (targetPath: string) => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) {
      return '';
    }
    try {
      const exists = await ipc.invoke('fs:checkPathExists', targetPath);
      if (!exists) {
        console.warn(`Attempted to open a missing file: ${targetPath}`);
        return '';
      }
      const result = await ipc.invoke('fs:readFile', targetPath);
      return typeof result === 'string' ? result : '';
    } catch (error) {
      console.error('Failed to read file', targetPath, error);
      return '';
    }
  }, []);

  // Open a file in a new or existing tab and load its content
  const openFileInTab = useCallback(
    async (filePath: string) => {
      const normalizedPath = normalizeEditorFilePath(filePath);
      if (!normalizedPath) return;

      const existing = tabs.find(tab => tab.path === normalizedPath);
      if (existing) {
        setActiveTab(existing.id);
        return;
      }

      const content = await readFileContent(normalizedPath);
      const newTab = {
        id: Math.random().toString(36).slice(2),
        title: normalizedPath.split(/[\\/]/).pop() || normalizedPath,
        path: normalizedPath,
        content,
        dirty: false
      };
      setTabs(prev => [...prev, newTab]);
      setActiveTab(newTab.id);
    },
    [normalizeEditorFilePath, readFileContent, tabs]
  );

  // When activeFile changes, open the file in a tab
  useEffect(() => {
    if (activeFile) {
      openFileInTab(activeFile);
    }
  }, [activeFile, openFileInTab]);

  const openFileInTabRef = useRef(openFileInTab);
  useEffect(() => {
    openFileInTabRef.current = openFileInTab;
  }, [openFileInTab]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail === 'string') {
        openFileInTabRef.current(detail);
      }
    };
    window.addEventListener('editor:openFile', handler as EventListener);
    return () => window.removeEventListener('editor:openFile', handler as EventListener);
  }, []);

  // Handle editor content change
  const handleEditorChange = (val: string | undefined) => {
    if (!activeTab) return;
    setTabs(tabs.map(tab =>
      tab.id === activeTab ? { ...tab, content: val ?? '', dirty: true } : tab
    ));
    if (onEditorChange) onEditorChange(val ?? '');
  };

  // Save the currently active tab
  const saveActiveTab = async () => {
    const tab = tabs.find(t => t.id === activeTab);
    if (!tab || !window.electron?.ipcRenderer) return;
    await window.electron.ipcRenderer.invoke('fs:writeFile', tab.path, tab.content);
    setTabs(prev => prev.map(t => (t.id === tab.id ? { ...t, dirty: false } : t)));
    if (onSave) {
      onSave(tab.content);
    }
  };

  const handleTabClose = useCallback((tabId: string) => {
    setTabs(prevTabs => {
      const updated = prevTabs.filter(tab => tab.id !== tabId);
      if (activeTab === tabId) {
        setActiveTab(updated.length ? updated[updated.length - 1].id : null);
      }
      return updated;
    });
  }, [activeTab]);

  const saveAllTabs = async () => {
    if (!window.electron?.ipcRenderer) return;
    for (const tab of tabs) {
      await window.electron.ipcRenderer.invoke('fs:writeFile', tab.path, tab.content);
    }
    setTabs(prev => prev.map(tab => ({ ...tab, dirty: false })));
  };

  const triggerEditorCommand = (commandId: string, payload?: any) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    editorRef.current.trigger('menubar', commandId, payload);
  };

  const handleFileMenuCommand = useCallback(async (actionId: string) => {
    switch (actionId) {
      case 'save':
        await saveActiveTab();
        break;
      case 'saveAll':
        await saveAllTabs();
        break;
      case 'closeEditor':
        if (activeTab) {
          handleTabClose(activeTab);
        }
        break;
      default:
        break;
    }
  }, [activeTab, saveActiveTab, saveAllTabs, handleTabClose]);

  const handleEditMenuCommand = useCallback((actionId: string) => {
    switch (actionId) {
      case 'undo':
      case 'redo':
        triggerEditorCommand(actionId);
        break;
      case 'cut':
        triggerEditorCommand('editor.action.clipboardCutAction');
        break;
      case 'copy':
        triggerEditorCommand('editor.action.clipboardCopyAction');
        break;
      case 'paste':
        triggerEditorCommand('editor.action.clipboardPasteAction');
        break;
      case 'find':
        triggerEditorCommand('actions.find');
        break;
      case 'replace':
        triggerEditorCommand('editor.action.startFindReplaceAction');
        break;
      case 'toggleLineComment':
        triggerEditorCommand('editor.action.commentLine');
        break;
      case 'toggleBlockComment':
        triggerEditorCommand('editor.action.blockComment');
        break;
      default:
        break;
    }
  }, []);

  const handleSelectionMenuCommand = useCallback((actionId: string) => {
    const map: Record<string, string> = {
      selectAll: 'editor.action.selectAll',
      expandSelection: 'editor.action.smartSelect.grow',
      shrinkSelection: 'editor.action.smartSelect.shrink',
      copyLineUp: 'editor.action.copyLinesUpAction',
      copyLineDown: 'editor.action.copyLinesDownAction',
      moveLineUp: 'editor.action.moveLinesUpAction',
      moveLineDown: 'editor.action.moveLinesDownAction',
      duplicateSelection: 'editor.action.duplicateSelection',
      addCursorAbove: 'editor.action.insertCursorAbove',
      addCursorBelow: 'editor.action.insertCursorBelow',
      addCursorToLineEnds: 'editor.action.insertCursorAtEndOfEachLineSelected',
      addNextOccurrence: 'editor.action.addSelectionToNextFindMatch',
      addPreviousOccurrence: 'editor.action.addSelectionToPreviousFindMatch',
      selectAllOccurrences: 'editor.action.selectHighlights',
      columnSelectionMode: 'editor.action.toggleColumnSelectionMode'
    };
    const command = map[actionId];
    if (command) {
      triggerEditorCommand(command);
    }
  }, []);

  const handleGoMenuCommand = useCallback((actionId: string) => {
    const map: Record<string, string> = {
      goBack: 'editor.action.navigateBack',
      goForward: 'editor.action.navigateForward',
      goToLineColumn: 'editor.action.gotoLine',
      goToBracket: 'editor.action.jumpToBracket',
      goToDefinition: 'editor.action.revealDefinition',
      goToDeclaration: 'editor.action.revealDeclaration',
      goToTypeDefinition: 'editor.action.goToTypeDefinition',
      goToImplementations: 'editor.action.goToImplementation',
      goToReferences: 'editor.action.goToReferences',
      goToSymbolInEditor: 'editor.action.quickOutline'
    };
    const command = map[actionId];
    if (command) {
      triggerEditorCommand(command);
    }
  }, []);

  const handleViewMenuCommand = useCallback((actionId: string) => {
    if (actionId === 'wordWrap') {
      setWordWrapEnabled(value => !value);
      return;
    }
    if (actionId === 'terminal' || actionId === 'run') {
      setIsTerminalPanelOpen(true);
      return;
    }
    if (['explorer', 'search', 'extensions', 'git'].includes(actionId)) {
      setSidebarTab(actionId);
    }
  }, []);

  const handleTerminalMenuCommand = useCallback(
    (actionId: string) => {
      setIsTerminalPanelOpen(true);
      switch (actionId) {
        case 'newTerminal':
          emitTerminalAction('newTerminal');
          break;
        case 'runActiveFile':
          emitTerminalAction('runActiveFile', { path: activeTabData?.path });
          break;
        default:
          emitTerminalAction('showInfo', { message: 'Diese Terminalaktion ist noch nicht hinterlegt.' });
          break;
      }
    },
    [activeTabData?.path, emitTerminalAction]
  );

  const handleRunMenuCommand = useCallback(
    (actionId: string) => {
      setIsTerminalPanelOpen(true);
      if (actionId === 'runActiveFile') {
        emitTerminalAction('runActiveFile', { path: activeTabData?.path });
        return;
      }
      emitTerminalAction('showInfo', {
        message: `Die Aktion "${actionId}" ist noch nicht implementiert.`
      });
    },
    [activeTabData?.path, emitTerminalAction]
  );

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

  // Helper function to check if a file is a media file
  const isMediaFile = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (!ext) return false;
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'];
    const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
    return imageExts.includes(ext) || videoExts.includes(ext);
  };

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ menu: string; actionId: string; data?: any }>).detail;
      if (!detail) return;
      switch (detail.menu) {
        case 'File':
          handleFileMenuCommand(detail.actionId);
          break;
        case 'Edit':
          handleEditMenuCommand(detail.actionId);
          break;
        case 'Selection':
          handleSelectionMenuCommand(detail.actionId);
          break;
        case 'Go':
          handleGoMenuCommand(detail.actionId);
          break;
        case 'View':
          handleViewMenuCommand(detail.actionId);
          break;
        case 'Run':
          handleRunMenuCommand(detail.actionId);
          break;
        case 'Terminal':
          handleTerminalMenuCommand(detail.actionId);
          break;
        default:
          break;
      }
    };
    window.addEventListener('editor:menu', handler as EventListener);
    return () => window.removeEventListener('editor:menu', handler as EventListener);
  }, [
    handleEditMenuCommand,
    handleFileMenuCommand,
    handleGoMenuCommand,
    handleSelectionMenuCommand,
    handleViewMenuCommand,
    handleRunMenuCommand,
    handleTerminalMenuCommand
  ]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (!detail) {
        return;
      }
      if (detail === 'terminal') {
        setIsTerminalPanelOpen(true);
        return;
      }
      if (detail === 'ai') {
        setIsAIPanelOpen(true);
        return;
      }
      setSidebarTab(detail);
    };
    window.addEventListener('sidebar:switch', handler as EventListener);
    return () => window.removeEventListener('sidebar:switch', handler as EventListener);
  }, []);

  const handleOpenExtensionManifest = (manifestPath: string) => {
    if (!manifestPath) {
      return;
    }
    setSidebarTab('explorer');
    openFileInTab(manifestPath);
  };

  return (
    <ThemeProvider>
      <EditorProvider>
        <AIProvider>
          <div className="editor-layout-root">
            <Sidebar
              activeTab={sidebarTab}
              onTabChange={handleSidebarTabChange}
              aiActive={isAIPanelOpen}
              terminalActive={isTerminalPanelOpen}
            />
            <div className="editor-layout-main">
              <Resizable
                defaultSize={{ width: 260, height: '100%' }}
                minWidth={200}
                maxWidth={500}
                enable={{ right: true }}
                className="file-explorer-resizable"
              >
                {sidebarTab === 'extensions' ? (
                  <ExtensionsPanel
                    projectPath={projectPath}
                    onOpenExtension={handleOpenExtensionManifest}
                  />
                ) : (
                  <FileExplorer
                    fileStructure={fileStructure}
                    onOpenFile={openFileInTab}
                    activeFile={tabs.find(t => t.id === activeTab)?.path || ''}
                    projectPath={projectPath}
                  />
                )}
              </Resizable>
              <div className="editor-container">
                <TabBar
                  tabs={tabs}
                  activeTab={activeTab}
                  onTabClose={handleTabClose}
                  onTabSelect={setActiveTab}
                />
                <div className="editor-path-display" title={activeTabData?.path || 'Keine Datei geöffnet'}>
                  <span className="editor-path-label">Pfad:</span>
                  <span className="editor-path-value">
                    {activeTabData?.path || 'Keine Datei geöffnet'}
                  </span>
                </div>
                <div className="editor-area">
                  {tabs.length > 0 && activeTab ? (
                    <Editor
                      key={activeTab}
                      height="100%"
                      language={editorLanguage}
                      value={activeTabContent}
                      beforeMount={configureDiagnostics}
                      onChange={handleEditorChange}
                      path={activeTabData?.path}
                      onMount={handleEditorMount}
                      theme="vs-dark"
                      options={{
                        fontSize: 16,
                        minimap: { enabled: false },
                        wordWrap: wordWrapEnabled ? 'on' : 'off',
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        lineNumbers: 'on', // Ensure line numbers are always on
                        glyphMargin: true,
                        renderLineHighlight: 'all',
                        scrollbar: { vertical: 'visible', horizontal: 'visible' },
                        quickSuggestions: false,
                        suggestOnTriggerCharacters: false,
                        smoothScrolling: true,
                        stickyScroll: { enabled: true }
                      }}
                    />
                  ) : (
                    <div className="editor-empty-ui">
                      <FaRegFile size={64} color="#888" />
                      <div className="editor-empty-title">No file opened</div>
                      <div className="editor-empty-desc">Select a file in the explorer or create a new file to get started.</div>
                    </div>
                  )}
                </div>
                {isTerminalPanelOpen && (
                  <Resizable
                    defaultSize={{ height: 320, width: '100%' }}
                    minHeight={100}
                    maxHeight={600}
                    enable={{ top: true }}
                    className="terminal-resizable"
                  >
                    <IntegratedTerminal
                      projectPath={projectPath}
                      onClose={() => setIsTerminalPanelOpen(false)}
                    />
                  </Resizable>
                )}
              </div>
            </div>
            {isAIPanelOpen && (
              <Resizable
                defaultSize={{ width: 360, height: '100%' }}
                minWidth={260}
                maxWidth={640}
                enable={{ left: true }}
                className="ai-panel-resizable"
              >
                <AIChatPanel
                  fileStructure={fileStructure}
                  projectPath={projectPath}
                  activeFilePath={activeTabData?.path}
                  openFiles={tabs.map(tab => tab.path)}
                />
              </Resizable>
            )}
          </div>
        </AIProvider>
      </EditorProvider>
    </ThemeProvider>
  );
};
