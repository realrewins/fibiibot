let currentUser = { name: null, display_name: null, role: 'editor', avatar: '', id: null };
let csrfToken = null;
let unreadExists = false;
let animationInterval = null;
let lastNotificationCount = 0;
let notificationCheckInterval = null;
let liveStatusInterval = null;

let allVods = [];
let hlsPlayer = null;
let currentVideoId = null;
let currentVideoDuration = 0;
let currentVideoTitle = '';
let clipStart = 0;
let clipEnd = 0;
let clipGenerating = false;

document.addEventListener('click', function (e) {
  const profileDropdown = document.getElementById('profileDropdown');
  const profileBtn = document.getElementById('profileBtn');
  if (
    profileDropdown &&
    profileDropdown.classList.contains('show') &&
    !profileDropdown.contains(e.target) &&
    e.target !== profileBtn &&
    !profileBtn.contains(e.target)
  ) {
    profileDropdown.classList.remove('show');
  }
  const notificationDropdown = document.getElementById('notificationDropdown');
  const notificationBtn = document.getElementById('notificationBtn');
  if (
    notificationDropdown &&
    notificationDropdown.classList.contains('show') &&
    !notificationDropdown.contains(e.target) &&
    e.target !== notificationBtn &&
    !notificationBtn.contains(e.target)
  ) {
    notificationDropdown.classList.remove('show');
    loadNotifications();
  }
}, true);

async function initApp() {
  // 1) Live UI initial setzen und danach regelmäßig prüfen
  await updateLiveStatus();
  if (liveStatusInterval) clearInterval(liveStatusInterval);
  liveStatusInterval = setInterval(updateLiveStatus, 30000);

  // 2) VODs laden (der Renderer passt zu playVOD())
  await loadVODs();

  // 3) Notifications/Bugs
  loadNotifications();
  if (notificationCheckInterval) clearInterval(notificationCheckInterval);
  notificationCheckInterval = setInterval(checkForNewNotifications, 5000);
  setInterval(checkOpenBugReports, 10000);

  document.getElementById('bugReportBtn')?.addEventListener('click', function (e) {
    e.stopPropagation();
    openModal('bugReportModal');
    document.body.style.overflow = 'hidden';
  });

  document.getElementById('notificationBtn')?.addEventListener('click', function () {
    const dropdown = document.getElementById('notificationDropdown');
    dropdown.classList.toggle('show');
    markNotificationsAsRead();
  });

  document.getElementById('profileBtn')?.addEventListener('click', function () {
    const dropdown = document.getElementById('profileDropdown');
    dropdown.classList.toggle('show');
  });

  document.getElementById('bugReportModal')?.addEventListener('click', function (e) {
    if (e.target === this) closeModal('bugReportModal');
  });

  document.getElementById('vodPlayerModal')?.addEventListener('click', function (e) {
    if (e.target === this) closeVodModal();
  });
}

/**
 * Live-Status + Player ein/ausblenden.
 * Offline => live-section komplett unsichtbar + iframe cleared => keine schwarze Box.
 */
async function updateLiveStatus() {
  try {
    const res = await fetch('/api/stream/info');
    const data = await res.json();

    const statusEl = document.getElementById('live-status');
    const streamInfoEl = document.getElementById('stream-info');
    const container = document.getElementById('twitch-player-container');
    const buttonContainer = document.getElementById('twitch-button-container');
    const liveSection = document.getElementById('live-section');

    if (!statusEl || !streamInfoEl || !container || !buttonContainer || !liveSection) return;

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
      statusEl.classList.add('live-tag');

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
      // Offline => alles weg
      liveSection.style.display = 'none';
      statusEl.innerHTML = '<span class="live-dot offline"></span> Offline';
      statusEl.classList.add('live-tag');
      titleEl.innerText = '';
      metaEl.innerHTML = '';
      container.innerHTML = '';
      buttonContainer.style.display = 'none';
    }
  } catch (e) {
    console.error('Fehler in updateLiveStatus:', e);
  }
}

/**
 * EINZIGE Quelle fürs Laden der VOD-Kacheln.
 * Baut Cards, die playVOD() aufrufen (weil playVOD bei dir existiert).
 */
