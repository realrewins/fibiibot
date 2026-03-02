let currentUser = { name: null, display_name: null, role: 'editor', avatar: '', id: null };
let csrfToken = null;

let lastNotificationCount = 0;
let notificationCheckInterval = null;
let liveStatusInterval = null;

let hlsPlayer = null;
let currentVideoId = null;
let currentOutages = [];
let currentVideoDuration = 0;

let clipStart = 0;
let clipEnd = 0;
let clipGeneratedHash = null;

let video, playPauseBtn, muteBtn, volumeSlider, fullscreenBtn;
let progressContainer, progressBar, timeDisplay, bigPlayBtn, videoContainer;
let isDragging = false;

window.addEventListener('load', () => {
  initApp().catch(err => console.error(err));
});

async function initApp() {
  await bootstrapSession();

  await updateLiveStatus();
  if (liveStatusInterval) clearInterval(liveStatusInterval);
  liveStatusInterval = setInterval(updateLiveStatus, 30000);

  await loadVods();

  await loadNotifications();
  if (notificationCheckInterval) clearInterval(notificationCheckInterval);
  notificationCheckInterval = setInterval(checkForNewNotifications, 5000);

  wireUiEvents();
  initPlayerElements();
}

async function bootstrapSession() {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ check: true })
  });

  if (!res.ok) {
    window.location.href = '/login';
    return;
  }

  const result = await res.json();
  if (!result.access) {
    window.location.href = '/login';
    return;
  }

  csrfToken = result.csrf_token;
  currentUser = result.user;

  const profileAvatar = document.getElementById('profileAvatar');
  const dropdownAvatar = document.getElementById('dropdownAvatar');
  const dropdownName = document.getElementById('dropdownName');
  const dropdownRole = document.getElementById('dropdownRole');

  if (profileAvatar) profileAvatar.src = currentUser.avatar || '';
  if (dropdownAvatar) dropdownAvatar.src = currentUser.avatar || '';
  if (dropdownName) dropdownName.innerText = currentUser.display_name || currentUser.name || '';
  if (dropdownRole) dropdownRole.innerText = currentUser.role || '';
}

async function updateLiveStatus() {
  try {
    const res = await fetch('/api/stream/info');
    const data = await res.json();

    const liveSection = document.getElementById('live-section');
    const statusEl = document.getElementById('live-status');
    const streamInfoEl = document.getElementById('stream-info');
    const container = document.getElementById('twitch-player-container');
    const buttonContainer = document.getElementById('twitch-button-container');

    if (!liveSection || !statusEl || !streamInfoEl || !container || !buttonContainer) return;

    let titleEl = streamInfoEl.querySelector('.stream-title');
    let metaEl = streamInfoEl.querySelector('.stream-meta');
    if (!titleEl) {
      titleEl = document.createElement('div');
      titleEl.className = 'stream-title';
      streamInfoEl.appendChild(titleEl);
    }
    if (!metaEl) {
      metaEl = document.createElement('div');
      metaEl.className = 'stream-meta';
      streamInfoEl.appendChild(metaEl);
    }

    if (data.live) {
      liveSection.style.display = 'block';
      statusEl.innerHTML = '<span class="live-dot"></span> LIVE';

      titleEl.innerText = data.title || 'Kein Titel';
      metaEl.innerHTML = `
        <span class="game"><i class="fas fa-gamepad"></i> ${data.game || 'Unbekannt'}</span>
        <span class="viewers"><i class="fas fa-eye"></i> ${data.viewers || 0} Zuschauer</span>
      `;

      const channel = 'fibii';
      const host = window.location.hostname;

      let iframe = container.querySelector('iframe');
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.width = '100%';
        iframe.height = '100%';
        iframe.style.border = 'none';
        iframe.allow = 'autoplay; fullscreen';
        container.appendChild(iframe);
      }
      const desiredSrc = `https://player.twitch.tv/?channel=${channel}&parent=${host}&autoplay=true&muted=false`;
      if (iframe.src !== desiredSrc) iframe.src = desiredSrc;

      const twitchLink = buttonContainer.querySelector('a');
      if (twitchLink) twitchLink.href = `https://twitch.tv/${channel}`;
      buttonContainer.style.display = 'block';
    } else {
      liveSection.style.display = 'none';
      statusEl.innerHTML = '<span class="live-dot offline"></span> Offline';
      titleEl.innerText = '';
      metaEl.innerHTML = '';
      container.innerHTML = '';
      buttonContainer.style.display = 'none';
    }
  } catch (e) {
  }
}

