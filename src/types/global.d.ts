// global.d.ts
// Global TypeScript type declarations for the project.

/**
 * Declares global variables, interfaces, and types for the application.
 */
declare global {
  /**
   * The global window object.
   */
  interface Window {
    /**
     * The Monaco editor instance.
     */
    monaco?: typeof monaco;

    /**
     * The Visual Studio Code API instance.
     */
    vscode?: typeof vscode;

    /**
     * The Electron API instance.
     */
    electron?: {
      /**
       * The IPC renderer API.
       */
      ipcRenderer: {
        /**
         * Invokes a function on the main process.
         * @param channel The channel to invoke.
         * @param args The arguments to pass to the function.
         * @returns A promise that resolves with the result of the function.
         */
        invoke(channel: string, ...args: any[]): Promise<any>;

        /**
         * Sends a message to the main process.
         * @param channel The channel to send the message on.
         * @param args The arguments to pass to the message.
         */
        send(channel: string, ...args: any[]): void;

        /**
         * Listens for a message from the main process.
         * @param channel The channel to listen on.
         * @param listener The function to call when a message is received.
         */
        on(channel: string, listener: (...args: any[]) => void): void;
      };

      /**
       * The window controls API.
       */
      windowControls: {
        /**
         * Minimizes the window.
         */
        minimize: () => void;

        /**
         * Maximizes the window.
         */
        maximize: () => void;

        /**
         * Unmaximizes the window.
         */
        unmaximize: () => void;

        /**
         * Closes the window.
         */
        close: () => void;
      };
    };
  }
}

export {};