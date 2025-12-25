const { contextBridge, ipcRenderer } = require('electron');

// Speichern der Event-Listener, um sie später entfernen zu können
const listeners = new Map();

// Whitelist for allowed IPC channels
const ALLOWED_INVOKE_CHANNELS = [
  'fs:readDir', 'fs:readFile', 'fs:writeFile', 'fs:exists', 'fs:listFilesRecursive',
  'fs:checkPathExistsAndIsDirectory', 'fs:createDirectory',
  'fs:deleteFile', 'fs:deleteDirectory', 'fs:renameFile', 'fs:checkPathExists',
  'getDirectoryEntries', 'extension:search', 'extension:install', 'extension:uninstall', 'extension:list',
  'window:minimize', 'window:maximize', 'window:unmaximize', 'window:close', 'window:isMaximized',
  'ai:getBasePrompt', 'ai:chat', 'ai:refactor',
  'get-code-completion', 'explain-code', 'refactor-code', 'editor:findInFiles',
  'exec', 'terminal:create', 'terminal:kill', 'terminal:resize', 'terminal:dispose',
  'dialog:showOpenDialog', 'dialog:openDirectory', 'dialog:inputBox',
  'app:getVersion', 'app:openAbout', 'app:newWindow', 'app:openFile', 'app:openFolder', 'app:exit',
  'shell:openPath', 'edit:undo', 'edit:redo', 'edit:cut', 'edit:copy', 'edit:paste', 'edit:find', 'edit:replace',
  'view:toggleFullScreen', 'view:reload', 'terminal:new', 'terminal:runActiveFile', 'file:newTextFile'
];

const ALLOWED_SEND_CHANNELS = [
  'window:minimize', 'window:maximize', 'window:unmaximize', 'window:close',
  'terminal:write', 'terminal:resize', 'terminal:action'
];

const ALLOWED_ON_CHANNELS = [
  'terminal:data', 'terminal:exit', 'terminal:error', 'terminal:output',
  'editor:openFile', 'editor:menu', 'sidebar:switch', 'create-new-text-file',
  'folder:open', 'file:open', 'editor:findInFilesResults', 'explorer:refresh'
];

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel, ...args) => {
      if (ALLOWED_INVOKE_CHANNELS.includes(channel)) {
        return ipcRenderer.invoke(channel, ...args);
      }
      console.error(`Blocked unauthorized IPC invoke on channel: ${channel}`);
      return Promise.reject(new Error(`Unauthorized IPC channel: ${channel}`));
    },
    send: (channel, ...args) => {
      if (ALLOWED_SEND_CHANNELS.includes(channel)) {
        return ipcRenderer.send(channel, ...args);
      }
      console.error(`Blocked unauthorized IPC send on channel: ${channel}`);
    },
    on: (channel, listener) => {
      if (!ALLOWED_ON_CHANNELS.includes(channel)) {
        console.error(`Blocked unauthorized IPC listener on channel: ${channel}`);
        return;
      }
      // Wrapper-Funktion erstellen, um den ursprünglichen Listener zu speichern
      const wrappedListener = (event, ...args) => listener(event, ...args);

      // Listener und Wrapper in der Map speichern
      if (!listeners.has(channel)) {
        listeners.set(channel, new Map());
      }
      listeners.get(channel).set(listener, wrappedListener);

      // Event-Listener hinzufügen
      ipcRenderer.on(channel, wrappedListener);
    },
    removeListener: (channel, listener) => {
      // Wrapper-Funktion aus der Map abrufen
      if (listeners.has(channel) && listeners.get(channel).has(listener)) {
        const wrappedListener = listeners.get(channel).get(listener);

        // Event-Listener entfernen
        ipcRenderer.removeListener(channel, wrappedListener);

        // Listener aus der Map entfernen
        listeners.get(channel).delete(listener);
        // Kanal aus der Map entfernen, wenn keine Listener mehr vorhanden sind
        if (listeners.get(channel).size === 0) {
          listeners.delete(channel);
        }
      }
    }
  },
  windowControls: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    unmaximize: () => ipcRenderer.send('window:unmaximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized')
  }
});
