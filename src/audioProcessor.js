const { execFile } = require('child_process');
const util = require('util');
const path = require('path'); // Importation du module 'path'
const execFilePromise = util.promisify(execFile);

/**
 * Gère la conversion audio intelligente.
 * Détecte le nombre de canaux et applique une spatialisation si nécessaire.
 */
async function processAudioChannels(inputPath, outputPath, metadata = {}, binPaths = {}) {
    const ffmpegPath = binPaths.ffmpegPath || 'ffmpeg';
    const ffprobePath = binPaths.ffprobePath || 'ffprobe';

    console.log(`[Audio] Début du traitement : ${path.basename(inputPath)}`);

    try {
        // 1. Détection du nombre de canaux via ffprobe
        const { stdout } = await execFilePromise(ffprobePath, [
            '-v', 'error',
            '-select_streams', 'a:0',
            '-show_entries', 'stream=channels',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            inputPath
        ]);
        const channels = parseInt(stdout.trim());

        const ffmpegArgs = ['-i', inputPath];

        if (channels > 2) {
            ffmpegArgs.push('-af', 'pan=stereo|c0=FL+0.707*FC+0.707*BL|c1=FR+0.707*FC+0.707*BR');
            console.log(`[Audio] Source multicanal détectée (${channels} canaux). Application du downmix spatialisé.`);
        } else if (channels === 1) {
            ffmpegArgs.push('-ac', '1');
            console.log(`[Audio] Source mono détectée (${inputPath}).`);
        } else {
            ffmpegArgs.push('-ac', '2');
            console.log(`[Audio] Source stéréo détectée (${inputPath}).`);
        }

        // Ajout des métadonnées ID3
        if (metadata.title) ffmpegArgs.push('-metadata', `title=${metadata.title}`);
        if (metadata.artist) {
            ffmpegArgs.push('-metadata', `artist=${metadata.artist}`);
            // On force la suppression des champs "Interprète" / "Artiste de l'album"
            ffmpegArgs.push('-metadata', 'album_artist=', '-metadata', 'performer=');
        }
        if (metadata.date) ffmpegArgs.push('-metadata', `date=${metadata.date}`);
        if (metadata.album) ffmpegArgs.push('-metadata', `album=${metadata.album}`);
        if (metadata.track) ffmpegArgs.push('-metadata', `track=${metadata.track}`);

        /**
         * Encodage MP3 final :
         * - libmp3lame : Encodeur de référence.
         * - qscale:a 0 : Meilleure qualité variable (VBR).
         */
        ffmpegArgs.push('-codec:a', 'libmp3lame', '-qscale:a', '0', '-y', outputPath);

        await execFilePromise(ffmpegPath, ffmpegArgs);
        return true;
    } catch (error) {
        console.error('Erreur lors du traitement audio :', error);
        throw error;
    }
}

module.exports = { processAudioChannels };