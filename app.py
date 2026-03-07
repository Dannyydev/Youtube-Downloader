# YouTube Downloader - MP3 + PLAYLISTS - STABLE 2026
import os
import sys
import subprocess
import threading
import ctypes
import re
import tkinter as tk
from tkinter import ttk, filedialog, messagebox

# =========================
# BASE PATH (PyInstaller OK)
# =========================
if getattr(sys, 'frozen', False):
    BASE_PATH = sys._MEIPASS
else:
    BASE_PATH = os.path.dirname(os.path.abspath(__file__))

# =========================
# WINDOWS APP ID
# =========================
try:
    ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(
        "YouTubeDownloader.Danny.MP3.Playlists.2026"
    )
except:
    pass

# =========================
# TKINTER WINDOW
# =========================
root = tk.Tk()
root.title("YouTube Downloader — MP3 / Playlists")
root.geometry("960x700")
root.minsize(520, 420)
root.configure(bg="#f0f2f5")

root.bind("<F11>", lambda e: root.attributes("-fullscreen", not root.attributes("-fullscreen")))
root.bind("<Escape>", lambda e: root.attributes("-fullscreen", False))

# =========================
# STYLE
# =========================
style = ttk.Style()
style.theme_use("clam")
style.configure(
    "TProgressbar",
    thickness=26,
    background="#27ae60",
    troughcolor="#ecf0f1"
)

# =========================
# LAYOUT
# =========================
main = tk.Frame(root, bg="#f0f2f5", padx=30, pady=25)
main.pack(fill="both", expand=True)
main.columnconfigure(0, weight=1)

# =========================
# TITLE
# =========================
tk.Label(
    main,
    text="YouTube Downloader",
    font=("Segoe UI", 26, "bold"),
    bg="#f0f2f5",
    fg="#2c3e50"
).grid(row=0, column=0, pady=(10, 25), sticky="ew")

# =========================
# URL INPUT
# =========================
tk.Label(
    main,
    text="URL YouTube (vidéo ou playlist)",
    font=("Segoe UI", 12, "bold"),
    bg="#f0f2f5",
    fg="#34495e"
).grid(row=1, column=0, sticky="w")

url_entry = tk.Text(
    main,
    height=3,
    font=("Segoe UI", 11),
    wrap="word",
    relief="flat",
    highlightthickness=2,
    highlightbackground="#bdc3c7",
    highlightcolor="#3498db"
)
url_entry.grid(row=2, column=0, sticky="ew", pady=(6, 20))
url_entry.insert("1.0", "https://www.youtube.com/")

# =========================
# INFO
# =========================
tk.Label(
    main,
    text="MP3 haute qualité • Playlists complètes • Pochette intégrée",
    font=("Segoe UI", 12, "bold"),
    bg="#f0f2f5",
    fg="#34495e"
).grid(row=3, column=0, pady=(0, 20))

# =========================
# BUTTON
# =========================
download_btn = tk.Button(
    main,
    text="TÉLÉCHARGER MP3",
    bg="#27ae60",
    fg="white",
    font=("Segoe UI", 15, "bold"),
    relief="flat",
    cursor="hand2",
    activebackground="#2ecc71",
    padx=60,
    pady=14
)
download_btn.grid(row=4, column=0, pady=20)

# =========================
# PROGRESS
# =========================
percent_label = tk.Label(
    main,
    text="0%",
    font=("Segoe UI", 22, "bold"),
    bg="#f0f2f5",
    fg="#2c3e50"
)
percent_label.grid(row=5, column=0, pady=(10, 5))

progress_bar = ttk.Progressbar(main, mode="determinate", maximum=100)
progress_bar.grid(row=6, column=0, sticky="ew", pady=10)

status_label = tk.Label(
    main,
    text="Prêt",
    font=("Segoe UI", 13),
    bg="#f0f2f5",
    fg="#7f8c8d"
)
status_label.grid(row=7, column=0, pady=10)

# =========================
# DOWNLOAD LOGIC
# =========================
def download_mp3():
    url = url_entry.get("1.0", "end").strip()

    if not url or ("youtube.com" not in url and "youtu.be" not in url):
        messagebox.showerror("Erreur", "URL YouTube invalide.")
        return

    folder = filedialog.askdirectory(title="Choisir le dossier de destination")
    if not folder:
        return

    ytdlp = os.path.join(BASE_PATH, "yt-dlp.exe")
    ffmpeg = os.path.join(BASE_PATH, "ffmpeg.exe")

    if not os.path.exists(ytdlp) or not os.path.exists(ffmpeg):
        messagebox.showerror(
            "Fichiers manquants",
            "yt-dlp.exe ou ffmpeg.exe introuvable.\n\nPlace-les dans le même dossier que l'application."
        )
        return

    progress_bar["value"] = 0
    percent_label.config(text="0%")
    status_label.config(text="Analyse de l’URL…", fg="#3498db")
    download_btn.config(state="disabled")

    def run():
        os.environ["PATH"] = BASE_PATH + os.pathsep + os.environ.get("PATH", "")

        cmd = [
            ytdlp,
            "--newline",
            "--ffmpeg-location", ffmpeg,
            "-f", "bestaudio/best",
            "-x",
            "--audio-format", "mp3",
            "--audio-quality", "0",
            "--embed-thumbnail",
            "--embed-metadata",
            "--yes-playlist",
            "--extractor-args", "youtube:player_client=auto",
            "--js-runtimes", "deno",
            "-o", os.path.join(
                folder,
                "%(title)s.%(ext)s"
            ),
            url
        ]


        logs = []

        try:
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
            )

            for line in process.stdout:
                logs.append(line)
                line = line.strip()

                match = re.search(r'(\d+(?:\.\d+)?)%', line)
                if match:
                    v = float(match.group(1))
                    root.after(0, lambda v=v: (
                        progress_bar.config(value=v),
                        percent_label.config(text=f"{v:.1f}%")
                    ))

                if "Downloading" in line:
                    root.after(0, lambda: status_label.config(text="Téléchargement…"))
                elif "Extracting" in line or "Converting" in line:
                    root.after(0, lambda: status_label.config(text="Conversion MP3…"))
                elif "Embedding" in line:
                    root.after(0, lambda: status_label.config(text="Ajout pochette…"))

            process.wait()

            if process.returncode == 0:
                root.after(0, lambda: (
                    progress_bar.config(value=100),
                    percent_label.config(text="100%"),
                    status_label.config(text="Téléchargement terminé 🎧", fg="#27ae60")
                ))
            else:
                root.after(0, lambda: messagebox.showerror(
                    "Erreur",
                    "".join(logs[-25:])
                ))

        except Exception as e:
            root.after(0, lambda: messagebox.showerror("Erreur critique", str(e)))

        finally:
            root.after(0, lambda: download_btn.config(state="normal"))

    threading.Thread(target=run, daemon=True).start()

download_btn.config(command=download_mp3)

root.mainloop()
