const { contextBridge, ipcRenderer } = require('electron');

// Speichern der Event-Listener, um sie später entfernen zu können
const listeners = new Map();

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (...args) => ipcRenderer.invoke(...args),
    send: (...args) => ipcRenderer.send(...args),
    on: (channel, listener) => {
      // Wrapper-Funktion erstellen, um den ursprünglichen Listener zu speichern
      const wrappedListener = (event, ...args) => listener(...args);
      
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
