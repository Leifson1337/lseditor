const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('backendPreference', {
  getSnapshot: () => ipcRenderer.invoke('backend-pref:get-snapshot'),
  complete: choice => ipcRenderer.invoke('backend-pref:complete', choice),
  cancel: () => ipcRenderer.invoke('backend-pref:cancel')
});