async function loadVods() {
    const grid = document.getElementById('vod-grid');
    if (!grid) return;
    grid.innerHTML = '';
    try {
        const res = await fetch('/api/vods');
        const data = await res.json();
        const vods = Array.isArray(data.vods) ? data.vods : [];
        
        vods.forEach(vod => {
            const card = document.createElement('div');
            card.className = 'card';
            
            let displayDuration = vod.duration;
            // Nur wenn ended_at fehlt, ist es eine Live-Aufnahme
            if (!vod.ended_at && vod.date) {
                const startTime = new Date(vod.date).getTime();
                displayDuration = Math.floor((Date.now() - startTime) / 1000);
            }

            const durationText = formatDurationText(displayDuration);
            card.innerHTML = `
                <div class="thumb">
                    <img src="${vod.thumbnail}" alt="">
                    <span class="game-badge">${vod.game || 'Aufnahme'}</span>
                    <span class="time-badge ${!vod.ended_at ? 'live-recording' : ''}">${!vod.ended_at ? '<i class="fas fa-circle"></i> ' : ''}${durationText}</span>
                    <div class="play-overlay"><div class="play-icon"></div></div>
                </div>
                <div class="info">
                    <div class="title">${vod.title}</div>
                </div>
            `;
            grid.appendChild(card);
            card.querySelector('.thumb').onclick = () => playVOD(vod.id);
        });
    } catch (e) { console.error(e); }
}

function formatDurationText(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function openVodModal() {
  const modal = document.getElementById('vodPlayerModal');
  if (!modal) return;
  modal.style.display = 'flex';
  modal.offsetHeight;
  modal.classList.add('show');
}

function closeVodModal() {
  const modal = document.getElementById('vodPlayerModal');
  if (!modal) return;

  modal.classList.remove('show');
  setTimeout(() => {
    modal.style.display = 'none';

    if (hlsPlayer) {
      hlsPlayer.destroy();
      hlsPlayer = null;
    }

    if (video) {
      video.pause();
      video.src = '';
    }

    currentVideoId = null;
    clipStart = 0;
    clipEnd = 0;
    clipGeneratedHash = null;

    const clipStartDisplay = document.getElementById('clipStartDisplay');
    const clipEndDisplay = document.getElementById('clipEndDisplay');
    const clipTitleInput = document.getElementById('clipTitleInput');
    
    if (clipStartDisplay) clipStartDisplay.innerText = '00:00:00';
    if (clipEndDisplay) clipEndDisplay.innerText = '00:00:00';
    if (clipTitleInput) clipTitleInput.value = '';
    
    document.getElementById('clipLoadingArea').style.maxHeight = '0px';
    document.getElementById('clipLoadingArea').style.marginTop = '0px';
    document.getElementById('clipResultArea').style.maxHeight = '0px';
    document.getElementById('clipResultArea').style.marginTop = '0px';
    document.getElementById('clipResultImg').src = '';

  }, 300);
}

function initPlayerElements() {
  video = document.getElementById('vodVideo');
  playPauseBtn = document.getElementById('playPauseBtn');
  muteBtn = document.getElementById('muteBtn');
  volumeSlider = document.getElementById('volumeSlider');
  fullscreenBtn = document.getElementById('fullscreenBtn');
  progressContainer = document.getElementById('progressContainer');
  progressBar = document.getElementById('progressBar');
  timeDisplay = document.getElementById('timeDisplay');
  bigPlayBtn = document.getElementById('bigPlayBtn');
  videoContainer = document.getElementById('videoContainer');

  setupPlayerControls();
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

function formatClipTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateProgressFromEvent(e) {
  const rect = progressContainer.getBoundingClientRect();
  let pos = (e.clientX - rect.left) / rect.width;
  if (pos < 0) pos = 0;
  if (pos > 1) pos = 1;
  
  let newTime = pos * currentVideoDuration;
  video.currentTime = newTime;
  
  progressBar.style.width = `${pos * 100}%`;
  const dot = document.getElementById('progressDot');
  if(dot) dot.style.left = `${pos * 100}%`;
  timeDisplay.innerText = `${formatClipTime(newTime)} / ${formatClipTime(currentVideoDuration)}`;
}

function setupPlayerControls() {
    video.addEventListener('durationchange', () => {
        if (video.duration && video.duration !== Infinity && !isNaN(video.duration)) {
            currentVideoDuration = video.duration;
        }
    });

    video.addEventListener('timeupdate', () => {
        if (isDragging) return;
        
        const curr = video.currentTime;
        let percent = (curr / currentVideoDuration) * 100;
        
        progressBar.style.width = `${Math.min(100, percent)}%`;
        const dot = document.getElementById('progressDot');
        if (dot) dot.style.left = `${Math.min(100, percent)}%`;
        
        timeDisplay.innerText = `${formatClipTime(curr)} / ${formatClipTime(currentVideoDuration)}`;
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
        volumeSlider.value = video.muted ? 0 : (video.volume || 1);
        updateMuteIcon();
    });

    volumeSlider.addEventListener('input', (e) => {
        video.volume = e.target.value;
        video.muted = video.volume === 0;
        updateMuteIcon();
    });

    progressContainer.addEventListener('mousedown', (e) => { 
        isDragging = true; 
        updateProgressFromEvent(e); 
    });
    
    document.addEventListener('mousemove', (e) => { 
        if (isDragging) updateProgressFromEvent(e); 
    });
    
    document.addEventListener('mouseup', () => { 
        isDragging = false; 
    });

    fullscreenBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            videoContainer.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen();
        }
    });
}

