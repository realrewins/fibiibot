let currentUser = { name: null, display_name: null, role: 'editor', avatar: '', id: null };
let csrfToken = null;
let unreadExists = false;
let animationInterval = null;
let lastNotificationCount = 0;
let notificationCheckInterval = null;

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
        if (currentCount > lastNotificationCount) {
            triggerNotificationAnimation();
        }
        const dropdown = document.getElementById('notificationDropdown');
        if (!dropdown.classList.contains('show')) {
            renderNotifications(data.notifications);
        }
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
        if (badge) {
            badge.classList.toggle('show', openCount > 0);
        }
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
        document.title = `(${unreadCount}) Fibii Bot · Bot`;
    } else {
        badge.classList.remove('show', 'glow');
        if (animationInterval) {
            clearInterval(animationInterval);
            animationInterval = null;
        }
        document.title = 'Fibii Bot · Bot';
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
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            }
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
        alert('Bitte fülle alle Felder aus.');
        return;
    }

    try {
        const response = await fetch('/api/bugreport', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({
                subject: subject,
                description: description
            })
        });

        const data = await response.json();

        if (response.ok) {
            closeModal('bugReportModal');
            showToast('Danke für deine Hilfe! Wir werden dir bald ein Update zum Bug geben.');
            document.getElementById('bugSubject').value = '';
            document.getElementById('bugDescription').value = '';
        } else {
            alert('Fehler beim Senden: ' + (data.error || 'Unbekannter Fehler (HTTP ' + response.status + ')'));
        }
    } catch (e) {
        console.error('Fehler beim Senden des Bugreports', e);
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
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            }
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

document.getElementById('bugReportBtn')?.addEventListener('click', function() {
    openModal('bugReportModal');
});

window.addEventListener('load', initApp);