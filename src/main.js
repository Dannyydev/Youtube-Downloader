const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const DownloadHandler = require('./downloadHandler');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 700,
    minWidth: 520,
    minHeight: 420,
    backgroundColor: '#f8f9fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Gestionnaires IPC (Communication Front <-> Back)
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return result.filePaths[0];
});

ipcMain.on('start-download', (event, { url, folder }) => {
  const handler = new DownloadHandler(url, folder, mainWindow);
  handler.start();
});