function togglePlay() {
  if (video.paused) {
      video.play().catch(()=>{});
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

async function playVOD(streamId) {
    try {
        const res = await fetch(`/api/vod/${encodeURIComponent(streamId)}/info`);
        const meta = await res.json();
        currentVideoId = streamId;
        currentOutages = meta.outages || [];
        
        document.getElementById('vodModalTitle').innerText = meta.title || 'Stream';
        document.getElementById('vodGameBadge').innerHTML = `<i class="fas fa-gamepad"></i> ${meta.game || 'Unbekannt'}`;
        
        renderOutageDrawer(currentOutages);
        
        if (window.Hls && Hls.isSupported()) {
            if (hlsPlayer) hlsPlayer.destroy();
            hlsPlayer = new Hls();
            hlsPlayer.loadSource(meta.video_url);
            hlsPlayer.attachMedia(video);
            hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
                currentVideoDuration = video.duration;
                renderTimelineMarkers(meta.chapters);
                video.play().catch(() => {});
            });
        } else {
            video.src = meta.video_url;
            video.addEventListener('loadedmetadata', () => {
                currentVideoDuration = video.duration;
                renderTimelineMarkers(meta.chapters);
                video.play().catch(() => {});
            });
        }
        openVodModal();
    } catch (e) {
        alert('Fehler beim Laden des VODs');
    }
}

function toggleOutages() {
  const list = document.getElementById('outagesList');
  const chevron = document.getElementById('outagesChevron');
  if (!list || !chevron) return;
  if (list.style.display === 'none') {
    list.style.display = 'block';
    chevron.style.transform = 'rotate(180deg)';
  } else {
    list.style.display = 'none';
    chevron.style.transform = 'rotate(0deg)';
  }
}

function renderOutages(outages) {
  const wrapper = document.getElementById('vodOutagesWrapper');
  const container = document.getElementById('outagesList');
  if (!container || !wrapper) return;
  
  container.innerHTML = '';
  
  if (!outages || outages.length === 0) {
    wrapper.style.display = 'none';
    return;
  }
  
  wrapper.style.display = 'block';
  outages.forEach(([start, end]) => {
    const div = document.createElement('div');
    div.className = 'outage-item';
    div.innerHTML = `<span>${formatTimeForOutage(start)} – ${formatTimeForOutage(end)}</span><span>${(end - start).toFixed(1)}s</span>`;
    container.appendChild(div);
  });
}

