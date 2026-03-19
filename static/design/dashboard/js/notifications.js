async function loadNotifications() {
    try {
        const response = await fetch('/api/notifications');
        const data = await response.json();
        renderNotifications(data.notifications);
        checkUnreadNotifications(data.notifications);
        lastNotificationCount = data.notifications ? data.notifications.length : 0;
    } catch (e) {
        console.error(e);
    }
}

async function checkForNewNotifications() {
    try {
        const response = await fetch('/api/notifications');
        const data = await response.json();
        const currentCount = data.notifications ? data.notifications.length : 0;
        if (currentCount > lastNotificationCount) triggerNotificationAnimation();
        const dropdown = document.getElementById('notificationDropdown');
        if (!dropdown || !dropdown.classList.contains('show')) renderNotifications(data.notifications);
        checkUnreadNotifications(data.notifications);
        lastNotificationCount = currentCount;
    } catch (e) {
        console.error(e);
    }
}

function renderNotifications(notifications) {
    const dropdown = document.getElementById('notificationDropdown');
    if (!dropdown) return;
    
    while (dropdown.children.length > 1) dropdown.removeChild(dropdown.lastChild);
    
    const list = document.createElement('div');
    list.id = 'notificationList';
    dropdown.appendChild(list);
    
    if (notifications && notifications.length > 0) {
        notifications.forEach(notif => {
            const date = new Date(notif.timestamp);
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const hour = String(date.getHours()).padStart(2, '0');
            const minute = String(date.getMinutes()).padStart(2, '0');
            const formattedDate = `${day}.${month}, ${hour}:${minute}`;
            
            const item = document.createElement('div');
            item.className = 'notification-item';
            if (!notif.read) item.classList.add('unread');
            
            item.innerHTML = `
                <div class="notification-header">
                    <span>${formattedDate} • ${notif.from_user}</span>
                </div>
                <div class="notification-message">${notif.message}</div>
            `;
            
            if (notif.id) {
                item.addEventListener('click', () => markAsRead(notif.id));
            }
            
            list.appendChild(item);
        });
    } else {
        const empty = document.createElement('div');
        empty.className = 'notification-empty';
        empty.innerText = 'Keine neuen Benachrichtigungen';
        list.appendChild(empty);
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
            document.title = `(${unreadCount}) Fibii Bot · Dashboard`;
        } else {
            badge.classList.remove('show', 'glow');
            if (animationInterval) {
                clearInterval(animationInterval);
                animationInterval = null;
            }
            document.title = 'Fibii Bot · Dashboard';
        }
    }
}

function startNotificationAnimation() {
    if (animationInterval) clearInterval(animationInterval);
    animationInterval = setInterval(() => { if (unreadExists) triggerNotificationAnimation(); }, 5000);
}

function triggerNotificationAnimation() {
    const bellIcon = document.querySelector('#notificationBtn i');
    if (!bellIcon) return;
    bellIcon.classList.add('bell-shake');
    setTimeout(() => { bellIcon.classList.remove('bell-shake'); }, 500);
}

async function markNotificationsAsRead() {
    try {
        await fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken } });
        const badge = document.getElementById('notificationBadge');
        if (badge) {
            badge.classList.add('badge-fade-out');
            setTimeout(() => { badge.classList.remove('show', 'glow', 'badge-fade-out'); }, 300);
        }
    } catch (e) {
        console.error(e);
    }
}

async function markAsRead(id) {
    try {
        await fetch(`/api/notifications/${id}/read`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken } });
        loadNotifications();
    } catch (e) {
        console.error(e);
    }
}