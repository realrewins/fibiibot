let currentUser = { name: null, display_name: null, role: 'editor', avatar: '', id: null };
let csrfToken = null;
let unreadExists = false;
let animationInterval = null;
let lastNotificationCount = 0;
let notificationCheckInterval = null;

let allClips = [];
let currentPartnerFilter = 'all';
let currentSearchTerm = '';
let currentEditId = null;
let deleteCandidateId = null;

document.addEventListener('click', function(e) {
    const profileDropdown = document.getElementById('profileDropdown');
    const profileBtn = document.getElementById('profileBtn');
    if (profileDropdown && profileDropdown.classList.contains('show') && !profileDropdown.contains(e.target) && e.target !== profileBtn && !profileBtn.contains(e.target)) {
        profileDropdown.classList.remove('show');
    }
    const notificationDropdown = document.getElementById('notificationDropdown');
    const notificationBtn = document.getElementById('notificationBtn');
    if (notificationDropdown && notificationDropdown.classList.contains('show') && !notificationDropdown.contains(e.target) && e.target !== notificationBtn && !notificationBtn.contains(e.target)) {
        notificationDropdown.classList.remove('show');
        loadNotifications();
    }
    if (!e.target.closest('.custom-dropdown')) {
        document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('active'));
    }
}, true);

async function initApp() {
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ check: true })
        });
        const result = await response.json();
        if (result.access) {
            currentUser.name = result.user.name;
            currentUser.display_name = result.user.display_name;
            currentUser.role = result.user.role;
            currentUser.avatar = result.user.avatar;
            currentUser.id = result.user.id;
            csrfToken = result.csrf_token;

            window.currentUser = currentUser;
            document.getElementById('profileAvatar').src = currentUser.avatar;
            document.getElementById('dropdownAvatar').src = currentUser.avatar;
            document.getElementById('dropdownName').innerText = currentUser.display_name || currentUser.name;
            checkOpenBugReports();
            setInterval(checkOpenBugReports, 10000);

            let roleText = '';
            if (currentUser.name === 'xqirby') {
                roleText = 'Master';
                document.getElementById('dropdownRole').className = 'role-tag role-master';
            } else {
                roleText = currentUser.role === 'admin' ? 'Admin' : currentUser.role === 'dev' ? 'Dev' : currentUser.role === 'broadcaster' ? 'Broadcaster' : 'Editor';
                document.getElementById('dropdownRole').className = `role-tag role-${currentUser.role}`;
            }
            document.getElementById('dropdownRole').innerText = roleText;

            const bugNav = document.getElementById('navBugReports');
            if (currentUser.role === 'admin' || currentUser.role === 'dev' || currentUser.role === 'broadcaster') {
                bugNav.style.display = 'flex';
            } else {
                bugNav.style.display = 'none';
            }

            initCustomDropdowns();
            initModalDropdown();

            await loadClips();

            document.getElementById('clipSearch').addEventListener('input', (e) => {
                currentSearchTerm = e.target.value.toLowerCase();
                filterAndRender();
            });

            document.getElementById('clipLink').addEventListener('input', debounce(fetchClipInfo, 1000));

            document.querySelectorAll('.modal').forEach(modal => {
                modal.addEventListener('click', function (e) {
                    if (e.target === modal) {
                        closeModal(modal.id);
                    }
                });
            });

            loadNotifications();
            if (notificationCheckInterval) clearInterval(notificationCheckInterval);
            notificationCheckInterval = setInterval(checkForNewNotifications, 5000);
        } else {
            window.location.href = '/login';
        }
    } catch (e) {
        console.error('Fehler in initApp:', e);
        window.location.href = '/login';
    }
}

function initCustomDropdowns() {
    document.querySelectorAll('.custom-dropdown:not(.modal-dropdown)').forEach(dropdown => {
        const selected = dropdown.querySelector('.dropdown-selected');
        const options = dropdown.querySelectorAll('.dropdown-option');
        selected.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.custom-dropdown').forEach(d => {
                if (d !== dropdown) d.classList.remove('active');
            });
            dropdown.classList.toggle('active');
        });
        options.forEach(opt => {
            opt.addEventListener('click', () => {
                const value = opt.getAttribute('data-value');
                const text = opt.innerText;
                if (dropdown.id === 'partnerFilterDropdown') {
                    currentPartnerFilter = value;
                    selected.innerHTML = `<span>${text}</span>`;
                }
                dropdown.classList.remove('active');
                filterAndRender();
            });
        });
    });
}

