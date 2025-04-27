declare global {
  interface Window {
    monaco?: typeof monaco;
    vscode?: typeof vscode;
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