declare global {
  interface Window {
    monaco?: typeof monaco;
    vscode?: typeof vscode;
    firstSetup?: {
      getGpuInfo: () => Promise<{
        hasDedicatedGPU: boolean;
        name: string;
        vramGB: number;
        vramMB: number;
      }>;
      getSetupContext?: () => Promise<{
        scenario:
          | 'ollama-detected'
          | 'lmstudio-detected'
          | 'both-installed'
          | 'ollama-only-installed'
          | 'lm-only-installed'
          | 'no-backend'
          | 'insufficient-hardware';
        canDownloadOllama: boolean;
        ollamaDetected: boolean;
        detectedModels: string[];
        parallel?: unknown;
      }>;
      getOllamaModels?: () => Promise<{ reachable: boolean; models: string[] }>;
      download: (type: 'ollama' | 'lmstudio') => Promise<string>;
      installOllama: (installerPath: string) => Promise<void>;
      revealInFolder: (filePath: string) => Promise<void>;
      openLmStudioPage: () => Promise<void>;
      complete: (payload: {
        choice: 'ollama' | 'lmstudio' | 'none';
        preferredDefaultModel: string;
      }) => Promise<void>;
      onDownloadProgress: (
        cb: (data: { loaded: number; total: number | null; status: string }) => void
      ) => () => void;
    };
    electron?: {
      ipcRenderer: {
        invoke(channel: string, ...args: any[]): Promise<any>;
        send(channel: string, ...args: any[]): void;
        on(channel: string, listener: (...args: any[]) => void): void;
      };
      windowControls: {
        minimize: () => void;
        maximize: () => void;
        unmaximize: () => void;
        close: () => void;
      };
    };
  }
}

export {};
