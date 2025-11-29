// electron.d.ts
// TypeScript type definitions for Electron APIs used in the application.

/**
 * Represents the Electron module, providing access to Electron APIs.
 */
declare module 'electron' {
  /**
   * IpcMain represents the IPC main process API.
   */
  interface IpcMain {
    /**
     * Listen for IPC messages on a specific channel.
     * @param channel The IPC channel
     * @param listener Listener function for received data
     */
    on(channel: string, listener: (event: any, ...args: any[]) => void): this;

    /**
     * Listen for IPC messages on a specific channel, only once.
     * @param channel The IPC channel
     * @param listener Listener function for received data
     */
    once(channel: string, listener: (event: any, ...args: any[]) => void): this;

    /**
     * Remove an IPC listener from a specific channel.
     * @param channel The IPC channel
     * @param listener Listener function to remove
     */
    removeListener(channel: string, listener: (...args: any[]) => void): this;

    /**
     * Remove all IPC listeners from a specific channel, or all channels if none specified.
     * @param channel The IPC channel (optional)
     */
    removeAllListeners(channel?: string): this;
  }

  /**
   * IpcRenderer represents the IPC renderer process API.
   */
  interface IpcRenderer {
    /**
     * Listen for IPC messages on a specific channel.
     * @param channel The IPC channel
     * @param listener Listener function for received data
     */
    on(channel: string, listener: (event: any, ...args: any[]) => void): this;

    /**
     * Listen for IPC messages on a specific channel, only once.
     * @param channel The IPC channel
     * @param listener Listener function for received data
     */
    once(channel: string, listener: (event: any, ...args: any[]) => void): this;

    /**
     * Send data to the main process via a channel.
     * @param channel The IPC channel
     * @param args Arguments to send
     */
    send(channel: string, ...args: any[]): void;

    /**
     * Send data to the main process via a channel and receive a response.
     * @param channel The IPC channel
     * @param args Arguments to send
     */
    sendSync(channel: string, ...args: any[]): any;

    /**
     * Remove an IPC listener from a specific channel.
     * @param channel The IPC channel
     * @param listener Listener function to remove
     */
    removeListener(channel: string, listener: (...args: any[]) => void): this;

    /**
     * Remove all IPC listeners from a specific channel, or all channels if none specified.
     * @param channel The IPC channel (optional)
     */
    removeAllListeners(channel?: string): this;
  }

  /**
   * App represents the Electron application API.
   */
  interface App {
    /**
     * Listen for application events.
     * @param event The event name
     * @param listener Listener function for the event
     */
    on(event: string, listener: (...args: any[]) => void): this;

    /**
     * Quit the application.
     */
    quit(): void;

    /**
     * Get the path to a specific application directory.
     * @param name The directory name
     */
    getPath(name: string): string;
  }

  /**
   * BrowserWindow represents the Electron browser window API.
   */
  interface BrowserWindow {
    /**
     * Listen for window events.
     * @param event The event name
     * @param listener Listener function for the event
     */
    on(event: string, listener: (...args: any[]) => void): this;

    /**
     * Load a file into the window.
     * @param filePath The file path
     */
    loadFile(filePath: string): Promise<void>;

    /**
     * Load a URL into the window.
     * @param url The URL
     */
    loadURL(url: string): Promise<void>;

    /**
     * Show the window.
     */
    show(): void;

    /**
     * Hide the window.
     */
    hide(): void;

    /**
     * Close the window.
     */
    close(): void;

    /**
     * Maximize the window.
     */
    maximize(): void;

    /**
     * Minimize the window.
     */
    minimize(): void;

    /**
     * Restore the window to its original size.
     */
    restore(): void;

    /**
     * Focus the window.
     */
    focus(): void;

    /**
     * Get the web contents of the window.
     */
    webContents: any;

    /**
     * Check if the window is maximized.
     */
    isMaximized(): boolean;

    /**
     * Unmaximize the window.
     */
    unmaximize(): void;
  }

  /**
   * ElectronAPI defines methods and properties exposed to the renderer process.
   */
  interface ElectronAPI {
    /**
     * Send data to the main process via a channel.
     * @param channel The IPC channel
     * @param args Arguments to send
     */
    send(channel: string, ...args: any[]): void;

    /**
     * Receive data from the main process via a channel.
     * @param channel The IPC channel
     * @param listener Listener function for received data
     */
    receive(channel: string, listener: (...args: any[]) => void): void;
  }

  /**
   * Represents the main Electron API exposed via contextBridge or preload scripts.
   */
  declare global {
    interface Window {
      electronAPI: ElectronAPI; // Electron API exposed to the renderer
      // Add other custom properties as needed
    }
  }

  /**
   * Exported Electron APIs.
   */
  export const app: App;
  export const ipcMain: IpcMain;
  export const ipcRenderer: IpcRenderer;

  /**
   * BrowserWindow constructor options.
   */
  export class BrowserWindow {
    constructor(options?: {
      /**
       * The initial width of the window.
       */
      width?: number;

      /**
       * The initial height of the window.
       */
      height?: number;

      /**
       * Whether the window should be shown initially.
       */
      show?: boolean;

      /**
       * Web preferences for the window.
       */
      webPreferences?: {
        /**
         * Whether to enable Node.js integration.
         */
        nodeIntegration?: boolean;

        /**
         * Whether to enable context isolation.
         */
        contextIsolation?: boolean;

        /**
         * Whether to enable remote module access.
         */
        enableRemoteModule?: boolean;
      };
    });
  }
}

/**
 * Represents the global window interface with Electron properties.
 */
interface Window {
  electron?: {
    /**
     * IPC renderer API.
     */
    ipcRenderer: {
      /**
       * Invoke an IPC method.
       * @param channel The IPC channel
       * @param args Arguments to send
       */
      invoke: (channel: string, ...args: any[]) => Promise<any>;

      /**
       * Send data to the main process via a channel.
       * @param channel The IPC channel
       * @param args Arguments to send
       */
      send: (channel: string, ...args: any[]) => void;

      /**
       * Listen for IPC messages on a specific channel.
       * @param channel The IPC channel
       * @param listener Listener function for received data
       */
      on: (channel: string, listener: (event: any, ...args: any[]) => void) => void;

      /**
       * Remove an IPC listener from a specific channel.
       * @param channel The IPC channel
       * @param listener Listener function to remove
       */
      removeListener: (channel: string, listener: (...args: any[]) => void) => void;
    };

    /**
     * Window controls API.
     */
    windowControls: {
      /**
       * Minimize the window.
       */
      minimize: () => void;

      /**
       * Maximize the window.
       */
      maximize: () => void;

      /**
       * Unmaximize the window.
       */
      unmaximize: () => void;

      /**
       * Close the window.
       */
      close: () => void;

      /**
       * Check if the window is maximized.
       */
      isMaximized: () => Promise<boolean>;

      /**
       * Listen for window maximize events.
       * @param callback Callback function for maximize events
       */
      onMaximize: (callback: () => void) => void;

      /**
       * Listen for window unmaximize events.
       * @param callback Callback function for unmaximize events
       */
      onUnmaximize: (callback: () => void) => void;

      /**
       * Remove a window maximize listener.
       * @param callback Callback function to remove
       */
      removeMaximizeListener: (callback: () => void) => void;

      /**
       * Remove a window unmaximize listener.
       * @param callback Callback function to remove
       */
      removeUnmaximizeListener: (callback: () => void) => void;
    };
  };
}