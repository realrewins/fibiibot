/* ========= State ========= */
let currentUser = { name: null, display_name: null, role: 'editor', avatar: '', id: null };
let csrfToken = null;

let lastNotificationCount = 0;
let notificationCheckInterval = null;
let liveStatusInterval = null;

let hlsPlayer = null;
let currentVideoId = null;
let currentVideoDuration = 0;
let clipStart = 0;
let clipEnd = 0;
let clipGenerating = false;

/* ========= Boot ========= */
window.addEventListener('load', () => {
  initApp().catch(err => console.error('[VOD] initApp failed', err));
});

/* ========= Init ========= */
async function initApp() {
  // 1) Login-Check holen (setzt csrfToken, currentUser, Header UI)
  await bootstrapSession();

  // 2) Live Status initial + Polling
  await updateLiveStatus();
  if (liveStatusInterval) clearInterval(liveStatusInterval);
  liveStatusInterval = setInterval(updateLiveStatus, 30000);

  // 3) VODs laden
  await loadVods();

  // 4) Notifications initial + Polling
  await loadNotifications();
  if (notificationCheckInterval) clearInterval(notificationCheckInterval);
  notificationCheckInterval = setInterval(checkForNewNotifications, 5000);

  // 5) UI Events
  wireUiEvents();
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

  // Header UI
  const profileAvatar = document.getElementById('profileAvatar');
  const dropdownAvatar = document.getElementById('dropdownAvatar');
  const dropdownName = document.getElementById('dropdownName');
  const dropdownRole = document.getElementById('dropdownRole');

  if (profileAvatar) profileAvatar.src = currentUser.avatar || '';
  if (dropdownAvatar) dropdownAvatar.src = currentUser.avatar || '';
  if (dropdownName) dropdownName.innerText = currentUser.display_name || currentUser.name || '';
  if (dropdownRole) dropdownRole.innerText = currentUser.role || '';
}

/* ========= Live ========= */
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

    // ensure elements exist
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

      const channel = 'letshugotv';
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
      // OFFLINE: remove whole live section to avoid black box
      liveSection.style.display = 'none';
      statusEl.innerHTML = '<span class="live-dot offline"></span> Offline';
      titleEl.innerText = '';
      metaEl.innerHTML = '';
      container.innerHTML = '';
      buttonContainer.style.display = 'none';
    }
  } catch (e) {
    console.error('[VOD] updateLiveStatus error', e);
  }
}

/* ========= VOD list ========= */
async function loadVods() {
  const grid = document.getElementById('vod-grid');
  if (!grid) return;

  grid.innerHTML = '';

  try {
    const res = await fetch('/api/vods');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const vods = Array.isArray(data.vods) ? data.vods : [];

    if (vods.length === 0) {
      grid.innerHTML = '<div class="empty-state">Keine aufgezeichneten Streams vorhanden.</div>';
      return;
    }

    vods.forEach(vod => {
      const card = document.createElement('div');
      card.className = 'card';

      const dateText = vod.date
        ? new Date(vod.date).toLocaleString('de-DE', {
          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        })
        : '-';

      const durationText = typeof vod.duration === 'number' ? formatDuration(vod.duration) : '-';

      // NOTE: no inline onclick => avoids "playVOD is not defined"
      card.innerHTML = `
        <div class="thumb" data-vod-id="${escapeHtmlAttr(vod.id)}">
          <img src="${escapeHtmlAttr(vod.thumbnail || '')}" alt="">
          <span class="game-badge">${escapeHtml(vod.game || 'Aufnahme')}</span>
          <span class="time-badge">${escapeHtml(durationText)}</span>
          <div class="play-overlay"><div class="play-icon"></div></div>
        </div>
        <div class="info">
          <div class="meta-row"><span>${escapeHtml(dateText)}</span></div>
          <div class="title">${escapeHtml(vod.title || 'Unbekannter Stream')}</div>
          <div class="actions">
            <span class="file-size">${escapeHtml(durationText)}</span>
            <div class="btn-group">
              <a href="#" class="btn-icon dl" title="Download" data-dl="${escapeHtmlAttr(vod.id)}"><i class="fas fa-download"></i></a>
              <a href="#" class="btn-icon del" title="Löschen" data-del="${escapeHtmlAttr(vod.id)}"><i class="fas fa-trash"></i></a>
            </div>
          </div>
        </div>
      `;

      grid.appendChild(card);

      card.querySelector('.thumb')?.addEventListener('click', () => playVOD(vod.id));
      card.querySelector('[data-dl]')?.addEventListener('click', (e) => { e.preventDefault(); downloadVOD(vod.id); });
      card.querySelector('[data-del]')?.addEventListener('click', (e) => { e.preventDefault(); deleteVOD(vod.id); });
    });
  } catch (e) {
    console.error('[VOD] loadVods error', e);
    grid.innerHTML = '<div class="empty-state">Fehler beim Laden der VODs.</div>';
  }
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/* ========= VOD Player Modal ========= */
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

    const video = document.getElementById('vodVideo');
    if (video) {
      video.pause();
      video.src = '';
    }

    // reset clip state (if elements exist)
    const clipStartEl = document.getElementById('clipStart');
    const clipEndEl = document.getElementById('clipEnd');
    const clipNameEl = document.getElementById('clipName');
    if (clipStartEl) clipStartEl.value = '0:00';
    if (clipEndEl) clipEndEl.value = '0:00';
    if (clipNameEl) clipNameEl.value = '';

    clipStart = 0;
    clipEnd = 0;
    currentVideoId = null;
  }, 300);
}