function renderOutageMarkers(outages, startedAt) {
    const container = document.getElementById('progressContainer');
    container.querySelectorAll('.timeline-outage').forEach(m => m.remove());

    if (!outages || outages.length === 0 || !currentVideoDuration) return;

    const streamStart = new Date(startedAt).getTime() / 1000;

    outages.forEach(outage => {
        const [outageStartSec, outageEndSec] = outage;

        const startPercent = (outageStartSec / currentVideoDuration) * 100;
        const durationSec = outageEndSec - outageStartSec;
        const widthPercent = (durationSec / currentVideoDuration) * 100;

        if (startPercent < 100) {
            const outageEl = document.createElement('div');
            outageEl.className = 'timeline-outage';
            outageEl.style.left = `${startPercent}%`;
            outageEl.style.width = `${Math.min(widthPercent, 100 - startPercent)}%`;
            container.appendChild(outageEl);
        }
    });
}

function renderOutageDrawer(outages) {
    const drawer = document.getElementById('outageDrawer');
    const list = document.getElementById('outageList');
    const count = document.getElementById('outageCount');
    
    if (!outages || outages.length === 0) {
        if (drawer) drawer.style.display = 'none';
        return;
    }
    
    drawer.style.display = 'flex';
    count.innerText = outages.length;
    list.innerHTML = '';

    outages.forEach(ot => {
        const item = document.createElement('div');
        item.className = 'outage-item';
        const triggerPoint = ot.time || ot.start_sec;
        const duration = ot.duration || (ot.end_sec - ot.start_sec);
        const readable = ot.readable_time || ot.readable || formatClipTime(triggerPoint);

        item.innerHTML = `<span><b>${readable}</b></span><span style="opacity:0.6">|</span><span>${Math.round(duration)}s</span>`;
        item.onclick = (e) => {
            e.stopPropagation();
            video.currentTime = Math.max(0, triggerPoint - 2);
            video.play().catch(() => {});
        };
        list.appendChild(item);
    });

    document.getElementById('outageToggle').onclick = (e) => {
        e.stopPropagation();
        drawer.classList.toggle('expanded');
    };
}

function renderTimelineMarkers(chapters) {
    const container = document.getElementById('progressContainer');
    if (!container) return;

    container.style.background = 'transparent';
    const bg = container.querySelector('.progress-bar-bg');
    if (bg) bg.style.display = 'none';

    container.querySelectorAll('.timeline-marker').forEach(m => m.remove());
    
    if (!currentVideoDuration || currentVideoDuration === 0) return;

    if (chapters) {
        chapters.forEach(ch => {
            if (ch.stream_sec <= 0) return;
            const marker = document.createElement('div');
            marker.className = 'timeline-marker';
            const percent = (ch.stream_sec / currentVideoDuration) * 100;
            marker.style.left = `${Math.min(100, percent)}%`;
            container.appendChild(marker);
        });
    }
}
function handleOutagePlayback() {
    video.addEventListener('timeupdate', () => {
        if (!currentOutages) return;
        
        const curr = video.currentTime;
        currentOutages.forEach(outage => {
            const [start, end] = outage;
            if (curr >= start && curr < end) {
                video.currentTime = end;
                showToast("Ausfall übersprungen", 2000);
            }
        });
    });
}