async function loadVODs() {
  try {
    const res = await fetch('/api/vods');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const grid = document.getElementById('vod-grid');
    if (!grid) return;

    grid.innerHTML = '';

    const vods = Array.isArray(data.vods) ? data.vods : [];
    if (vods.length === 0) {
      grid.innerHTML = '<div class="empty-state">Keine aufgezeichneten Streams vorhanden.</div>';
      return;
    }

    vods.forEach(vod => {
      const date = vod.date
        ? new Date(vod.date).toLocaleString('de-DE', {
          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        })
        : '-';

      const duration = vod.duration ? formatDurationBadge(vod.duration) : '-';

      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="thumb" onclick="playVOD('${vod.id}')">
          <img src="${vod.thumbnail}" alt="">
          <span class="game-badge">${vod.game || 'Aufnahme'}</span>
          <span class="time-badge">${duration}</span>
          <div class="play-overlay">
            <div class="play-icon"></div>
          </div>
        </div>
        <div class="info">
          <div class="meta-row">
            <span>${date}</span>
          </div>
          <div class="title">${vod.title || 'Unbekannter Stream'}</div>
          <div class="actions">
            <span class="file-size">${duration}</span>
            <div class="btn-group">
              <a href="#" class="btn-icon dl" title="Download" onclick="downloadVOD('${vod.id}'); return false;"><i class="fas fa-download"></i></a>
              <a href="#" class="btn-icon del" title="Löschen" onclick="deleteVOD('${vod.id}'); return false;"><i class="fas fa-trash"></i></a>
            </div>
          </div>
        </div>
      `;
      grid.appendChild(card);
    });
  } catch (e) {
    console.error('Fehler in loadVODs:', e);
    const grid = document.getElementById('vod-grid');
    if (grid) grid.innerHTML = '<div class="empty-state">Fehler beim Laden der VODs.</div>';
  }
}

function formatDurationBadge(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ========== Outage-Dropdown ==========
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
    div.innerHTML = `<span>${formatTimeForBadge(start)} – ${formatTimeForBadge(end)}</span><span>${(end - start).toFixed(1)}s</span>`;
    container.appendChild(div);
  });
}

function formatTimeForBadge(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ========== Clip-Funktionen ==========
function setClipStart() {
  const video = document.getElementById('vodVideo');
  if (video) {
    clipStart = Math.floor(video.currentTime);
    document.getElementById('clipStart').value = formatTimeForInput(clipStart);
  }
}

function setClipEnd() {
  const video = document.getElementById('vodVideo');
  if (video) {
    clipEnd = Math.floor(video.currentTime);
    document.getElementById('clipEnd').value = formatTimeForInput(clipEnd);
  }
}

function formatTimeForInput(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function parseTimeFromInput(str) {
  const parts = str.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function updateClipStart() {
  clipStart = parseTimeFromInput(document.getElementById('clipStart').value);
  if (clipStart < 0) clipStart = 0;
  if (clipStart > currentVideoDuration) clipStart = currentVideoDuration;
  document.getElementById('clipStart').value = formatTimeForInput(clipStart);
}

function updateClipEnd() {
  clipEnd = parseTimeFromInput(document.getElementById('clipEnd').value);
  if (clipEnd < 0) clipEnd = 0;
  if (clipEnd > currentVideoDuration) clipEnd = currentVideoDuration;
  document.getElementById('clipEnd').value = formatTimeForInput(clipEnd);
}

// createClip(), downloadClip(), generateClipLink(), openVodModal(), closeVodModal(), playVOD()
// ... ab hier kannst du deinen bestehenden Code unverändert lassen ...

// ========== BENACHRICHTIGUNGEN ==========
async function loadNotifications() {
  try {
    const response = await fetch('/api/notifications');
    if (response.status === 401) { window.location.href = '/login'; return; }
    const data = await response.json();
    renderNotifications(data.notifications);
    checkUnreadNotifications(data.notifications);
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
    const dropdown = document.getElementById('notificationDropdown');
    if (dropdown && !dropdown.classList.contains('show')) renderNotifications(data.notifications);
    checkUnreadNotifications(data.notifications);
    lastNotificationCount = currentCount;
  } catch (e) {
    console.error(e);
  }
}

async function checkOpenBugReports() {
  try {
    const response = await fetch('/api/bugreports');
    if (response.status === 401) { window.location.href = '/login'; return; }
    const data = await response.json();
    const openCount = (data.reports || []).filter(r => r.status === 'open').length;
    const badge = document.getElementById('sidebarBugBadge');
    if (badge) badge.classList.toggle('show', openCount > 0);
  } catch (e) {
    console.error('Fehler beim Prüfen offener Bug-Reports', e);
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
      item.innerHTML = `<div class="notification-header"><span>${formattedDate} • ${notif.from_user}</span>${unreadDot}</div><div class="notification-message">${notif.message}</div>`;
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

function checkUnreadNotifications(notifications) {
  const unreadCount = notifications ? notifications.filter(n => !n.read).length : 0;
  const hasUnread = unreadCount > 0;
  const badge = document.getElementById('notificationBadge');
  unreadExists = hasUnread;
  if (badge) {
    if (hasUnread) {
      badge.classList.add('show', 'glow');
      if (!animationInterval) startNotificationAnimation();
      document.title = `(${unreadCount}) Fibii Bot · VOD`;
    } else {
      badge.classList.remove('show', 'glow');
      if (animationInterval) {
        clearInterval(animationInterval);
        animationInterval = null;
      }
      document.title = 'Fibii Bot · VOD';
    }
  }
}

function startNotificationAnimation() {
  if (animationInterval) clearInterval(animationInterval);
  animationInterval = setInterval(() => {
    if (unreadExists) triggerNotificationAnimation();
  }, 5000);
}

function triggerNotificationAnimation() {
  const bellIcon = document.querySelector('#notificationBtn i');
  if (!bellIcon) return;
  bellIcon.classList.add('bell-shake');
  setTimeout(() => bellIcon.classList.remove('bell-shake'), 500);
}

async function markNotificationsAsRead() {
  try {
    await fetch('/api/notifications/read', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      }
    });
    const badge = document.getElementById('notificationBadge');
    if (!badge) return;
    badge.classList.add('badge-fade-out');
    setTimeout(() => badge.classList.remove('show', 'glow', 'badge-fade-out'), 300);
  } catch (e) {
    console.error(e);
  }
}

// ========== UI-HILFSFUNKTIONEN ==========
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

window.addEventListener('load', initApp);