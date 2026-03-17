const clipId = window.CLIP_ID;
let clipStart = 0;
let clipEnd = 0;
let clipDuration = 0;
let hlsPlayer = null;
let isDragging = false;

const video = document.getElementById('clipVideo');
const playPauseBtn = document.getElementById('playPauseBtn');
const muteBtn = document.getElementById('muteBtn');
const volumeSlider = document.getElementById('volumeSlider');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressBuffer = document.getElementById('progressBuffer');
const timeDisplay = document.getElementById('timeDisplay');
const bigPlayBtn = document.getElementById('bigPlayBtn');
const videoContainer = document.getElementById('videoContainer');

window.addEventListener('load', async () => {
    try {
        const res = await fetch(`/api/clip/${clipId}/info`);
        if (!res.ok) throw new Error('Clip not found');
        const data = await res.json();

        document.getElementById('clipTitle').innerText = data.name || 'Unbekannter Clip';
        document.getElementById('clipCreator').innerHTML = `<i class="fas fa-user"></i> ${data.creator || 'Unbekannt'}`;

        if (data.created_at) {
            const dateObj = new Date(data.created_at);
            const formatted = dateObj.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            document.getElementById('clipDate').innerHTML = `<i class="fas fa-clock"></i> ${formatted}`;
        }

        clipStart = parseFloat(data.start);
        clipEnd = parseFloat(data.end);
        clipDuration = clipEnd - clipStart;

        document.getElementById('clipContainer').style.display = 'block';
        initPlayer(data);
        setupControls();
    } catch (e) {
        document.getElementById('errorBox').style.display = 'flex';
    }
});

function initPlayer(data) {
    const url = data.video_url;

    if (!url) {
        alert('Video-Quelldatei nicht gefunden.');
        return;
    }

    if (data.video_type === 'mp4') {
        video.src = url;
        video.currentTime = clipStart;
        attemptPlay();
    } else {
        if (window.Hls && Hls.isSupported()) {
            hlsPlayer = new Hls({ startPosition: clipStart });
            hlsPlayer.loadSource(url);
            hlsPlayer.attachMedia(video);
            hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
                attemptPlay();
            });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
            video.addEventListener('loadedmetadata', () => {
                video.currentTime = clipStart;
                attemptPlay();
            });
        }
    }
}

function attemptPlay() {
    const playPromise = video.play();
    if (playPromise !== undefined) {
        playPromise.then(() => {
            bigPlayBtn.style.display = 'none';
            updatePlayPauseIcon();
        }).catch(() => {
            bigPlayBtn.style.display = 'flex';
            updatePlayPauseIcon();
        });
    }
}