function initModalDropdown() {
    const modalDropdown = document.getElementById('modalPartnerDropdown');
    if (!modalDropdown) return;
    const selected = modalDropdown.querySelector('.dropdown-selected');
    const options = modalDropdown.querySelectorAll('.dropdown-option');
    const hiddenInput = document.getElementById('clipPartner');

    selected.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.custom-dropdown').forEach(d => {
            if (d !== modalDropdown) d.classList.remove('active');
        });
        modalDropdown.classList.toggle('active');
    });

    options.forEach(opt => {
        opt.addEventListener('click', () => {
            const value = opt.getAttribute('data-value');
            const text = opt.innerText;
            selected.innerHTML = `<span>${text}</span>`;
            hiddenInput.value = value;
            modalDropdown.classList.remove('active');
        });
    });
}

async function loadClips() {
    try {
        const response = await fetch('/api/clips');
        if (response.status === 401) { window.location.href = '/login'; return; }
        const data = await response.json();
        allClips = data.clips || [];
        filterAndRender();
        highlightClip();
    } catch (e) {
        console.error("Fehler beim Laden der Clips", e);
        document.getElementById('clipListBody').innerHTML = '<tr><td colspan="5" class="empty-message">Fehler beim Laden.</td></tr>';
    }
}

function filterAndRender() {
    let filtered = allClips.filter(clip => {
        if (currentPartnerFilter !== 'all' && clip.partner !== currentPartnerFilter) return false;
        if (currentSearchTerm) {
            const title = (clip.name || '').toLowerCase();
            const slug = (clip.slug || '').toLowerCase();
            if (!title.includes(currentSearchTerm) && !slug.includes(currentSearchTerm)) return false;
        }
        return true;
    });
    filtered.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    renderTable(filtered);
}

function renderTable(clips) {
    const tbody = document.getElementById('clipListBody');
    tbody.innerHTML = '';
    if (clips.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-message">Keine Clips gefunden.</td></tr>';
        return;
    }
    clips.forEach(clip => {
        const date = clip.dateDisplay || (clip.dateAttr ? new Date(clip.dateAttr).toLocaleDateString('de-DE') : '-');
        const views = clip.views || 0;
        const thumbnail = clip.thumbnail || `https://clips-media-assets2.twitch.tv/${clip.slug}.jpg`;
        const row = `<tr class="twitch-row" data-clip-id="${clip.id}">
            <td>
                <div class="clip-info-cell">
                    <div class="clip-thumbnail" onclick="viewClip('${clip.slug}')">
                        <img src="${thumbnail}" alt="" onerror="this.src='https://static-cdn.jtvnw.net/twitch-clips/static/404-480x272.jpg'">
                    </div>
                    <div class="clip-details">
                        <span class="clip-title" onclick="viewClip('${clip.slug}')">${clip.name || clip.slug}</span>
                        <span class="clip-slug">${clip.slug}</span>
                    </div>
                </div>
            </td>
            <td><span class="partner-badge ${clip.partner || 'kein'}">${(clip.partner || 'kein').toUpperCase()}</span></td>
            <td>${date}</td>
            <td>${views.toLocaleString('de-DE')}</td>
            <td style="text-align: right;">
                <div class="action-container">
                    <button class="action-icon btn-copy" onclick="copyClipLink('https://clips.twitch.tv/${clip.slug}')"><i class="fa-solid fa-link"></i></button>
                    <button class="action-icon btn-edit" onclick="editClip('${clip.id}')"><i class="fa-solid fa-pencil"></i></button>
                    <button class="action-icon btn-delete" onclick="openDeleteModal('${clip.id}', '${clip.name || clip.slug}')"><i class="fa-solid fa-trash"></i></button>
                </div>
            </td>
        </tr>`;
        tbody.insertAdjacentHTML('beforeend', row);
    });
}

