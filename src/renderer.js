const urlInput = document.getElementById('urlInput');
const pasteBtn = document.getElementById('pasteBtn');
const downloadBtn = document.getElementById('downloadBtn');
const progressBar = document.getElementById('progressBar');
const statusLabel = document.getElementById('statusLabel');
const previewCard = document.getElementById('previewCard');
const previewThumb = document.getElementById('previewThumb');
const previewTitle = document.getElementById('previewTitle');
const previewMeta = document.getElementById('previewMeta');

let debounceTimer; // Timer pour éviter trop de requêtes

function updateStatus(text, type) {
    statusLabel.textContent = text;
    statusLabel.className = ''; // Réinitialise les classes
    if (type) {
        statusLabel.classList.add(type);
    }
}

// Fonctionnalité du bouton Coller
pasteBtn.addEventListener('click', async () => {
    try {
        const text = await navigator.clipboard.readText();
        urlInput.value = text;
        // On déclenche l'événement input manuellement pour les futures écoutes
        urlInput.dispatchEvent(new Event('input'));
    } catch (err) {
        console.error('Impossible de lire le presse-papier', err);
    }
});

// Détection de la frappe pour la prévisualisation (Debounce)
urlInput.addEventListener('input', () => {
    const url = urlInput.value.trim();
    
    // On nettoie l'ancien timer si l'utilisateur continue d'écrire
    clearTimeout(debounceTimer);

    // Si le champ est vide, on cache la preview
    if (!url) {
        previewCard.style.display = 'none';
        return;
    }

    // On attend 300ms après la dernière frappe pour être réactif
    debounceTimer = setTimeout(async () => {
        const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
        
        if (youtubeRegex.test(url)) {
            // Affichage état chargement
            previewCard.style.display = 'flex';
            previewTitle.textContent = "Recherche des infos...";
            previewMeta.textContent = "Veuillez patienter...";
            previewThumb.src = ""; // Ou une image placeholder
            previewThumb.style.opacity = "0.5";

            try {
                const info = await window.api.getVideoInfo(url);
                
                previewTitle.textContent = info.title;
                if (info.isPlaylist) {
                    // Pour les playlists : juste le nombre de titres, propre et simple.
                    previewMeta.textContent = `${info.count} titres`;
                } else {
                    previewMeta.textContent = `${info.uploader} • ${info.duration}`;
                }
                previewThumb.src = info.thumbnail;
                previewThumb.style.opacity = "1";
                
            } catch (err) {
                // Si erreur (ex: vidéo privée ou URL invalide), on affiche un message
                previewTitle.textContent = "Vidéo non trouvée";
                previewMeta.textContent = "Vérifiez le lien ou la visibilité de la vidéo.";
                previewThumb.style.opacity = "0.5";
            }
        }
    }, 300);
});

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

// Gestion de l'affichage des mises à jour
window.api.onUpdateMsg((text, type) => {
    updateStatus(text, type);
});
