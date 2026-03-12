const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  startDownload: (data) => ipcRenderer.send('start-download', data),
  onStatus: (callback) => ipcRenderer.on('status', (_, text, color) => callback(text, color)),
  onProgress: (callback) => ipcRenderer.on('progress', (_, p, c, t) => callback(p, c, t)),
  onComplete: (callback) => ipcRenderer.on('complete', (_, result) => callback(result)),
  onError: (callback) => ipcRenderer.on('error', (_, msg) => callback(msg)),
  onFinish: (callback) => ipcRenderer.on('finish', (_) => callback())
});