function formatTime(seconds) {
    seconds = Math.max(0, seconds);
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

function updateProgressFromEvent(e) {
    const rect = progressContainer.getBoundingClientRect();
    let pos = (e.clientX - rect.left) / rect.width;
    if (pos < 0) pos = 0;
    if (pos > 1) pos = 1;

    let newTime = clipStart + (pos * clipDuration);
    video.currentTime = newTime;

    progressBar.style.width = `${pos * 100}%`;
    const dot = document.getElementById('progressDot');
    if (dot) dot.style.left = `${pos * 100}%`;

    let currentRelTime = newTime - clipStart;
    if (currentRelTime < 0) currentRelTime = 0;
    timeDisplay.innerText = `${formatTime(currentRelTime)} / ${formatTime(clipDuration)}`;
}

function setupControls() {
    timeDisplay.innerText = `0:00 / ${formatTime(clipDuration)}`;

    video.addEventListener('timeupdate', () => {
        if (isDragging) return;
        let currentRelTime = video.currentTime - clipStart;

        if (video.currentTime >= clipEnd) {
            video.currentTime = clipStart;
            currentRelTime = 0;
            video.play().catch(() => { });
        }

        if (currentRelTime < 0) currentRelTime = 0;

        let percent = (currentRelTime / clipDuration) * 100;
        if (percent > 100) percent = 100;
        if (percent < 0) percent = 0;

        progressBar.style.width = `${percent}%`;
        const dot = document.getElementById('progressDot');
        if (dot) dot.style.left = `${percent}%`;

        timeDisplay.innerText = `${formatTime(currentRelTime)} / ${formatTime(clipDuration)}`;
    });

    video.addEventListener('progress', () => {
        if (!clipDuration || clipDuration === 0) return;
        if (video.buffered.length > 0) {
            const bufferedEnd = video.buffered.end(video.buffered.length - 1);
            const bufferedStart = Math.max(clipStart, 0);
            const bufferedWithinClip = Math.min(bufferedEnd, clipEnd) - bufferedStart;
            const percent = (bufferedWithinClip / clipDuration) * 100;
            if (progressBuffer) progressBuffer.style.width = `${Math.min(100, percent)}%`;
        }
    });

    playPauseBtn.addEventListener('click', togglePlay);
    bigPlayBtn.addEventListener('click', togglePlay);
    video.addEventListener('click', togglePlay);

    video.addEventListener('play', () => {
        bigPlayBtn.style.display = 'none';
        updatePlayPauseIcon();
    });

    video.addEventListener('pause', () => {
        bigPlayBtn.style.display = 'flex';
        updatePlayPauseIcon();
    });

    muteBtn.addEventListener('click', () => {
        video.muted = !video.muted;
        if (video.muted) {
            volumeSlider.value = 0;
        } else {
            volumeSlider.value = video.volume || 1;
        }
        updateMuteIcon();
    });

    volumeSlider.addEventListener('input', (e) => {
        video.volume = e.target.value;
        if (video.volume > 0) {
            video.muted = false;
        } else {
            video.muted = true;
        }
        updateMuteIcon();
    });

    progressContainer.addEventListener('mousedown', (e) => {
        isDragging = true;
        updateProgressFromEvent(e);
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            updateProgressFromEvent(e);
        }
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });

    fullscreenBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            videoContainer.requestFullscreen().catch(() => { });
        } else {
            document.exitFullscreen();
        }
    });

    document.addEventListener('fullscreenchange', () => {
        if (document.fullscreenElement) {
            fullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
        } else {
            fullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
        }
    });

    video.addEventListener('dblclick', () => {
        if (!document.fullscreenElement) {
            videoContainer.requestFullscreen().catch(() => { });
        } else {
            document.exitFullscreen();
        }
    });

    // ========== Tastatursteuerung (Leertaste) ==========
    let spacePressed = false;
    let spaceTimer = null;

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        switch (e.code) {
            case 'Space':
                e.preventDefault();
                e.stopPropagation();
                if (!spacePressed) {
                    spacePressed = true;
                    spaceTimer = setTimeout(() => {
                        if (spacePressed) {
                            video.playbackRate = 2.0;
                        }
                    }, 200);
                }
                break;
            case 'KeyM':
                e.preventDefault();
                e.stopPropagation();
                video.muted = !video.muted;
                volumeSlider.value = video.muted ? 0 : (video.volume || 1);
                updateMuteIcon();
                break;
            case 'KeyF':
                e.preventDefault();
                e.stopPropagation();
                if (!document.fullscreenElement) {
                    videoContainer.requestFullscreen().catch(() => { });
                } else {
                    document.exitFullscreen();
                }
                break;
            case 'ArrowRight':
                e.preventDefault();
                e.stopPropagation();
                video.currentTime = Math.min(video.currentTime + 5, clipEnd);
                break;
            case 'ArrowLeft':
                e.preventDefault();
                e.stopPropagation();
                video.currentTime = Math.max(video.currentTime - 5, clipStart);
                break;
            case 'ArrowUp':
                e.preventDefault();
                e.stopPropagation();
                video.volume = Math.min(1, video.volume + 0.1);
                video.muted = false;
                volumeSlider.value = video.volume;
                updateMuteIcon();
                break;
            case 'ArrowDown':
                e.preventDefault();
                e.stopPropagation();
                video.volume = Math.max(0, video.volume - 0.1);
                if (video.volume === 0) video.muted = true;
                volumeSlider.value = video.volume;
                updateMuteIcon();
                break;
        }
    }, true);

    document.addEventListener('keyup', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.code === 'Space') {
            e.preventDefault();
            e.stopPropagation();
            if (spacePressed) {
                clearTimeout(spaceTimer);
                if (video.playbackRate !== 2.0) {
                    togglePlay();
                }
                video.playbackRate = 1.0;
                spacePressed = false;
            }
        }
    }, true);
}

function togglePlay() {
    if (video.paused) {
        video.play().catch(() => { });
    } else {
        video.pause();
    }
}

function updatePlayPauseIcon() {
    if (video.paused) {
        playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
    } else {
        playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
    }
}

function updateMuteIcon() {
    if (video.muted || video.volume === 0) {
        muteBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';
    } else if (video.volume < 0.5) {
        muteBtn.innerHTML = '<i class="fas fa-volume-down"></i>';
    } else {
        muteBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
    }
}

function copyClipLink() {
    const text = window.location.href;
    navigator.clipboard.writeText(text).then(() => {
        showToast('Clip-Link in die Zwischenablage kopiert!');
    }).catch(() => { });
}

async function downloadClipSegment() {
    const btn = document.getElementById('downloadClipBtn');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Bereite vor...';
    btn.disabled = true;

    try {
        const res = await fetch(`/api/clip/${clipId}/status`);
        const data = await res.json();
        if (!data.ready) {
            showToast('Clip muss neu gerendert werden (älter als 24h). Das dauert kurz...', 5000);
        }
    } catch (e) { }

    window.location.href = `/api/clip/${clipId}/download`;

    setTimeout(() => {
        btn.innerHTML = '<i class="fas fa-download"></i> Herunterladen';
        btn.disabled = false;
    }, 6000);
}

function showToast(message, duration = 4000) {
    const toast = document.getElementById('toast');
    const msg = document.getElementById('toastMessage');
    if (msg) msg.innerText = message;
    if (!toast) return;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), duration);
}