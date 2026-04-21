const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = [
  'first-setup:get-gpu',
  'first-setup:get-context',
  'first-setup:get-ollama-models',
  'first-setup:download',
  'first-setup:install-ollama',
  'first-setup:reveal-in-folder',
  'first-setup:open-lmstudio-page',
  'first-setup:complete'
];

contextBridge.exposeInMainWorld('firstSetup', {
  getGpuInfo: () => ipcRenderer.invoke('first-setup:get-gpu'),
  getSetupContext: () => ipcRenderer.invoke('first-setup:get-context'),
  getOllamaModels: () => ipcRenderer.invoke('first-setup:get-ollama-models'),
  download: type => ipcRenderer.invoke('first-setup:download', type),
  installOllama: installerPath => ipcRenderer.invoke('first-setup:install-ollama', installerPath),
  revealInFolder: filePath => ipcRenderer.invoke('first-setup:reveal-in-folder', filePath),
  openLmStudioPage: () => ipcRenderer.invoke('first-setup:open-lmstudio-page'),
  complete: payload => ipcRenderer.invoke('first-setup:complete', payload),
  onDownloadProgress: callback => {
    const fn = (_event, data) => callback(data);
    ipcRenderer.on('first-setup:download-progress', fn);
    return () => ipcRenderer.removeListener('first-setup:download-progress', fn);
  }
});