function formatTimeForOutage(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function setClipStart() {
    if (!video) return;
    clipStart = video.currentTime;
    document.getElementById('clipStartDisplay').innerText = formatClipTime(clipStart);
}

function setClipEnd() {
    if (!video) return;
    clipEnd = video.currentTime;
    document.getElementById('clipEndDisplay').innerText = formatClipTime(clipEnd);
}

function createClip() {
    const title = document.getElementById('clipTitleInput').value.trim();
    if (!title) {
        alert("Bitte gib einen Clip-Titel ein.");
        return;
    }
    if (clipEnd <= clipStart || clipEnd === 0) {
        alert("Bitte setze ein gültiges Start- und Enddatum.");
        return;
    }

    const btn = document.getElementById('createClipBtn');
    const loadArea = document.getElementById('clipLoadingArea');
    const resultArea = document.getElementById('clipResultArea');
    const bar = document.getElementById('clipLoadingBar');

    btn.disabled = true;
    resultArea.style.maxHeight = '0px';
    resultArea.style.marginTop = '0px';

    loadArea.style.maxHeight = '20px';
    loadArea.style.marginTop = '15px';
    bar.style.width = '0%';

    let progress = 0;
    let apiDone = false;

    fetch('/api/clip/create', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({
            streamId: currentVideoId,
            start: clipStart,
            end: clipEnd,
            startFormatted: formatClipTime(clipStart),
            endFormatted: formatClipTime(clipEnd),
            name: title
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.hash) {
            clipGeneratedHash = data.hash;
        }
        apiDone = true;
    })
    .catch(err => {
        apiDone = true;
    });

    function advanceBar() {
        if (progress >= 100) return;

        let jump = Math.random() * 12 + 5;
        progress += jump;

        if (progress > 85 && !apiDone) {
            progress = 85; 
        }

        if (progress >= 100) {
            progress = 100;
            bar.style.width = '100%';
            setTimeout(showClipResult, 400);
            return;
        }

        bar.style.width = `${progress}%`;

        let nextTick = Math.random() * 200 + 100;
        if (Math.random() < 0.3) {
            nextTick += 500; 
        }

        setTimeout(advanceBar, nextTick);
    }
    
    setTimeout(advanceBar, 100);
}

function showClipResult() {
    document.getElementById('clipLoadingArea').style.maxHeight = '0px';
    document.getElementById('createClipBtn').disabled = false;
    
    const thumbImg = document.getElementById('clipResultImg');
    thumbImg.src = `/api/vod/clips/${clipGeneratedHash}/thumbnail.png?t=${Date.now()}`;
    
    thumbImg.onclick = () => {
        video.pause();
        updatePlayPauseIcon();
        window.open(`https://fibiibot.com/vod/clips/${clipGeneratedHash}`, '_blank');
    };

    document.getElementById('clipLinkSpan').innerText = `fibiibot.com/vod/clips/${clipGeneratedHash}`;
    
    const resArea = document.getElementById('clipResultArea');
    resArea.style.marginTop = '15px';
    resArea.style.maxHeight = '400px';
}

function copyGeneratedLink() {
    video.pause();
    updatePlayPauseIcon();
    
    navigator.clipboard.writeText(`https://fibiibot.com/vod/clips/${clipGeneratedHash}`);
    window.open(`https://fibiibot.com/vod/clips/${clipGeneratedHash}`, '_blank');
}

async function downloadGeneratedClip() {
    video.pause();
    updatePlayPauseIcon();

    const btn = document.getElementById('modalDownloadBtn');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    
    const res = await fetch(`/api/clip/${clipGeneratedHash}/status`);
    const data = await res.json();
    
    if (!data.ready) {
        setTimeout(() => { btn.innerHTML = '<i class="fas fa-download"></i>'; }, 2000);
        return;
    }
    
    window.location.href = `/api/clip/${clipGeneratedHash}/download`;
    setTimeout(() => { btn.innerHTML = '<i class="fas fa-download"></i>'; }, 3000);
}

async function loadNotifications() {
  try {
    const response = await fetch('/api/notifications');
    if (response.status === 401) { window.location.href = '/login'; return; }
    const data = await response.json();
    renderNotifications(data.notifications);
    lastNotificationCount = data.notifications ? data.notifications.length : 0;
  } catch (e) {
  }
}

async function checkForNewNotifications() {
  try {
    const response = await fetch('/api/notifications');
    if (response.status === 401) { window.location.href = '/login'; return; }
    const data = await response.json();
    const currentCount = data.notifications ? data.notifications.length : 0;
    if (currentCount > lastNotificationCount) triggerNotificationAnimation();
    lastNotificationCount = currentCount;
    const dropdown = document.getElementById('notificationDropdown');
    if (dropdown && !dropdown.classList.contains('show')) renderNotifications(data.notifications);
  } catch (e) {
  }
}

function renderNotifications(notifications) {
  const dropdown = document.getElementById('notificationDropdown');
  if (!dropdown) return;
  while (dropdown.children.length > 1) dropdown.removeChild(dropdown.lastChild);

  if (notifications && notifications.length > 0) {
    notifications.forEach(notif => {
      const date = new Date(notif.timestamp);
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const hour = String(date.getHours()).padStart(2, '0');
      const minute = String(date.getMinutes()).padStart(2, '0');
      const formattedDate = `${day}.${month}, ${hour}:${minute}`;
      const unreadDot = !notif.read ? '<span class="unread-dot"></span>' : '';
      const item = document.createElement('div');
      item.className = 'notification-item';
      item.innerHTML = `<div class="notification-header"><span>${formattedDate} • ${escapeHtml(notif.from_user || '')}</span>${unreadDot}</div><div class="notification-message">${escapeHtml(notif.message || '')}</div>`;
      dropdown.appendChild(item);
    });
  } else {
    const empty = document.createElement('div');
    empty.className = 'notification-item';
    empty.style.justifyContent = 'center';
    empty.style.color = 'var(--text-muted)';
    empty.innerText = 'Keine neuen Benachrichtigungen';
    dropdown.appendChild(empty);
  }
}

function triggerNotificationAnimation() {
  const bellIcon = document.querySelector('#notificationBtn i');
  if (!bellIcon) return;
  bellIcon.classList.add('bell-shake');
  setTimeout(() => bellIcon.classList.remove('bell-shake'), 500);
}

async function markNotificationsAsRead() {
  try {
    const res = await fetch('/api/notifications/read', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      }
    });
  } catch (e) {
  }
}

