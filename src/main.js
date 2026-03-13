const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const { execFile } = require('child_process');
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

  // Gestion des mises à jour automatiques
  if (app.isPackaged) {
    
    // Vérifier les mises à jour immédiatement au lancement
    autoUpdater.checkForUpdatesAndNotify();

    // Événements de mise à jour
    autoUpdater.on('checking-for-update', () => {
      mainWindow.webContents.send('update-msg', 'Recherche de mises à jour...', 'info');
    });

    autoUpdater.on('update-available', () => {
      mainWindow.webContents.send('update-msg', 'Mise à jour trouvée, téléchargement en cours...', 'info');
    });

    autoUpdater.on('update-not-available', () => {
      // On ne spam pas l'utilisateur si tout est à jour, ou on peut logger en console
    });

    autoUpdater.on('error', (err) => {
      mainWindow.webContents.send('update-msg', 'Erreur mise à jour : ' + err.message, 'error');
    });

    autoUpdater.on('update-downloaded', () => {
      mainWindow.webContents.send('update-msg', 'Mise à jour prête. Redémarrez pour installer.', 'success');
    });
  }
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

// Récupération des métadonnées (Prévisualisation)
ipcMain.handle('get-video-info', async (event, url) => {
  const resourcePath = app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(__dirname, '..', 'bin');
  
  const ytDlpPath = path.join(resourcePath, 'yt-dlp.exe');

  return new Promise((resolve, reject) => {
    // On utilise --dump-single-json avec --flat-playlist. C'est rapide et donne les infos de la playlist.
    const args = [
      url,
      '--dump-single-json',
      '--flat-playlist',
      '--no-warnings',
      '--extractor-args', 'youtube:skip=dash,hls'
    ];

    execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) {
        reject(stderr || error.message || "Erreur inconnue de yt-dlp");
        return;
      }
      try {
        const data = JSON.parse(stdout);

        if (data._type === 'playlist') {
          resolve({
            isPlaylist: true,
            title: data.title,
            // On sécurise la miniature : si 'thumbnail' est vide, on prend la dernière de la liste 'thumbnails' (souvent la HQ)
            thumbnail: data.thumbnail || (data.thumbnails && data.thumbnails.length ? data.thumbnails[data.thumbnails.length - 1].url : null),
            uploader: data.uploader || data.channel || 'Inconnu',
            count: data.entries ? data.entries.length : 0
          });
        } else {
          // Cas d'une vidéo simple
          resolve({
            isPlaylist: false,
            title: data.title,
            thumbnail: data.thumbnail,
            uploader: data.uploader || data.channel || 'Inconnu',
            duration: data.duration_string || '--:--'
          });
        }
      } catch (e) {
        reject("Erreur de lecture des données de la vidéo.");
      }
    });
  });
});

ipcMain.on('start-download', (event, { url, folder }) => {
  const handler = new DownloadHandler(url, folder, mainWindow);
  handler.start();
});

// Pour appliquer la mise à jour si l'utilisateur le demande (optionnel, sinon ça se fait au prochain lancement)
ipcMain.on('restart-app', () => {
  autoUpdater.quitAndInstall();
});