async function playVOD(streamId) {
  try {
    const res = await fetch(`/api/vod/${encodeURIComponent(streamId)}/info`);
    if (!res.ok) throw new Error(`vod info http ${res.status}`);
    const meta = await res.json();

    currentVideoId = streamId;
    currentVideoDuration = meta.duration || 0;

    const titleEl = document.getElementById('vodModalTitle');
    const gameEl = document.getElementById('vodGameBadge');
    if (titleEl) titleEl.innerText = meta.title || 'Stream';
    if (gameEl) gameEl.innerText = meta.game || 'Unbekannt';

    // Outages (optional)
    if (typeof renderOutages === 'function') renderOutages(meta.outages || []);

    const video = document.getElementById('vodVideo');
    if (!video) throw new Error('missing #vodVideo');

    const playlistUrl = `/api/vod/${encodeURIComponent(streamId)}/video/playlist.m3u8`;

    // quick existence check
    const headRes = await fetch(playlistUrl, { method: 'HEAD' });
    if (!headRes.ok) {
      alert('Stream-Daten noch nicht verfügbar. Bitte später erneut versuchen.');
      return;
    }

    if (window.Hls && Hls.isSupported()) {
      if (hlsPlayer) hlsPlayer.destroy();
      hlsPlayer = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60, startLevel: -1 });
      hlsPlayer.loadSource(playlistUrl);
      hlsPlayer.attachMedia(video);
      hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = playlistUrl;
      video.addEventListener('loadedmetadata', () => video.play().catch(() => {}), { once: true });
    } else {
      alert('Dein Browser unterstützt kein HLS-Streaming.');
      return;
    }

    openVodModal();
  } catch (e) {
    console.error('[VOD] playVOD error', e);
    alert('VOD konnte nicht geladen werden.');
  }
}

/* ========= Outages (minimal – keeps your markup working) ========= */
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
  const container = document.getElementById('outagesList');
  if (!container) return;
  container.innerHTML = '';
  if (!outages || outages.length === 0) {
    container.innerHTML = '<div class="outage-item">Keine Ausfälle aufgezeichnet</div>';
    return;
  }
  outages.forEach(([start, end]) => {
    const div = document.createElement('div');
    div.className = 'outage-item';
    div.innerHTML = `<span>${formatTimeForOutage(start)} – ${formatTimeForOutage(end)}</span><span>${(end - start).toFixed(1)}s</span>`;
    container.appendChild(div);
  });
}

function formatTimeForOutage(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

/* ========= Clip (placeholders: keep buttons from crashing) ========= */
function setClipStart() {
  const video = document.getElementById('vodVideo');
  if (!video) return;
  clipStart = Math.floor(video.currentTime);
  const el = document.getElementById('clipStart');
  if (el) el.value = formatClipTime(clipStart);
}
function setClipEnd() {
  const video = document.getElementById('vodVideo');
  if (!video) return;
  clipEnd = Math.floor(video.currentTime);
  const el = document.getElementById('clipEnd');
  if (el) el.value = formatClipTime(clipEnd);
}
function formatClipTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}
async function createClip() {
  alert('Clip-Feature ist in dieser Version nicht vollständig implementiert.');
}
function downloadClip() {
  alert('Download-Feature ist in dieser Version nicht vollständig implementiert.');
}
function generateClipLink() {
  alert('Link-Feature ist in dieser Version nicht vollständig implementiert.');
}

/* ========= Notifications ========= */
async function loadNotifications() {
  try {
    const response = await fetch('/api/notifications');
    if (response.status === 401) { window.location.href = '/login'; return; }
    const data = await response.json();
    renderNotifications(data.notifications);
    lastNotificationCount = data.notifications ? data.notifications.length : 0;
  } catch (e) {
    console.error('Fehler beim Laden der Notifications', e);
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
    console.error(e);
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
    if (!res.ok) {
      // if this still 403s, csrfToken is not set or session mismatch
      console.warn('[notifications/read] failed', res.status);
    }
  } catch (e) {
    console.error(e);
  }
}

/* ========= Bugreport Modal (frontend submit only; modal markup must exist) ========= */
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

/* ========= UI helpers ========= */
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

/* ========= Wire UI events ========= */
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

/* ========= Download/Delete placeholders ========= */
function downloadVOD(id) {
  alert('Download (noch nicht implementiert)');
}
function deleteVOD(id) {
  if (confirm('Wirklich löschen?')) alert('Gelöscht (noch nicht implementiert)');
}

/* ========= tiny escaping helpers ========= */
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