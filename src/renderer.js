const urlInput = document.getElementById('urlInput');
const downloadBtn = document.getElementById('downloadBtn');
const progressBar = document.getElementById('progressBar');
const statusLabel = document.getElementById('statusLabel');

function updateStatus(text, type) {
    statusLabel.textContent = text;
    statusLabel.className = ''; // Réinitialise les classes
    if (type) {
        statusLabel.classList.add(type);
    }
}

downloadBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    // Regex plus robuste pour valider les URLs YouTube (vidéo et playlist)
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/(watch\?v=|playlist\?list=|embed\/|shorts\/)?[a-zA-Z0-9_-]{11,}/;
    
    if (!url || !youtubeRegex.test(url)) {
        updateStatus("URL invalide.", 'error');
        return;
    }

    const folder = await window.api.selectFolder();
    if (!folder) return;

    downloadBtn.disabled = true;
    progressBar.style.width = '0%';
    window.api.startDownload({ url, folder });
});

window.api.onStatus((text, color) => {
    // Fait correspondre l'ancienne couleur à un nouveau type de statut
    let type = 'info';
    if (color === '#e74c3c') type = 'error';
    else if (color === '#00b894') type = 'success';
    updateStatus(text, type);
});

window.api.onProgress((percent, completed, total) => {
    progressBar.style.width = `${percent}%`;
    updateStatus(`Téléchargé : ${completed}/${total}`, 'info');
});

window.api.onComplete((result) => {
    progressBar.style.width = '100%';
    const text = result.isPlaylist
        ? `Téléchargement de la playlist terminé ! (${result.total} vidéos téléchargées).`
        : "Téléchargement terminé ! 🎧";
    updateStatus(text, 'success');
});

window.api.onError((msg) => {
    updateStatus(msg, 'error');
});

window.api.onFinish(() => {
    downloadBtn.disabled = false;
});
