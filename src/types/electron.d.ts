declare module 'electron' {
  interface IpcMain {
    on(channel: string, listener: (event: any, ...args: any[]) => void): this;
    once(channel: string, listener: (event: any, ...args: any[]) => void): this;
    removeListener(channel: string, listener: (...args: any[]) => void): this;
    removeAllListeners(channel?: string): this;
  }

  interface IpcRenderer {
    on(channel: string, listener: (event: any, ...args: any[]) => void): this;
    once(channel: string, listener: (event: any, ...args: any[]) => void): this;
    send(channel: string, ...args: any[]): void;
    sendSync(channel: string, ...args: any[]): any;
    removeListener(channel: string, listener: (...args: any[]) => void): this;
    removeAllListeners(channel?: string): this;
  }

  interface App {
    on(event: string, listener: (...args: any[]) => void): this;
    quit(): void;
    getPath(name: string): string;
  }

  interface BrowserWindow {
    on(event: string, listener: (...args: any[]) => void): this;
    loadFile(filePath: string): Promise<void>;
    loadURL(url: string): Promise<void>;
    show(): void;
    hide(): void;
    close(): void;
    maximize(): void;
    minimize(): void;
    restore(): void;
    focus(): void;
    webContents: any;
    isMaximized(): boolean;
    unmaximize(): void;
  }

  export const app: App;
  export const ipcMain: IpcMain;
  export const ipcRenderer: IpcRenderer;
  
  export class BrowserWindow {
    constructor(options?: {
      width?: number;
      height?: number;
      show?: boolean;
      webPreferences?: {
        nodeIntegration?: boolean;
        contextIsolation?: boolean;
        enableRemoteModule?: boolean;
      };
    });
  }
} 

// Definiere die globale window-Schnittstelle mit Electron-Eigenschaften
interface Window {
  electron?: {
    ipcRenderer: {
      invoke: (channel: string, ...args: any[]) => Promise<any>;
      send: (channel: string, ...args: any[]) => void;
      on: (channel: string, listener: (event: any, ...args: any[]) => void) => void;
      removeListener: (channel: string, listener: (...args: any[]) => void) => void;
    };
    windowControls: {
      minimize: () => void;
      maximize: () => void;
      unmaximize: () => void;
      close: () => void;
      isMaximized: () => Promise<boolean>;
      onMaximize: (callback: () => void) => void;
      onUnmaximize: (callback: () => void) => void;
      removeMaximizeListener: (callback: () => void) => void;
      removeUnmaximizeListener: (callback: () => void) => void;
    };
  };
}