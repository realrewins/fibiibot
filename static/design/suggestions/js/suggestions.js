let currentUser = { name: null, display_name: null, role: 'editor', avatar: '', id: null };
let csrfToken = null;
let unreadExists = false;
let animationInterval = null;
let lastNotificationCount = 0;
let notificationCheckInterval = null;

let allEntries = [];
let currentStatusFilter = 'all';
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

            await loadBlacklist();

            document.getElementById('nameSearch').addEventListener('input', (e) => {
                currentSearchTerm = e.target.value.toLowerCase();
                filterAndRender();
            });

            document.getElementById('entryName').addEventListener('input', debounce(fetchFollowDate, 1000));

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
                if (dropdown.id === 'typeFilterDropdown') {
                    currentTypeFilter = value;
                    selected.innerHTML = `<span>${text}</span>`;
                } else if (dropdown.id === 'statusFilterDropdown') {
                    currentStatusFilter = value;
                    selected.innerHTML = `<span>${text}</span>`;
                }
                dropdown.classList.remove('active');
                filterAndRender();
            });
        });
    });
}

function initModalDropdown() {
    const modalDropdown = document.getElementById('modalStatusDropdown');
    if (!modalDropdown) return;
    const selected = modalDropdown.querySelector('.dropdown-selected');
    const options = modalDropdown.querySelectorAll('.dropdown-option');
    const hiddenInput = document.getElementById('entryStatus');

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

async function loadBlacklist() {
    try {
        const response = await fetch('/api/blacklist');
        if (response.status === 401) { window.location.href = '/login'; return; }
        const data = await response.json();
        allEntries = data.blacklist || [];
        filterAndRender();
        highlightEntry();
    } catch (e) {
        console.error("Fehler beim Laden der Blacklist", e);
        document.getElementById('listBody').innerHTML = '<tr><td colspan="6" class="empty-message">Fehler beim Laden.</td></tr>';
    }
}

function filterAndRender() {
    let filtered = allEntries.filter(entry => {
        if (currentStatusFilter !== 'all' && entry.status !== currentStatusFilter) return false;
        if (currentSearchTerm && entry.name && !entry.name.toLowerCase().includes(currentSearchTerm)) return false;
        return true;
    });
    const statusOrder = { 'empfehlung': 1, 'ungern': 2, 'blacklist': 3 };
    filtered.sort((a, b) => {
        const orderA = statusOrder[a.status] || 99;
        const orderB = statusOrder[b.status] || 99;
        if (orderA !== orderB) return orderA - orderB;
        return (a.name || '').localeCompare(b.name || '');
    });
    renderTable(filtered);
}

function renderTable(entries) {
    const tbody = document.getElementById('listBody');
    tbody.innerHTML = '';
    if (entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-message">Keine Einträge gefunden.</td></tr>';
        return;
    }
    entries.forEach(entry => {
        const statusMap = {
            'blacklist': 'Blacklisted',
            'ungern': 'Ungern',
            'empfehlung': 'Empfehlung'
        };
        const statusText = statusMap[entry.status] || entry.status;
        const displayName = entry.name || '-';
        const row = `<tr class="twitch-row" data-entry-id="${entry.id}">
            <td style="font-weight: bold; color: #efeff1;">${displayName}</td>
            <td><span class="status-badge ${entry.status}">${statusText}</span></td>
            <td>${entry.follower || '-'}</td>
            <td>${entry.watchtime || '-'}</td>
            <td>${entry.reason || '-'}</td>
            <td style="text-align: right;">
                <button class="action-icon btn-edit" onclick="editBlacklistEntry('${entry.id}')"><i class="fa-solid fa-pencil"></i></button>
                <button class="action-icon btn-delete" onclick="openDeleteModal('${entry.id}', '${entry.name}')"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>`;
        tbody.insertAdjacentHTML('beforeend', row);
    });
}

function highlightEntry() {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#highlight=')) {
        const id = hash.substring('#highlight='.length);
        const row = document.querySelector(`.twitch-row[data-entry-id="${id}"]`);
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

function openNewEntryModal() {
    currentEditId = null;
    document.getElementById('entryModalTitle').innerText = 'Neuer Eintrag';
    document.getElementById('entryName').value = '';
    document.querySelector('#modalStatusDropdown .dropdown-selected span').innerText = 'Blacklisted';
    document.getElementById('entryStatus').value = 'blacklist';
    document.getElementById('entryFollower').value = '';
    document.getElementById('entryWatchtime').value = '';
    document.getElementById('entryReason').value = '';
    clearErrors();
    openModal('entryModal');
}

function editBlacklistEntry(id) {
    const entry = allEntries.find(e => e.id === id);
    if (!entry) return;
    currentEditId = id;
    document.getElementById('entryModalTitle').innerText = 'Eintrag bearbeiten';
    const nameWithoutAt = entry.name.startsWith('@') ? entry.name.substring(1) : entry.name;
    document.getElementById('entryName').value = nameWithoutAt;
    const statusValue = entry.status;
    const statusText = statusValue === 'blacklist' ? 'Blacklisted' : (statusValue === 'ungern' ? 'Ungern' : 'Empfehlung');
    document.querySelector('#modalStatusDropdown .dropdown-selected span').innerText = statusText;
    document.getElementById('entryStatus').value = statusValue;
    document.getElementById('entryFollower').value = entry.follower || '';
    document.getElementById('entryWatchtime').value = entry.watchtime || '';
    document.getElementById('entryReason').value = entry.reason || '';
    clearErrors();
    openModal('entryModal');
}

function clearErrors() {
    document.querySelectorAll('.form-group input, .form-group textarea, .form-group select').forEach(el => {
        el.classList.remove('error');
    });
}

function validateForm() {
    let isValid = true;
    const name = document.getElementById('entryName');
    const reason = document.getElementById('entryReason');
    if (!name.value.trim()) {
        name.classList.add('error');
        isValid = false;
    } else {
        name.classList.remove('error');
    }
    if (!reason.value.trim()) {
        reason.classList.add('error');
        isValid = false;
    } else {
        reason.classList.remove('error');
    }
    return isValid;
}

async function saveEntry() {
    if (!validateForm()) return;

    const nameInput = document.getElementById('entryName');
    const name = nameInput.value.trim().startsWith('@') ? nameInput.value.trim() : '@' + nameInput.value.trim();
    const entryData = {
        name: name,
        status: document.getElementById('entryStatus').value,
        follower: document.getElementById('entryFollower').value.trim() || '-',
        watchtime: document.getElementById('entryWatchtime').value.trim() || '-',
        reason: document.getElementById('entryReason').value.trim() || '-'
    };

    try {
        let response;
        if (currentEditId) {
            response = await fetch(`/api/blacklist/${currentEditId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: JSON.stringify(entryData)
            });
        } else {
            response = await fetch('/api/blacklist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: JSON.stringify(entryData)
            });
        }
        if (response.status === 401) { window.location.href = '/login'; return; }
        if (response.ok) {
            closeModal('entryModal');
            await loadBlacklist();
            showToast(currentEditId ? 'Eintrag aktualisiert.' : 'Eintrag hinzugefügt.', 2000);
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
    document.getElementById('deleteEntryName').innerText = name;
    openModal('deleteConfirmModal');
}

async function confirmDelete() {
    if (!deleteCandidateId) return;
    try {
        const response = await fetch(`/api/blacklist/${deleteCandidateId}`, {
            method: 'DELETE',
            headers: { 'X-CSRF-Token': csrfToken }
        });
        if (response.status === 401) { window.location.href = '/login'; return; }
        if (response.ok) {
            closeModal('deleteConfirmModal');
            await loadBlacklist();
            showToast('Eintrag gelöscht.', 2000);
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

async function fetchFollowDate() {
    const nameInput = document.getElementById('entryName');
    let username = nameInput.value.trim();
    if (!username) return;
    if (username.startsWith('@')) username = username.substring(1);
    const followerField = document.getElementById('entryFollower');
    followerField.placeholder = 'Lade...';
    try {
        const response = await fetch(`/api/twitch/follow-date?username=${encodeURIComponent(username)}`, {
            headers: { 'X-CSRF-Token': csrfToken }
        });
        if (response.status === 401) { window.location.href = '/login'; return; }
        if (response.ok) {
            const data = await response.json();
            followerField.value = data.date || '-';
        } else {
            followerField.value = '-';
        }
    } catch (e) {
        console.error("Fehler beim Abrufen des Follow-Datums", e);
        followerField.value = '-';
    } finally {
        followerField.placeholder = '';
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
        if (!animationInterval) {
            startNotificationAnimation();
        }
        document.title = `(${unreadCount}) Fibii Bot · Blacklist`;
    } else {
        badge.classList.remove('show', 'glow');
        if (animationInterval) {
            clearInterval(animationInterval);
            animationInterval = null;
        }
        document.title = 'Fibii Bot · Blacklist';
    }
}

function startNotificationAnimation() {
    if (animationInterval) clearInterval(animationInterval);
    animationInterval = setInterval(() => {
        if (unreadExists) {
            triggerNotificationAnimation();
        }
    }, 5000);
}

function triggerNotificationAnimation() {
    const bellIcon = document.querySelector('#notificationBtn i');
    bellIcon.classList.add('bell-shake');
    setTimeout(() => {
        bellIcon.classList.remove('bell-shake');
    }, 500);
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
    } catch (e) {
        console.error(e);
    }
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
    setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
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
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
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