async function submitBugReport() {
  const subjectInput = document.getElementById('bugSubject');
  const descInput = document.getElementById('bugDescription');
  const subject = subjectInput?.value.trim();
  const description = descInput?.value.trim();
  if (!subject || !description) return;

  const response = await fetch('/api/bugreport', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ subject, description })
  });
  const data = await response.json();
  if (response.ok) {
    closeModal('bugReportModal');
    showToast('Danke für deine Hilfe! Wir werden dir bald ein Update zum Bug geben.');
    subjectInput.value = '';
    descInput.value = '';
  } else {
    alert('Fehler beim Senden: ' + (data.error || 'Unbekannter Fehler'));
  }
}

function showToast(message, duration = 4000) {
  const toast = document.getElementById('toast');
  const msg = document.getElementById('toastMessage');
  if (msg) msg.innerText = message;
  if (!toast) return;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.style.display = 'flex';
  modal.offsetHeight;
  modal.classList.add('show');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('show');
  setTimeout(() => { modal.style.display = 'none'; }, 300);
}

async function logout() {
  try {
    await fetch('/api/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }
    });
    window.location.href = '/login';
  } catch {
    window.location.href = '/login';
  }
}

function wireUiEvents() {
  document.getElementById('bugReportBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openModal('bugReportModal');
  });

  document.getElementById('notificationBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const dropdown = document.getElementById('notificationDropdown');
    if (!dropdown) return;
    dropdown.classList.toggle('show');
    if (dropdown.classList.contains('show')) markNotificationsAsRead();
  });

  document.getElementById('profileBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('profileDropdown')?.classList.toggle('show');
  });

  document.addEventListener('click', (e) => {
    const notifDropdown = document.getElementById('notificationDropdown');
    const notifBtn = document.getElementById('notificationBtn');
    if (notifDropdown && notifBtn && !notifDropdown.contains(e.target) && !notifBtn.contains(e.target)) {
      notifDropdown.classList.remove('show');
    }

    const profileDropdown = document.getElementById('profileDropdown');
    const profileBtn = document.getElementById('profileBtn');
    if (profileDropdown && profileBtn && !profileDropdown.contains(e.target) && !profileBtn.contains(e.target)) {
      profileDropdown.classList.remove('show');
    }
  });

  document.getElementById('vodPlayerModal')?.addEventListener('click', function (e) {
    if (e.target === this) closeVodModal();
  });

  document.getElementById('bugReportModal')?.addEventListener('click', function (e) {
    if (e.target === this) closeModal('bugReportModal');
  });
}

function downloadVOD(id) {
  alert('Download (noch nicht implementiert)');
}

function deleteVOD(id) {
  if (confirm('Wirklich löschen?')) alert('Gelöscht (noch nicht implementiert)');
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeHtmlAttr(str) {
  return escapeHtml(str).replaceAll('`', '&#096;');
}