function highlightClip() {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#highlight=')) {
        const id = hash.substring('#highlight='.length);
        const row = document.querySelector(`.twitch-row[data-clip-id="${id}"]`);
        if (row) {
            row.style.backgroundColor = 'rgba(255, 215, 0, 0.2)';
            row.style.border = '2px solid #ffd700';
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => {
                row.style.backgroundColor = '';
                row.style.border = '';
            }, 3000);
        }
    }
}

function openNewClipModal() {
    currentEditId = null;
    document.getElementById('clipModalTitle').innerText = 'Neuen Clip hinzufügen';
    document.getElementById('clipLink').value = '';
    document.getElementById('clipName').value = '';
    document.getElementById('clipDate').value = '';
    document.getElementById('clipViews').value = '';
    document.getElementById('clipThumbnail').value = '';
    document.getElementById('clipTimestamp').value = '';
    document.getElementById('clipId').value = '';
    document.querySelector('#modalPartnerDropdown .dropdown-selected span').innerText = 'Kein Partner';
    document.getElementById('clipPartner').value = 'kein';
    clearErrors();
    openModal('clipModal');
}

function editClip(id) {
    const clip = allClips.find(c => c.id === id);
    if (!clip) return;
    currentEditId = id;
    document.getElementById('clipModalTitle').innerText = 'Clip bearbeiten';
    document.getElementById('clipLink').value = `https://clips.twitch.tv/${clip.slug}`;
    document.getElementById('clipName').value = clip.name || '';
    const partnerValue = clip.partner || 'kein';
    let partnerText = partnerValue === 'kein' ? 'Kein Partner' : partnerValue.toUpperCase();
    document.querySelector('#modalPartnerDropdown .dropdown-selected span').innerText = partnerText;
    document.getElementById('clipPartner').value = partnerValue;
    if (clip.dateAttr) {
        document.getElementById('clipDate').value = clip.dateAttr;
    } else {
        document.getElementById('clipDate').value = '';
    }
    document.getElementById('clipViews').value = clip.views || 0;
    document.getElementById('clipThumbnail').value = clip.thumbnail || '';
    document.getElementById('clipTimestamp').value = clip.timestamp || '';
    document.getElementById('clipId').value = clip.id;
    clearErrors();
    openModal('clipModal');
}

function clearErrors() {
    document.querySelectorAll('.form-group input, .form-group textarea, .form-group select').forEach(el => {
        el.classList.remove('error');
    });
}

function validateClipForm() {
    let isValid = true;
    const link = document.getElementById('clipLink');
    const name = document.getElementById('clipName');
    const date = document.getElementById('clipDate');
    if (!link.value.trim()) {
        link.classList.add('error');
        isValid = false;
    } else {
        link.classList.remove('error');
    }
    if (!name.value.trim()) {
        name.classList.add('error');
        isValid = false;
    } else {
        name.classList.remove('error');
    }
    if (!date.value) {
        date.classList.add('error');
        isValid = false;
    } else {
        date.classList.remove('error');
    }
    return isValid;
}

function getClipSlug(url) {
    try {
        let slug = url.trim();
        if (slug.includes('/')) {
            slug = slug.split('/').pop().split('?')[0];
        }
        return slug;
    } catch (e) {
        return null;
    }
}

async function fetchClipInfo() {
    const linkInput = document.getElementById('clipLink');
    const slug = getClipSlug(linkInput.value);
    if (!slug) return;
    try {
        const response = await fetch(`/api/clip-info?slug=${encodeURIComponent(slug)}`, {
            headers: { 'X-CSRF-Token': csrfToken }
        });
        if (response.ok) {
            const data = await response.json();
            if (data.name) {
                document.getElementById('clipName').value = data.name;
            }
            if (data.thumbnail) {
                document.getElementById('clipThumbnail').value = data.thumbnail;
            }
            if (data.created_at) {
                const date = new Date(data.created_at);
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                document.getElementById('clipDate').value = `${year}-${month}-${day}`;
                document.getElementById('clipTimestamp').value = data.created_at;
            }
            if (data.view_count !== undefined) {
                document.getElementById('clipViews').value = data.view_count;
            }
        }
    } catch (e) {
        console.error("Fehler beim Abrufen der Clip-Info", e);
    }
}

