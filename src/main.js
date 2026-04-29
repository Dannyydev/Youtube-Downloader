const { app, BrowserWindow, ipcMain, dialog, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const { execFile } = require('child_process');
const path = require('path');
const DownloadHandler = require('./downloadHandler');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 700,
    minWidth: 320, // Conserve la largeur minimale actuelle
    minHeight: 380, // Augmente la hauteur minimale pour accommoder le contenu et le padding
    backgroundColor: '#f8f9fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Gestion des mises à jour automatiques
  if (app.isPackaged) {
    // Vérifier les mises à jour immédiatement au lancement
    autoUpdater.checkForUpdatesAndNotify();
  }
}

// Initialisation des événements d'update en dehors de createWindow pour éviter les doublons
if (app.isPackaged) {
  const sendUpdateMsg = (text, type) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-msg', text, type);
    }
  };

  autoUpdater.on('checking-for-update', () => sendUpdateMsg('🔍 Recherche de mises à jour...', 'info'));
  autoUpdater.on('update-available', (info) => {
    sendUpdateMsg('🎉 Mise à jour trouvée ! Téléchargement en cours...', 'info');
    new Notification({
      title: 'Mise à jour disponible',
      body: `La version ${info.version} est en cours de téléchargement.`
    }).show();
  });
  autoUpdater.on('update-not-available', () => { }); // Silence radio
  autoUpdater.on('error', (err) => {
    const errorMessage = 'Erreur de mise à jour : ' + (err.message || 'Raison inconnue');
    sendUpdateMsg(`❌ ${errorMessage}`, 'error');
    new Notification({
      title: 'Erreur de mise à jour',
      body: errorMessage
    }).show();
  });
  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateMsg('✅ Mise à jour prête ! Cliquez sur la notification pour redémarrer.', 'success');
    const notif = new Notification({
      title: 'Mise à jour prête à être installée',
      body: `La version ${info.version} est téléchargée. Cliquez pour redémarrer et installer.`,
    });
    notif.on('click', () => autoUpdater.quitAndInstall());
    notif.show();
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Gestionnaires IPC (Communication Front <-> Back)
ipcMain.handle('select-folder', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
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

  // Gestion extension selon l'OS
  const binaryName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const ytDlpPath = path.join(resourcePath, binaryName);

  return new Promise((resolve, reject) => {
    // --- FAST PATH: Tentative via oEmbed (YouTube API publique) ---
    // C'est beaucoup plus rapide (ms) que de lancer un exécutable (sec).
    // On vérifie que fetch est disponible (Node 18+ / Electron récent)
    if ((url.includes('youtube.com') || url.includes('youtu.be')) && typeof fetch !== 'undefined') {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;

      fetch(oembedUrl)
        .then(res => {
          if (!res.ok) throw new Error('oEmbed failed');
          return res.json();
        })
        .then(data => {
          const isPlaylist = url.includes('list=');

          // Si c'est une playlist mais que oEmbed ne donne pas de miniature (fréquent sur les Mix),
          // on lève une erreur pour passer au "Slow Path" (yt-dlp) qui ira chercher l'image de la 1ère vidéo.
          if (isPlaylist && !data.thumbnail_url) throw new Error('Playlist sans miniature');

          resolve({
            isPlaylist: isPlaylist,
            title: data.title,
            thumbnail: data.thumbnail_url,
            uploader: data.author_name,
            // oEmbed ne donne pas la durée/nombre exact, mais c'est le prix de la vitesse
            count: isPlaylist ? null : 0,
            duration: null
          });
        })
        .catch(() => {
          // Si oEmbed échoue (ex: vidéo privée ou autre site), on continue vers yt-dlp (slow path)
          runYtDlp();
        });
    } else {
      runYtDlp();
    }

    function runYtDlp() {
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
              thumbnail: data.thumbnail || (data.thumbnails && data.thumbnails.length ? data.thumbnails[data.thumbnails.length - 1].url : null) || (data.entries && data.entries.length ? data.entries[0].thumbnail : null),
              uploader: data.uploader || data.channel || '',
              count: data.entries ? data.entries.length : 0
            });
          } else {
            resolve({
              isPlaylist: false,
              title: data.title,
              thumbnail: data.thumbnail,
              uploader: data.uploader || data.channel || '',
              duration: data.duration_string || '--:--'
            });
          }
        } catch (e) {
          // Si le JSON est invalide ou incomplet
          console.error("JSON Parse error:", e, stdout);
          reject("Erreur de lecture des données de la vidéo (Format invalide).");
        }
      });
    }
  });
});

ipcMain.on('start-download', (event, { url, folder, options }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const handler = new DownloadHandler(url, folder, mainWindow, options);
  handler.start();
});

// Pour appliquer la mise à jour si l'utilisateur le demande (optionnel, sinon ça se fait au prochain lancement)
ipcMain.on('restart-app', () => {
  autoUpdater.quitAndInstall();
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});
