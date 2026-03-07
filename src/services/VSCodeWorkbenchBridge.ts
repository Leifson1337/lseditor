import { Buffer } from 'buffer';
import getConfigurationServiceOverride, {
  reinitializeWorkspace,
  type IAnyWorkspaceIdentifier
} from '@codingame/monaco-vscode-configuration-service-override';
import getDebugServiceOverride from '@codingame/monaco-vscode-debug-service-override';
import getExtensionsServiceOverride from '@codingame/monaco-vscode-extensions-service-override';
import getFilesServiceOverride, {
  FileChangeType,
  FileSystemProviderCapabilities,
  FileSystemProviderError,
  FileSystemProviderErrorCode,
  FileType,
  registerFileSystemOverlay,
  type IFileChange,
  type IFileDeleteOptions,
  type IFileOverwriteOptions,
  type IFileSystemProviderWithFileReadWriteCapability,
  type IFileWriteOptions,
  type IStat,
  type IWatchOptions
} from '@codingame/monaco-vscode-files-service-override';
import getScmServiceOverride from '@codingame/monaco-vscode-scm-service-override';
import getSearchServiceOverride from '@codingame/monaco-vscode-search-service-override';
import getTaskServiceOverride from '@codingame/monaco-vscode-task-service-override';
import getTerminalServiceOverride, {
  SimpleTerminalBackend,
  SimpleTerminalProcess,
  type ITerminalBackend,
  type ITerminalChildProcess
} from '@codingame/monaco-vscode-terminal-service-override';
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override';
import {
  initialize,
  type IWorkbenchConstructionOptions,
  type IWorkspace,
  type IWorkspaceProvider
} from '@codingame/monaco-vscode-api/services';
import { createFileSystemProviderError } from '@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files';
import { Emitter, Event as VSCodeEvent } from '@codingame/monaco-vscode-api/vscode/vs/base/common/event';
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';
import type { IDisposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle';
import getViewCommonServiceOverride from '@codingame/monaco-vscode-view-common-service-override';
import getViewsServiceOverride from '@codingame/monaco-vscode-views-service-override';
import 'vscode/localExtensionHost';

const WORKSPACE_STORAGE_KEY = 'lseditor.workspacePath';
const WORKSPACE_EVENT = 'lseditor:workspace-changed';

type FsEntry = {
  name: string;
  isDirectory: boolean;
};

type FsStatResult = {
  ctime: number;
  mtime: number;
  size: number;
  type: 'file' | 'directory' | 'unknown';
};

function getIpcRenderer() {
  return (window as any).electron?.ipcRenderer;
}

function getStoredWorkspacePath(): string | null {
  try {
    const value = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    return value && value.trim().length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function persistWorkspacePath(workspacePath: string): void {
  if (!workspacePath) {
    return;
  }

  try {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, workspacePath);
  } catch (error) {
    console.warn('Failed to persist workspace path:', error);
  }
}

export function notifyWorkspaceChanged(workspacePath: string): void {
  persistWorkspacePath(workspacePath);
  window.dispatchEvent(new CustomEvent(WORKSPACE_EVENT, { detail: workspacePath }));
}

function toWorkspaceFolder(workspacePath: string): IWorkspace {
  return {
    folderUri: URI.file(workspacePath)
  };
}

function toWorkspaceIdentifier(workspacePath: string): IAnyWorkspaceIdentifier {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `workspace-${Date.now()}`,
    uri: URI.file(workspacePath)
  };
}

function toProviderError(error: unknown, code: FileSystemProviderErrorCode, resource?: URI): Error {
  if (error instanceof FileSystemProviderError) {
    return error;
  }

  const target = resource ? ` ${resource.toString()}` : '';
  const message = error instanceof Error ? error.message : `Filesystem request failed for${target}`;
  return createFileSystemProviderError(message, code);
}

class ElectronFileSystemProvider implements IFileSystemProviderWithFileReadWriteCapability {
  readonly capabilities =
    FileSystemProviderCapabilities.FileReadWrite |
    FileSystemProviderCapabilities.FileOpenReadWriteClose |
    FileSystemProviderCapabilities.FileFolderCopy |
    (process.platform === 'win32' ? 0 : FileSystemProviderCapabilities.PathCaseSensitive);

  readonly onDidChangeCapabilities = VSCodeEvent.None;

  private readonly fileChanges = new Emitter<readonly IFileChange[]>();

  readonly onDidChangeFile = this.fileChanges.event;

  watch(): IDisposable {
    return { dispose() {} };
  }

  async stat(resource: URI): Promise<IStat> {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) {
      throw toProviderError(new Error('ipcRenderer unavailable'), FileSystemProviderErrorCode.Unavailable, resource);
    }

    const result = await ipcRenderer.invoke('fs:stat', resource.fsPath) as FsStatResult | null;
    if (!result) {
      throw toProviderError(new Error('Path not found'), FileSystemProviderErrorCode.FileNotFound, resource);
    }

    return {
      ctime: result.ctime,
      mtime: result.mtime,
      size: result.size,
      type: result.type === 'directory' ? FileType.Directory : FileType.File,
      permissions: undefined
    };
  }

  async readdir(resource: URI): Promise<[string, FileType][]> {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) {
      throw toProviderError(new Error('ipcRenderer unavailable'), FileSystemProviderErrorCode.Unavailable, resource);
    }

    const entries = await ipcRenderer.invoke('fs:readDir', resource.fsPath) as FsEntry[];
    return entries.map((entry) => [
      entry.name,
      entry.isDirectory ? FileType.Directory : FileType.File
    ]);
  }

  async readFile(resource: URI): Promise<Uint8Array> {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) {
      throw toProviderError(new Error('ipcRenderer unavailable'), FileSystemProviderErrorCode.Unavailable, resource);
    }

    const base64 = await ipcRenderer.invoke('fs:readFileBinary', resource.fsPath) as string | null;
    if (base64 == null) {
      throw toProviderError(new Error('Path not found'), FileSystemProviderErrorCode.FileNotFound, resource);
    }

    return Uint8Array.from(Buffer.from(base64, 'base64'));
  }

  async writeFile(resource: URI, content: Uint8Array, opts: IFileWriteOptions): Promise<void> {
    try {
      const ipcRenderer = getIpcRenderer();
      if (!ipcRenderer) {
        throw new Error('ipcRenderer unavailable');
      }

      const exists = await ipcRenderer.invoke('fs:exists', resource.fsPath) as boolean;
      if (exists && !opts.overwrite && !opts.create) {
        throw createFileSystemProviderError('File exists', FileSystemProviderErrorCode.FileExists);
      }
      if (!exists && !opts.create) {
        throw createFileSystemProviderError('File not found', FileSystemProviderErrorCode.FileNotFound);
      }

      const success = await ipcRenderer.invoke(
        'fs:writeFileBinary',
        resource.fsPath,
        Buffer.from(content).toString('base64')
      ) as boolean;

      if (!success) {
        throw new Error('Binary write failed');
      }

      this.fireChanges([{ type: exists ? FileChangeType.UPDATED : FileChangeType.ADDED, resource }]);
    } catch (error) {
      throw toProviderError(error, FileSystemProviderErrorCode.Unknown, resource);
    }
  }

  async mkdir(resource: URI): Promise<void> {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) {
      throw toProviderError(new Error('ipcRenderer unavailable'), FileSystemProviderErrorCode.Unavailable, resource);
    }

    const success = await ipcRenderer.invoke('fs:createDirectory', resource.fsPath) as boolean;
    if (!success) {
      throw toProviderError(new Error('Directory creation failed'), FileSystemProviderErrorCode.Unknown, resource);
    }

    this.fireChanges([{ type: FileChangeType.ADDED, resource }]);
  }

  async delete(resource: URI, options: IFileDeleteOptions): Promise<void> {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) {
      throw toProviderError(new Error('ipcRenderer unavailable'), FileSystemProviderErrorCode.Unavailable, resource);
    }

    const stats = await this.stat(resource).catch(() => null);
    const isDirectory = stats?.type === FileType.Directory;
    const channel = isDirectory ? 'fs:deleteDirectory' : 'fs:deleteFile';
    const success = await ipcRenderer.invoke(channel, resource.fsPath, options?.recursive ?? false) as boolean;
    if (!success) {
      throw toProviderError(new Error('Delete failed'), FileSystemProviderErrorCode.Unknown, resource);
    }

    this.fireChanges([{ type: FileChangeType.DELETED, resource }]);
  }

  async rename(from: URI, to: URI, opts: IFileOverwriteOptions): Promise<void> {
    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) {
      throw toProviderError(new Error('ipcRenderer unavailable'), FileSystemProviderErrorCode.Unavailable, from);
    }

    if (!opts.overwrite) {
      const targetExists = await ipcRenderer.invoke('fs:exists', to.fsPath) as boolean;
      if (targetExists) {
        throw toProviderError(new Error('Target exists'), FileSystemProviderErrorCode.FileExists, to);
      }
    }

    const success = await ipcRenderer.invoke('fs:renameFile', from.fsPath, to.fsPath) as boolean;
    if (!success) {
      throw toProviderError(new Error('Rename failed'), FileSystemProviderErrorCode.Unknown, from);
    }

    this.fireChanges([
      { type: FileChangeType.DELETED, resource: from },
      { type: FileChangeType.ADDED, resource: to }
    ]);
  }

  private fireChanges(changes: IFileChange[]): void {
    this.fileChanges.fire(changes);
  }
}

