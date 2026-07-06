const { app, BrowserWindow, ipcMain, dialog, Notification, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { execFile } = require('child_process');
const path = require('path');
const os = require('os');
const fsMain = require('fs');
const crypto = require('crypto');
const DownloadHandler = require('./downloadHandler');

let mainWindow;
let autoUpdatesDisabled = false; // New: Global variable to store user preference for auto-updates

function getMachineId() {
  const idPath = path.join(app.getPath('userData'), 'machine-id.txt');
  try {
    if (fsMain.existsSync(idPath)) {
      return fsMain.readFileSync(idPath, 'utf8').trim();
    }
  } catch (e) { }

  const newId = crypto.randomUUID();
  try {
    fsMain.writeFileSync(idPath, newId, 'utf8');
  } catch (e) { }
  return newId;
}

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

  // Gestion des mises à jour automatiques différée (attente de la préférence utilisateur)
}

// Initialisation des événements d'update en dehors de createWindow pour éviter les doublons
if (app.isPackaged) {
  const sendUpdateMsg = (text, type) => {
    if (mainWindow && !mainWindow.isDestroyed() && !autoUpdatesDisabled) { // Only send if not disabled
      mainWindow.webContents.send('update-msg', text, type);
    }
  };

  autoUpdater.on('checking-for-update', () => { if (!autoUpdatesDisabled) sendUpdateMsg('Reherche des mises à jour...', 'info'); });

  autoUpdater.on('update-available', (info) => {
    if (!autoUpdatesDisabled) sendUpdateMsg(`Audivex (v${info.version}) est disponible et en cours de téléchargement`, 'info');
  });

  autoUpdater.on('error', (err) => {
    if (!autoUpdatesDisabled) { // Only log and notify if auto-updates are not disabled
      console.error('Update error:', err);
      sendUpdateMsg('Erreur lors de mise à jour. Vérifiez votre connexion et réessayez (Code 1)', 'error');
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    if (!autoUpdatesDisabled) {
      sendUpdateMsg('Mise à jour téléchargée. Redémarrez l\'application pour l\'appliquer.', 'success');
    }
    const notif = new Notification({
      title: `v${info.version}`,
      body: `Cliquez ici pour mettre à jour`,
    });
    notif.on('click', () => autoUpdater.quitAndInstall());
    notif.show();
  });
}

/** Système de télémétrie discret */
async function sendTelemetry() {
  try {
    const stats = {
      userId: getMachineId(),           // Identifiant unique anonyme

      version: app.getVersion(),        // Version d'Audivex
      platform: process.platform,       // win32, etc.
      date: new Date().toISOString()
    };

    // Remplace l'URL ci-dessous par l'URL que tu as copiée de Google Apps Script
    await fetch('https://script.google.com/macros/s/AKfycbyBkDwkbhzEfLVdW7IirrpKK9RbkliIe1YcFilE3yi4e-BeMjc7rO_wIs1Mm8eWNf7eLw/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stats),
      signal: AbortSignal.timeout(5000)
    });
  } catch (e) {
    // On échoue silencieusement pour ne pas gêner l'utilisateur si pas d'internet
  }
}

/** Envoi du compteur de musiques téléchargées au Google Sheet */
async function sendDownloadStats(downloadCount) {
  try {
    const stats = {
      userId: getMachineId(),            // Identifiant unique anonyme
      downloadCount: downloadCount,      // Nombre de musiques téléchargées
      date: new Date().toISOString(),
      type: 'download'
    };

    await fetch('https://script.google.com/macros/s/AKfycbx7qwYneeW6y-s_MNXALkbZRlb5m-qq8AgI2_ZgYvygFK4G_gjcXuQ2q2boMRpc34s3eg/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stats),
      signal: AbortSignal.timeout(5000)
    });
  } catch (e) {
    // On échoue silencieusement pour ne pas gêner l'utilisateur si pas d'internet
  }
}

app.whenReady().then(() => {
  createWindow();
  sendTelemetry();
});

// New: IPC handler to receive auto update preference from renderer
ipcMain.on('set-auto-update-preference', (event, isDisabled) => {
  autoUpdatesDisabled = isDisabled;
  if (!isDisabled && app.isPackaged) {
    autoUpdater.checkForUpdates();
  }
});

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

// Gestionnaire pour ouvrir les liens externes
ipcMain.on('open-external', (event, url) => {
  shell.openExternal(url);
});

/** Helper for yt-dlp metadata extraction */
async function getMetadataViaYtDlp(url) {
  const resourcePath = app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(__dirname, '..', 'bin');
  const binaryName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const ytDlpPath = path.join(resourcePath, binaryName);

  const args = [url, '--dump-single-json', '--flat-playlist', '--no-warnings'];

  return new Promise((resolve, reject) => {
    execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
      if (error) return reject(stderr || error.message);
      try {
        const data = JSON.parse(stdout);
        const isPlaylist = data._type === 'playlist';
        resolve({
          isPlaylist,
          title: data.title,
          thumbnail: isPlaylist
            ? (data.thumbnail || data.thumbnails?.slice(-1)[0]?.url || data.entries?.[0]?.thumbnail)
            : data.thumbnail,
          uploader: data.uploader || data.channel || '',
          count: data.entries?.length || 0,
          duration: data.duration_string || '--:--'
        });
      } catch (e) { reject("Format de données invalide"); }
    });
  });
}

// Récupération des métadonnées (Prévisualisation)
ipcMain.handle('get-video-info', async (event, url) => {
  // --- FAST PATH: Tentative via oEmbed (YouTube API publique) ---
  if ((url.includes('youtube.com') || url.includes('youtu.be'))) {
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const res = await fetch(oembedUrl);
      if (!res.ok) throw new Error();

      const data = await res.json();
      const isPlaylist = url.includes('list=');

      // Fallback vers yt-dlp si oEmbed manque de miniatures pour les playlists
      if (isPlaylist && !data.thumbnail_url) throw new Error();

      return {
        isPlaylist,
        title: data.title,
        thumbnail: data.thumbnail_url,
        uploader: data.author_name,
        count: isPlaylist ? null : 0,
        duration: null
      };
    } catch {
      // Silence error, continue to slow path
    }
  }

  // --- SLOW PATH: yt-dlp ---
  try {
    return await getMetadataViaYtDlp(url);
  } catch (err) {
    console.error("Metadata extraction failed:", err);
    throw new Error("Impossible de récupérer les informations de la vidéo.");
  }
});

ipcMain.on('start-download', (event, { url, folder, options }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  // On passe null pour onComplete et on utilise le nouveau callback onItemSuccess
  const handler = new DownloadHandler(url, folder, mainWindow, options, null, () => {
    sendDownloadStats(1); // Envoi +1 en temps réel à chaque succès
  });

  handler.start();
});

// Pour appliquer la mise à jour si l'utilisateur le demande (optionnel, sinon ça se fait au prochain lancement)
ipcMain.on('restart-app', () => {
  if (app.isPackaged) {
    autoUpdater.quitAndInstall();
  }
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// New: Expose setAutoUpdatePreference to renderer via preload.js
// This is a duplicate of the ipcMain.on above, but it's good practice to have
// a handle for renderer to call if it needs to explicitly set the state,
// rather than just sending a message. However, for a simple toggle, ipcRenderer.send
// is sufficient. I'll keep the ipcMain.on and remove this handle to avoid redundancy.
// The ipcMain.on('set-auto-update-preference') is sufficient.
// The preload.js will expose ipcRenderer.send('set-auto-update-preference', isDisabled).
// No further changes needed here.
