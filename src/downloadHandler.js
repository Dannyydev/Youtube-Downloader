const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');
const { processAudioChannels } = require('./audioProcessor'); // Importez le nouveau module

class DownloadHandler {

  constructor(url, folder, window, options = {}) {

    this.url = url;
    this.folder = folder;
    this.window = window;
    this.options = options;

    const resourcePath = app.isPackaged
      ? path.join(process.resourcesPath, 'bin')
      : path.join(__dirname, '..', 'bin');

    const ytDlpBinary = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    const ffmpegBinary = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const ffprobeBinary = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';

    this.ytDlpPath = path.join(resourcePath, ytDlpBinary);
    this.ffmpegPath = path.join(resourcePath, ffmpegBinary);
    this.ffprobePath = path.join(resourcePath, ffprobeBinary);
  }

  sendUpdate(channel, ...args) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, ...args);
    }
  }

  async start() {

    try {

      this.sendUpdate('status', "Préparation en cours...", '#0984e3');

      const info = await this.runCommand(this.ytDlpPath, [
        this.url,
        '--dump-single-json',
        '--flat-playlist'
      ]);

      const data = JSON.parse(info);

      const isPlaylist = data._type === 'playlist';
      const entries = isPlaylist ? (data.entries || []) : [data];
      const total = entries.length;

      if (total === 0) throw new Error("Aucune vidéo trouvée.");

      const message = total > 1
        ? `Playlist de ${total} vidéos trouvée.`
        : 'Vidéo trouvée.';

      this.sendUpdate('status', message, '#0984e3');

      let completed = 0;
      const errors = [];

      const CONCURRENCY_LIMIT = 8;
      const chunks = [];

      for (let i = 0; i < total; i += CONCURRENCY_LIMIT) {
        chunks.push(entries.slice(i, i + CONCURRENCY_LIMIT));
      }

      this.sendUpdate('progress', 0, 0, total);

      let currentIndex = 1;

      for (const chunk of chunks) {

        const promises = chunk.map((entry, idx) => {

          const index = currentIndex + idx;

          return this.processItem(index, isPlaylist, entry, data.title)
            .then(() => {

              completed++;

              const percent = (completed / total) * 100;

              this.sendUpdate('progress', percent, completed, total);

            })
            .catch(err => {

              console.error(err);
              errors.push(err.message);

            });

        });

        await Promise.allSettled(promises);

        currentIndex += chunk.length;

      }

      if (errors.length === 0) {
        this.sendUpdate('complete', { isPlaylist: total > 1, total });
      } else {
        this.sendUpdate('error', `${errors.length} échecs. Premier: ${errors[0]}`);
      }

    } catch (e) {

      console.error(e);
      this.sendUpdate('error', `Erreur: ${e.message}`);

    } finally {

      this.sendUpdate('finish');

    }

  }

  async processItem(index, isPlaylist, entry, playlistTitle) {
    const rawAudioTemplate = path.join(
      this.folder,
      `${String(index).padStart(3, '0')}_%(title)s.%(ext)s`
    );

    // On utilise l'URL directe de la vidéo (via son ID) pour isoler les métadonnées
    const videoUrl = (isPlaylist && entry && entry.id)
      ? `https://www.youtube.com/watch?v=${entry.id}`
      : this.url;

    const prefix = `${String(index).padStart(3, '0')}_`;
    let finalDest = "";

    const ytDlpArgs = [
      videoUrl,
      '--ffmpeg-location', this.ffmpegPath,
      '-f', 'bestaudio/best',
      '-x',
      '--keep-video',
      '--write-thumbnail',
      '--convert-thumbnails', 'jpg',
      '--parse-metadata', 'playlist_title:%(album)s',
      '--write-info-json',
      '-o', rawAudioTemplate
    ];

    try {
      // 1. Téléchargement
      await this.runCommand(this.ytDlpPath, ytDlpArgs);

      const files = await fs.readdir(this.folder);

      // Identification précise du fichier audio brut (on exclut les métadonnées JSON et les images)
      const rawAudioFile = files.find(f => f.startsWith(prefix) && !f.endsWith('.mp3') && !f.endsWith('.json') && !['.jpg', '.webp', '.png'].some(ext => f.endsWith(ext)));
      const infoJsonFile = files.find(f => f.startsWith(prefix) && f.endsWith('.info.json'));
      const thumbFile = files.find(f => f.startsWith(prefix) && (f.endsWith('.jpg') || f.endsWith('.webp') || f.endsWith('.png')));

      if (!rawAudioFile) throw new Error(`Fichier audio non trouvé pour ${videoUrl}`);

      // 1.1 Métadonnées
      let metadata = {};
      if (infoJsonFile) {
        try {
          const content = await fs.readFile(path.join(this.folder, infoJsonFile), 'utf8');
          const info = JSON.parse(content);
          const fullMetadata = {
            title: info.title || '',
            artist: info.uploader || info.channel || info.webpage_url_domain || '',
            date: info.upload_date ? info.upload_date.substring(0, 4) : '',
            album: info.playlist_title || playlistTitle || '',
            track: info.playlist_index || index
          };

          // Filtrage selon les options choisies par l'utilisateur
          if (this.options.title) metadata.title = fullMetadata.title;
          if (this.options.artist) metadata.artist = fullMetadata.artist;
          if (this.options.date) metadata.date = fullMetadata.date;
          if (this.options.album) metadata.album = fullMetadata.album;
          if (this.options.track) metadata.track = fullMetadata.track;

        } catch (err) { console.error("Metadata error:", err); }
      }

      const fullRawPath = path.join(this.folder, rawAudioFile);
      const mp3BaseName = path.basename(rawAudioFile, path.extname(rawAudioFile));
      const fullMp3Path = path.join(this.folder, `${mp3BaseName}.mp3`);

      // 2. Conversion MP3 + Canaux + Métadonnées
      await processAudioChannels(fullRawPath, fullMp3Path, metadata, {
        ffmpegPath: this.ffmpegPath,
        ffprobePath: this.ffprobePath
      });

      // 3. Intégration Miniature (support JPG et WEBP)
      if (thumbFile && this.options.thumbnail !== false) {
        const fullThumbPath = path.join(this.folder, thumbFile);
        const tempMp3Path = path.join(this.folder, `${mp3BaseName}_temp.mp3`);

        // Correction : Échappement des virgules pour FFmpeg (\\,) et ajout du codec vidéo (mjpeg) car on filtre
        await this.runCommand(this.ffmpegPath, [
          '-y', '-i', fullMp3Path, '-i', fullThumbPath,
          '-filter_complex', '[1:v]crop=min(iw\\,ih):min(iw\\,ih):(iw-min(iw\\,ih))/2:(ih-min(iw\\,ih))/2[v]',
          '-map', '0:a', '-map', '[v]',
          '-c:a', 'copy', '-c:v', 'mjpeg', '-id3v2_version', '3',
          '-metadata:s:v', 'title=Album cover', '-disposition:v:0', 'attached_pic',
          tempMp3Path
        ]);
        await fs.rename(tempMp3Path, fullMp3Path);
      }

      // 4. Renommage final sans le préfixe
      const finalName = mp3BaseName.substring(prefix.length) + '.mp3';
      finalDest = path.join(this.folder, finalName);
      if (fullMp3Path !== finalDest) await fs.rename(fullMp3Path, finalDest);

      return true;
    } finally {
      // 5. NETTOYAGE ABSOLU : On supprime TOUT ce qui commence par le préfixe (sauf le résultat final)
      try {
        const remaining = await fs.readdir(this.folder);
        for (const file of remaining) {
          const fullPath = path.join(this.folder, file);
          if (file.startsWith(prefix) && fullPath !== finalDest) {
            await this.safeUnlink(fullPath);
          }
        }
      } catch (e) { console.error("Cleanup error:", e); }
    }
  }

  async safeUnlink(filePath) {

    await fs.unlink(filePath).catch(() => { });

  }

  runCommand(command, args) {

    return new Promise((resolve, reject) => {

      console.log(`[Exec] Running: ${command} ${args.join(' ')}`);
      execFile(
        command,
        args,
        {
          maxBuffer: 1024 * 1024 * 10,
          windowsHide: true
        },
        (error, stdout, stderr) => {

          if (error) {
            reject(new Error(stderr || stdout || error.message));
            return;
          }

          resolve(stdout);

        }
      );

    });

  }

}

module.exports = DownloadHandler;