class ElectronTerminalProcess extends SimpleTerminalProcess {
  private readonly onExitEmitter = new Emitter<number | undefined>();
  private readonly dataEmitter: Emitter<string>;
  private readonly disposables: Array<() => void> = [];
  private sessionId: string | null = null;
  private started = false;

  override readonly onProcessExit = this.onExitEmitter.event;

  constructor(
    id: number,
    cwd: string,
    private readonly cols: number,
    private readonly rows: number,
    private readonly shellLaunchConfig?: {
      executable?: string;
      cwd?: string;
      env?: Record<string, string>;
    }
  ) {
    const dataEmitter = new Emitter<string>();
    super(id, id, cwd, dataEmitter.event);
    this.dataEmitter = dataEmitter;
  }

  async start(): Promise<{ injectedArgs: string[] } | undefined> {
    if (this.started) {
      return { injectedArgs: [] };
    }

    const ipcRenderer = getIpcRenderer();
    if (!ipcRenderer) {
      throw new Error('ipcRenderer unavailable');
    }

    const result = await ipcRenderer.invoke('terminal:create', {
      cwd: this.shellLaunchConfig?.cwd ?? this.cwd,
      cols: this.cols,
      rows: this.rows,
      shell: this.shellLaunchConfig?.executable,
      env: this.shellLaunchConfig?.env
    });

    this.sessionId = result?.sessionId ?? null;
    this.started = true;

    const handleData = (_event: unknown, payload: { sessionId?: string; data?: string }) => {
      if (payload?.sessionId === this.sessionId && typeof payload.data === 'string') {
        this.dataEmitter.fire(payload.data);
      }
    };
    const handleExit = (_event: unknown, payload: { sessionId?: string; exitCode?: number }) => {
      if (payload?.sessionId === this.sessionId) {
        this.onExitEmitter.fire(payload.exitCode ?? 0);
        this.disposeListeners();
      }
    };
    const handleError = (_event: unknown, payload: { sessionId?: string; message?: string }) => {
      if (payload?.sessionId === this.sessionId && payload.message) {
        this.dataEmitter.fire(`\r\n${payload.message}\r\n`);
      }
    };

    const electron = (window as any).electron?.ipcRenderer;
    electron?.on('terminal:data', handleData);
    electron?.on('terminal:exit', handleExit);
    electron?.on('terminal:error', handleError);
    this.disposables.push(() => electron?.removeListener('terminal:data', handleData));
    this.disposables.push(() => electron?.removeListener('terminal:exit', handleExit));
    this.disposables.push(() => electron?.removeListener('terminal:error', handleError));

    return { injectedArgs: [] };
  }