async function saveClip() {
    if (!validateClipForm()) return;

    const linkInput = document.getElementById('clipLink');
    const slug = getClipSlug(linkInput.value);
    if (!slug) {
        document.getElementById('clipLink').classList.add('error');
        return;
    }

    const clipData = {
        slug: slug,
        name: document.getElementById('clipName').value.trim(),
        partner: document.getElementById('clipPartner').value,
        dateAttr: document.getElementById('clipDate').value,
        dateDisplay: new Date(document.getElementById('clipDate').value).toLocaleDateString('de-DE'),
        views: parseInt(document.getElementById('clipViews').value) || 0,
        thumbnail: document.getElementById('clipThumbnail').value || `https://clips-media-assets2.twitch.tv/${slug}.jpg`,
        timestamp: document.getElementById('clipTimestamp').value || new Date().toISOString()
    };

    try {
        let response;
        if (currentEditId) {
            await fetch(`/api/clips/${currentEditId}`, {
                method: 'DELETE',
                headers: { 'X-CSRF-Token': csrfToken }
            });
        }
        response = await fetch('/api/clips', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
            body: JSON.stringify(clipData)
        });
        if (response.status === 401) { window.location.href = '/login'; return; }
        if (response.ok) {
            closeModal('clipModal');
            await loadClips();
            showToast(currentEditId ? 'Clip aktualisiert.' : 'Clip hinzugefügt.', 2000);
        } else {
            const err = await response.json();
            alert('Fehler: ' + err.error);
        }
    } catch (e) {
        console.error("Fehler beim Speichern", e);
        alert("Fehler beim Speichern: " + e.message);
    }
}

function openDeleteModal(id, name) {
    deleteCandidateId = id;
    document.getElementById('deleteClipName').innerText = name;
    openModal('deleteConfirmModal');
}

async function confirmDeleteClip() {
    if (!deleteCandidateId) return;
    try {
        const response = await fetch(`/api/clips/${deleteCandidateId}`, {
            method: 'DELETE',
            headers: { 'X-CSRF-Token': csrfToken }
        });
        if (response.status === 401) { window.location.href = '/login'; return; }
        if (response.ok) {
            closeModal('deleteConfirmModal');
            await loadClips();
            showToast('Clip gelöscht.', 2000);
        } else {
            const err = await response.json();
            alert('Fehler: ' + err.error);
        }
    } catch (e) {
        console.error("Fehler beim Löschen", e);
        alert("Fehler beim Löschen: " + e.message);
    } finally {
        deleteCandidateId = null;
    }
}

async function updateViews() {
    try {
        const response = await fetch('/api/update-views', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }
        });
        if (response.status === 401) { window.location.href = '/login'; return; }
        if (response.ok) {
            showToast('Aufrufe wurden aktualisiert.', 2000);
            await loadClips();
        } else {
            const err = await response.json();
            alert('Fehler: ' + err.error);
        }
    } catch (e) {
        console.error("Fehler beim Aktualisieren", e);
        alert("Fehler beim Aktualisieren: " + e.message);
    }
}

function viewClip(slug) {
    const player = document.getElementById('clipPlayerIframe');
    player.src = `https://clips.twitch.tv/embed?clip=${slug}&parent=${window.location.hostname}&autoplay=true`;
    openModal('playerModal');
}

function copyClipLink(url) {
    navigator.clipboard.writeText(url);
    showToast('Link kopiert!', 1500);
}

async function loadNotifications() {
    try {
        const response = await fetch('/api/notifications');
        if (response.status === 401) { window.location.href = '/login'; return; }
        const data = await response.json();
        renderNotifications(data.notifications);
        checkUnreadNotifications(data.notifications);
        lastNotificationCount = data.notifications ? data.notifications.length : 0;
    } catch (e) { console.error(e); }
}

async function checkForNewNotifications() {
    try {
        const response = await fetch('/api/notifications');
        if (response.status === 401) { window.location.href = '/login'; return; }
        const data = await response.json();
        const currentCount = data.notifications ? data.notifications.length : 0;
        if (currentCount > lastNotificationCount) triggerNotificationAnimation();
        const dropdown = document.getElementById('notificationDropdown');
        if (!dropdown.classList.contains('show')) renderNotifications(data.notifications);
        checkUnreadNotifications(data.notifications);
        lastNotificationCount = currentCount;
    } catch (e) { console.error(e); }
}

