const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');

class DownloadHandler {

  constructor(url, folder, window) {

    this.url = url;
    this.folder = folder;
    this.window = window;

    const resourcePath = app.isPackaged
      ? path.join(process.resourcesPath, 'bin')
      : path.join(__dirname, '..', 'bin');

    this.ytDlpPath = path.join(resourcePath, 'yt-dlp.exe');
    this.ffmpegPath = path.join(resourcePath, 'ffmpeg.exe');
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
      let errors = [];

      const CONCURRENCY_LIMIT = 5;
      const chunks = [];

      for (let i = 0; i < total; i += CONCURRENCY_LIMIT) {
        chunks.push(entries.slice(i, i + CONCURRENCY_LIMIT));
      }

      this.sendUpdate('progress', 0, 0, total);

      let currentIndex = 1;

      for (const chunk of chunks) {

        const promises = chunk.map((entry, idx) => {

          const index = currentIndex + idx;

          return this.processItem(index, isPlaylist)
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

        await Promise.all(promises);

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

  async processItem(index, isPlaylist) {

    const template = path.join(
      this.folder,
      `${String(index).padStart(3, '0')}_%(title)s.%(ext)s`
    );

    const args = [

      this.url,

      '--ffmpeg-location', this.ffmpegPath,

      '-f', 'bestaudio/best',

      '-x',

      '--audio-format', 'mp3',

      '--audio-quality', '0',

      '--write-thumbnail',

      '--embed-thumbnail',

      '--embed-metadata',

      '--convert-thumbnails', 'jpg',

      '--parse-metadata', 'playlist_title:%(album)s',

      '-o', template

    ];

    if (isPlaylist) {

      args.push('--playlist-items', String(index));
      args.push('--parse-metadata', 'playlist_index:%(track_number)s');

    }

    await this.runCommand(this.ytDlpPath, args);

    await new Promise(r => setTimeout(r, 300));

    const files = await fs.readdir(this.folder);

    const prefix = `${String(index).padStart(3, '0')}_`;

    const audioFilename = files.find(f =>
      f.startsWith(prefix) && f.toLowerCase().endsWith('.mp3')
    );

    if (!audioFilename) {
      throw new Error(`Fichier audio non trouvé pour ${index}`);
    }

    const fullAudioPath = path.join(this.folder, audioFilename);

    const thumbFilename = files.find(f =>
      f.startsWith(prefix) && f.toLowerCase().endsWith('.jpg')
    );

    if (thumbFilename) {

      const fullThumbPath = path.join(this.folder, thumbFilename);

      const baseName = path.join(
        this.folder,
        path.basename(audioFilename, '.mp3')
      );

      const croppedThumbPath = `${baseName}_square.jpg`;

      const tempMp3Path = `${baseName}_temp.mp3`;

      try {

        await this.runCommand(this.ffmpegPath, [
          '-y',
          '-i', fullThumbPath,
          '-vf', 'crop=min(iw\\,ih):min(iw\\,ih):(iw-min(iw\\,ih))/2:(ih-min(iw\\,ih))/2',
          croppedThumbPath
        ]);

        await this.runCommand(this.ffmpegPath, [

          '-y',

          '-i', fullAudioPath,

          '-i', croppedThumbPath,

          '-map', '0:a',

          '-map', '1',

          '-c', 'copy',

          '-id3v2_version', '3',

          '-metadata:s:v', 'title=Album cover',

          '-metadata:s:v', 'comment=Cover (front)',

          '-disposition:v:0', 'attached_pic',

          tempMp3Path

        ]);

        await fs.rename(tempMp3Path, fullAudioPath);

      } finally {

        await this.cleanThumbnails(prefix);

      }

    }

    const finalFilename = audioFilename.substring(prefix.length);

    const finalDest = path.join(this.folder, finalFilename);

    if (fullAudioPath !== finalDest) {
      await fs.rename(fullAudioPath, finalDest);
    }

    return true;

  }

  async cleanThumbnails(prefix) {

    const files = await fs.readdir(this.folder);

    const thumbs = files.filter(f =>
      f.startsWith(prefix) &&
      (
        f.endsWith('.jpg') ||
        f.endsWith('.jpeg') ||
        f.endsWith('.png') ||
        f.endsWith('.webp')
      )
    );

    for (const file of thumbs) {
      await this.safeUnlink(path.join(this.folder, file));
    }

  }

  async safeUnlink(filePath) {

    await fs.unlink(filePath)
      .catch(() => {});

  }

  runCommand(command, args) {

    return new Promise((resolve, reject) => {

      execFile(
        command,
        args,
        { maxBuffer: 1024 * 1024 * 10 },
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