  shutdown(): void {
    if (!this.sessionId) {
      return;
    }

    const ipcRenderer = getIpcRenderer();
    ipcRenderer?.invoke('terminal:dispose', { sessionId: this.sessionId }).catch((error: unknown) => {
      console.warn('Failed to dispose terminal process:', error);
    });
    this.disposeListeners();
  }

  input(data: string): void {
    if (!this.sessionId) {
      return;
    }

    getIpcRenderer()?.send('terminal:write', { sessionId: this.sessionId, data });
  }

  resize(cols: number, rows: number): void {
    if (!this.sessionId) {
      return;
    }

    getIpcRenderer()?.send('terminal:resize', { sessionId: this.sessionId, cols, rows });
  }

  sendSignal(): void {
    this.shutdown();
  }

  clearBuffer(): void {
    this.dataEmitter.fire('\u001bc');
  }

  private disposeListeners(): void {
    while (this.disposables.length > 0) {
      const dispose = this.disposables.pop();
      dispose?.();
    }
  }
}

class ElectronTerminalBackend extends SimpleTerminalBackend implements ITerminalBackend {
  private lastId = 0;

  override getDefaultSystemShell = async (): Promise<string> => {
    return process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';
  };

  override createProcess = async (
    shellLaunchConfig: any,
    cwd: string,
    cols: number,
    rows: number
  ): Promise<ITerminalChildProcess> => {
    const processId = ++this.lastId;
    const terminalProcess = new ElectronTerminalProcess(processId, cwd, cols, rows, shellLaunchConfig);
    return terminalProcess;
  };