async function checkOpenBugReports() {
    try {
        const response = await fetch('/api/bugreports');
        if (response.status === 401) { window.location.href = '/login'; return; }
        const data = await response.json();
        const openCount = (data.reports || []).filter(r => r.status === 'open').length;
        const badge = document.getElementById('sidebarBugBadge');
        if (badge) badge.classList.toggle('show', openCount > 0);
    } catch (e) { console.error(e); }
}

function renderNotifications(notifications) {
    const dropdown = document.getElementById('notificationDropdown');
    const header = dropdown.querySelector('.dropdown-header');
    while (dropdown.children.length > 1) {
        dropdown.removeChild(dropdown.lastChild);
    }
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
    if (hasUnread) {
        badge.classList.add('show', 'glow');
        if (!animationInterval) startNotificationAnimation();
        document.title = `(${unreadCount}) Fibii Bot · Clips`;
    } else {
        badge.classList.remove('show', 'glow');
        if (animationInterval) clearInterval(animationInterval);
        document.title = 'Fibii Bot · Clips';
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
    bellIcon.classList.add('bell-shake');
    setTimeout(() => bellIcon.classList.remove('bell-shake'), 500);
}

async function markNotificationsAsRead() {
    try {
        await fetch('/api/notifications/read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }
        });
        const badge = document.getElementById('notificationBadge');
        badge.classList.add('badge-fade-out');
        setTimeout(() => {
            badge.classList.remove('show', 'glow', 'badge-fade-out');
        }, 300);
    } catch (e) { console.error(e); }
}

async function submitBugReport() {
    const subject = document.getElementById('bugSubject').value.trim();
    const description = document.getElementById('bugDescription').value.trim();
    if (!subject || !description) {
        if (!subject) document.getElementById('bugSubject').classList.add('error');
        if (!description) document.getElementById('bugDescription').classList.add('error');
        return;
    }
    try {
        const response = await fetch('/api/bugreport', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
            body: JSON.stringify({ subject, description })
        });
        if (response.status === 401) { window.location.href = '/login'; return; }
        if (response.ok) {
            closeModal('bugReportModal');
            showToast('Danke für deine Hilfe! Wir werden dir bald ein Update zum Bug geben.');
            document.getElementById('bugSubject').value = '';
            document.getElementById('bugDescription').value = '';
            document.getElementById('bugSubject').classList.remove('error');
            document.getElementById('bugDescription').classList.remove('error');
        } else {
            const data = await response.json();
            alert('Fehler beim Senden: ' + (data.error || 'Unbekannter Fehler'));
        }
    } catch (e) {
        console.error(e);
        alert('Netzwerkfehler: ' + e.message);
    }
}

function showToast(message, duration = 4000) {
    const toast = document.getElementById('toast');
    document.getElementById('toastMessage').innerText = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), duration);
}

function openModal(id) {
    const modal = document.getElementById(id);
    modal.style.display = 'flex';
    modal.offsetHeight;
    modal.classList.add('show');
}

function closeModal(id) {
    const modal = document.getElementById(id);
    modal.classList.remove('show');
    setTimeout(() => modal.style.display = 'none', 300);
    if (id === 'playerModal') {
        document.getElementById('clipPlayerIframe').src = '';
    }
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

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

document.getElementById('profileBtn')?.addEventListener('click', function(e) {
    e.stopPropagation();
    document.getElementById('profileDropdown').classList.toggle('show');
    document.getElementById('notificationDropdown').classList.remove('show');
});

document.getElementById('notificationBtn')?.addEventListener('click', function(e) {
    e.stopPropagation();
    const dropdown = document.getElementById('notificationDropdown');
    if (!dropdown.classList.contains('show')) {
        markNotificationsAsRead();
    } else {
        loadNotifications();
    }
    dropdown.classList.toggle('show');
    document.getElementById('profileDropdown').classList.remove('show');
});

document.getElementById('bugReportBtn')?.addEventListener('click', () => openModal('bugReportModal'));

window.addEventListener('load', initApp);