  override getProfiles = async (): Promise<any[]> => {
    return [
      {
        profileName: 'Default',
        path: await this.getDefaultSystemShell(),
        isDefault: true
      }
    ];
  };
}

let workbenchInitialization: Promise<void> | null = null;

export function initializeVSCodeWorkbench(): Promise<void> {
  if (workbenchInitialization) {
    return workbenchInitialization;
  }

  const workspacePath = getStoredWorkspacePath();
  const workspaceProvider: IWorkspaceProvider = {
    workspace: workspacePath ? toWorkspaceFolder(workspacePath) : undefined,
    trusted: true,
    async open(workspace: IWorkspace) {
      const nextPath = workspace && 'folderUri' in workspace && workspace.folderUri ? workspace.folderUri.fsPath : null;
      if (nextPath) {
        notifyWorkspaceChanged(nextPath);
      }
      return true;
    }
  };

  const fileSystemProvider = new ElectronFileSystemProvider();
  registerFileSystemOverlay(10, fileSystemProvider);

  const terminalBackend = new ElectronTerminalBackend();
  terminalBackend.setReady();

  const configuration: IWorkbenchConstructionOptions = {
    workspaceProvider,
    enableWorkspaceTrust: true,
    webviewEndpoint: `${window.location.origin}/vscode-webview`
  };

  // Use a dedicated hidden container for VS Code services to avoid
  // conflicts with the React-managed DOM tree
  let workbenchContainer = document.getElementById('vscode-workbench-container');
  if (!workbenchContainer) {
    workbenchContainer = document.createElement('div');
    workbenchContainer.id = 'vscode-workbench-container';
    workbenchContainer.style.position = 'absolute';
    workbenchContainer.style.width = '0';
    workbenchContainer.style.height = '0';
    workbenchContainer.style.overflow = 'hidden';
    workbenchContainer.style.pointerEvents = 'none';
    document.body.appendChild(workbenchContainer);
  }

  workbenchInitialization = initialize(
    {
      ...getExtensionsServiceOverride({ enableWorkerExtensionHost: true }),
      ...getFilesServiceOverride(),
      ...getConfigurationServiceOverride(),
      ...getThemeServiceOverride(),
      ...getSearchServiceOverride(),
      ...getScmServiceOverride(),
      ...getDebugServiceOverride(),
      ...getTaskServiceOverride({
        forcedSupportedExecutions: {
          custom: true,
          shell: true,
          process: true
        }
      }),
      ...getTerminalServiceOverride(terminalBackend),
      ...getViewCommonServiceOverride(),
      ...getViewsServiceOverride()
    },
    workbenchContainer,
    configuration
  ).then(() => {
    window.addEventListener(WORKSPACE_EVENT, async (event: globalThis.Event) => {
      const customEvent = event as CustomEvent<string>;
      const nextPath = customEvent.detail;
      if (!nextPath) {
        return;
      }

      try {
        await reinitializeWorkspace(toWorkspaceIdentifier(nextPath));
      } catch (error) {
        console.error('Failed to reinitialize workspace:', error);
      }
    });
  });

  return workbenchInitialization;
}
