let currentUser = { name: null, display_name: null, role: 'editor', avatar: '', id: null };
let csrfToken = null;
let unreadExists = false;
let animationInterval = null;
let lastNotificationCount = 0;
let notificationCheckInterval = null;
let allStreams = [];
let currentStreams = [];
let previousStreams = [];
let statsUpdateInterval = null;
let lastValues = {
    watched: '',
    viewers: '',
    followers: '',
    uptime: '',
    percentWatched: '',
    percentViewers: '',
    percentFollowers: '',
    percentUptime: ''
};

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

async function loadStreamStats(animateChanges = false) {
    try {
        const response = await fetch('/api/dashboard/stats');
        if (!response.ok) throw new Error(`HTTP error ${response.status}`);
        const data = await response.json();
        let streamsArray = null;
        if (data && data.streams) {
            if (Array.isArray(data.streams)) {
                streamsArray = data.streams;
            } else if (data.streams.streams && Array.isArray(data.streams.streams)) {
                streamsArray = data.streams.streams;
            }
        }
        if (!streamsArray || streamsArray.length < 28) {
            console.error('Nicht genügend Stream-Daten (mind. 28 erforderlich)', data);
            return;
        }
        const newAllStreams = streamsArray.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        const newCurrentStreams = newAllStreams.slice(0, 14);
        const newPreviousStreams = newAllStreams.slice(14, 28);

        const hasChanged = !currentStreams.length || 
            currentStreams[0].timestamp !== newCurrentStreams[0].timestamp ||
            currentStreams.length !== newCurrentStreams.length;

        allStreams = newAllStreams;
        currentStreams = newCurrentStreams;
        previousStreams = newPreviousStreams;

        renderCharts(currentStreams);

        if (animateChanges && hasChanged) {
            animateAllValues();
        } else if (!animateChanges) {
            updateLastValues();
        }
    } catch (e) {
        console.error('Fehler beim Laden der Stream-Statistiken:', e);
    }
}

function formatLargeNumber(num) {
    if (num === undefined || num === null) return '0';
    const val = Number(num);
    if (val < 1000) {
        return Math.floor(val).toString();
    } else {
        const thousands = val / 1000;
        const rounded = Math.round(thousands * 10) / 10;
        if (Math.abs(rounded - Math.round(rounded)) < 0.01) {
            return Math.round(rounded) + 'k';
        } else {
            return rounded.toFixed(1) + 'k';
        }
    }
}

function formatTime(seconds) {
    if (!seconds || seconds === 0) return '0h 0m';
    const totalMinutes = Math.floor(seconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
}

function formatPercent(value) {
    if (value === null || value === undefined || isNaN(value)) return '';
    const rounded = Math.round(value * 10) / 10;
    const sign = value > 0 ? '+' : '';
    return sign + rounded + '%';
}

function setPercentClass(elementId, value) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.classList.remove('positive', 'negative');
    if (value > 0) {
        el.classList.add('positive');
    } else if (value < 0) {
        el.classList.add('negative');
    }
}

function renderCharts(streams) {
    if (!streams || streams.length === 0) return;

    const charts = [
        { id: 'watched', key: 'watched' },
        { id: 'viewers', key: 'viewers' },
        { id: 'followers', key: 'followers' },
        { id: 'uptime', key: 'uptime' }
    ];

    const MAX_BAR_HEIGHT = 110;

    charts.forEach(c => {
        const container = document.getElementById(`chart-${c.id}`);
        if (!container) return;
        container.innerHTML = '';

        const values = streams.map(s => s[c.key] || 0);
        const max = Math.max(...values) || 1;

        streams.forEach((stream, index) => {
            const val = stream[c.key] || 0;
            const pxHeight = Math.max((val / max) * MAX_BAR_HEIGHT, 4);

            const wrapper = document.createElement('div');
            wrapper.className = 'stat-bar-wrapper';
            wrapper.dataset.index = index;
            wrapper.dataset.cardId = c.id;

            const bar = document.createElement('div');
            bar.className = 'stat-bar';
            bar.style.height = pxHeight + 'px';
            bar.dataset.index = index;
            wrapper.appendChild(bar);

            const hitbox = document.createElement('div');
            hitbox.className = 'stat-bar-hitbox';
            hitbox.style.height = pxHeight + 'px';
            hitbox.dataset.index = index;
            hitbox.dataset.cardId = c.id;
            hitbox.addEventListener('mouseenter', (e) => {
                const idx = parseInt(e.currentTarget.dataset.index);
                const cardId = e.currentTarget.dataset.cardId;
                highlightStream(idx, cardId);
            });
            hitbox.addEventListener('mouseleave', resetHighlights);
            wrapper.appendChild(hitbox);

            container.appendChild(wrapper);
        });
    });
    resetHighlights();
}

function highlightStream(index, cardId) {
    if (!currentStreams[index]) return;
    const stream = currentStreams[index];

    document.getElementById('val-watched').innerText = formatLargeNumber(stream.watched / 60);
    document.getElementById('val-viewers').innerText = formatLargeNumber(stream.viewers);
    document.getElementById('val-followers').innerText = formatLargeNumber(stream.followers);
    document.getElementById('val-uptime').innerText = formatTime(stream.uptime);

    let percentWatched = 0, percentViewers = 0, percentFollowers = 0, percentUptime = 0;
    if (index < currentStreams.length - 1) {
        const prevStream = currentStreams[index + 1];
        percentWatched = ((stream.watched - prevStream.watched) / prevStream.watched) * 100;
        percentViewers = ((stream.viewers - prevStream.viewers) / prevStream.viewers) * 100;
        percentFollowers = ((stream.followers - prevStream.followers) / prevStream.followers) * 100;
        percentUptime = ((stream.uptime - prevStream.uptime) / prevStream.uptime) * 100;
    }

    document.getElementById('percent-watched').innerText = formatPercent(percentWatched);
    document.getElementById('percent-viewers').innerText = formatPercent(percentViewers);
    document.getElementById('percent-followers').innerText = formatPercent(percentFollowers);
    document.getElementById('percent-uptime').innerText = formatPercent(percentUptime);

    setPercentClass('percent-watched', percentWatched);
    setPercentClass('percent-viewers', percentViewers);
    setPercentClass('percent-followers', percentFollowers);
    setPercentClass('percent-uptime', percentUptime);

    const date = new Date(stream.timestamp);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const dateStr = `${day}.${month}.`;

    const dateElements = [
        document.getElementById('stream-date-watched'),
        document.getElementById('stream-date-viewers'),
        document.getElementById('stream-date-followers'),
        document.getElementById('stream-date-uptime')
    ];
    dateElements.forEach(el => {
        if (el) {
            el.textContent = dateStr;
            el.classList.add('date-change');
            setTimeout(() => el.classList.remove('date-change'), 250);
        }
    });

    document.querySelectorAll('.stat-card').forEach(card => {
        card.classList.add('overlay-hidden');
        card.classList.add('card-highlight');
    });

    ['watched', 'viewers', 'followers', 'uptime'].forEach(id => {
        const valueEl = document.getElementById(`val-${id}`);
        if (valueEl) {
            valueEl.classList.add('value-pulse');
        }
    });
    if (window.valuePulseTimeout) clearTimeout(window.valuePulseTimeout);
    window.valuePulseTimeout = setTimeout(() => {
        ['watched', 'viewers', 'followers', 'uptime'].forEach(id => {
            const valueEl = document.getElementById(`val-${id}`);
            if (valueEl) valueEl.classList.remove('value-pulse');
        });
    }, 250);

    document.querySelectorAll('.stat-bar').forEach(bar => {
        if (parseInt(bar.dataset.index) === index) {
            bar.classList.add('active');
            bar.classList.remove('dimmed');
        } else {
            bar.classList.add('dimmed');
            bar.classList.remove('active');
        }
    });
}

function resetHighlights() {
    if (!currentStreams || currentStreams.length === 0) return;

    const totalWatchedCurrent = currentStreams.reduce((sum, s) => sum + (s.watched || 0), 0) / 60;
    const avgViewersCurrent = currentStreams.length ? currentStreams.reduce((sum, s) => sum + (s.viewers || 0), 0) / currentStreams.length : 0;
    const totalFollowersCurrent = currentStreams.reduce((sum, s) => sum + (s.followers || 0), 0);
    const totalUptimeCurrent = currentStreams.reduce((sum, s) => sum + (s.uptime || 0), 0);

    const totalWatchedPrevious = previousStreams.reduce((sum, s) => sum + (s.watched || 0), 0) / 60;
    const avgViewersPrevious = previousStreams.length ? previousStreams.reduce((sum, s) => sum + (s.viewers || 0), 0) / previousStreams.length : 0;
    const totalFollowersPrevious = previousStreams.reduce((sum, s) => sum + (s.followers || 0), 0);
    const totalUptimePrevious = previousStreams.reduce((sum, s) => sum + (s.uptime || 0), 0);

    document.getElementById('val-watched').innerText = formatLargeNumber(totalWatchedCurrent);
    document.getElementById('val-viewers').innerText = formatLargeNumber(avgViewersCurrent);
    document.getElementById('val-followers').innerText = formatLargeNumber(totalFollowersCurrent);
    document.getElementById('val-uptime').innerText = formatTime(totalUptimeCurrent);

    const percentWatched = ((totalWatchedCurrent - totalWatchedPrevious) / totalWatchedPrevious) * 100;
    const percentViewers = ((avgViewersCurrent - avgViewersPrevious) / avgViewersPrevious) * 100;
    const percentFollowers = ((totalFollowersCurrent - totalFollowersPrevious) / totalFollowersPrevious) * 100;
    const percentUptime = ((totalUptimeCurrent - totalUptimePrevious) / totalUptimePrevious) * 100;

    document.getElementById('percent-watched').innerText = formatPercent(percentWatched);
    document.getElementById('percent-viewers').innerText = formatPercent(percentViewers);
    document.getElementById('percent-followers').innerText = formatPercent(percentFollowers);
    document.getElementById('percent-uptime').innerText = formatPercent(percentUptime);

    setPercentClass('percent-watched', percentWatched);
    setPercentClass('percent-viewers', percentViewers);
    setPercentClass('percent-followers', percentFollowers);
    setPercentClass('percent-uptime', percentUptime);

    document.getElementById('stream-date-watched').textContent = '';
    document.getElementById('stream-date-viewers').textContent = '';
    document.getElementById('stream-date-followers').textContent = '';
    document.getElementById('stream-date-uptime').textContent = '';

    document.querySelectorAll('.stat-card').forEach(card => {
        card.classList.remove('overlay-hidden');
        card.classList.remove('card-highlight');
    });

    document.querySelectorAll('.stat-bar').forEach(bar => {
        bar.classList.remove('active', 'dimmed');
    });
}

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

            try {
                await loadStreamStats();
            } catch (e) {
                console.error('Fehler beim initialen Laden der Stream-Daten:', e);
            }

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
                if (currentUser.role === 'admin') roleText = 'Admin';
                else if (currentUser.role === 'dev') roleText = 'Dev';
                else if (currentUser.role === 'broadcaster') roleText = 'Broadcaster';
                else if (currentUser.role === 'editor') roleText = 'Editor';
                else if (currentUser.role === 'viewer') roleText = 'Viewer';
                else roleText = 'Editor';
                document.getElementById('dropdownRole').className = `role-tag role-${currentUser.role}`;
            }
            document.getElementById('dropdownRole').innerText = roleText;

            loadNotifications();
            if (notificationCheckInterval) clearInterval(notificationCheckInterval);
            notificationCheckInterval = setInterval(checkForNewNotifications, 5000);

            startStatsAutoUpdate(30000);
        } else {
            window.location.href = '/login';
        }
        const bugNav = document.getElementById('navBugReports');
        if (currentUser.role === 'admin' || currentUser.role === 'dev' || currentUser.role === 'broadcaster') {
            bugNav.style.display = 'flex';
        } else {
            bugNav.style.display = 'none';
        }
    } catch (e) {
        console.error('Fehler in initApp:', e);
        window.location.href = '/login';
    }
}

function startStatsAutoUpdate(intervalMs = 30000) {
    if (statsUpdateInterval) clearInterval(statsUpdateInterval);
    statsUpdateInterval = setInterval(async () => {
        try {
            await loadStreamStats(true);
        } catch (e) {
            console.error('Fehler im automatischen Update:', e);
        }
    }, intervalMs);
}

function updateLastValues() {
    lastValues.watched = document.getElementById('val-watched').innerText;
    lastValues.viewers = document.getElementById('val-viewers').innerText;
    lastValues.followers = document.getElementById('val-followers').innerText;
    lastValues.uptime = document.getElementById('val-uptime').innerText;
    lastValues.percentWatched = document.getElementById('percent-watched').innerText;
    lastValues.percentViewers = document.getElementById('percent-viewers').innerText;
    lastValues.percentFollowers = document.getElementById('percent-followers').innerText;
    lastValues.percentUptime = document.getElementById('percent-uptime').innerText;
}

function animateAllValues() {
    const totalWatchedCurrent = currentStreams.reduce((sum, s) => sum + (s.watched || 0), 0) / 60;
    const avgViewersCurrent = currentStreams.length ? currentStreams.reduce((sum, s) => sum + (s.viewers || 0), 0) / currentStreams.length : 0;
    const totalFollowersCurrent = currentStreams.reduce((sum, s) => sum + (s.followers || 0), 0);
    const totalUptimeCurrent = currentStreams.reduce((sum, s) => sum + (s.uptime || 0), 0);

    const totalWatchedPrevious = previousStreams.reduce((sum, s) => sum + (s.watched || 0), 0) / 60;
    const avgViewersPrevious = previousStreams.length ? previousStreams.reduce((sum, s) => sum + (s.viewers || 0), 0) / previousStreams.length : 0;
    const totalFollowersPrevious = previousStreams.reduce((sum, s) => sum + (s.followers || 0), 0);
    const totalUptimePrevious = previousStreams.reduce((sum, s) => sum + (s.uptime || 0), 0);

    const newWatched = formatLargeNumber(totalWatchedCurrent);
    const newViewers = formatLargeNumber(avgViewersCurrent);
    const newFollowers = formatLargeNumber(totalFollowersCurrent);
    const newUptime = formatTime(totalUptimeCurrent);

    const newPercentWatched = formatPercent(((totalWatchedCurrent - totalWatchedPrevious) / totalWatchedPrevious) * 100);
    const newPercentViewers = formatPercent(((avgViewersCurrent - avgViewersPrevious) / avgViewersPrevious) * 100);
    const newPercentFollowers = formatPercent(((totalFollowersCurrent - totalFollowersPrevious) / totalFollowersPrevious) * 100);
    const newPercentUptime = formatPercent(((totalUptimeCurrent - totalUptimePrevious) / totalUptimePrevious) * 100);

    animateValueChange('val-watched', newWatched, lastValues.watched);
    animateValueChange('val-viewers', newViewers, lastValues.viewers);
    animateValueChange('val-followers', newFollowers, lastValues.followers);
    animateValueChange('val-uptime', newUptime, lastValues.uptime);
    animateValueChange('percent-watched', newPercentWatched, lastValues.percentWatched);
    animateValueChange('percent-viewers', newPercentViewers, lastValues.percentViewers);
    animateValueChange('percent-followers', newPercentFollowers, lastValues.percentFollowers);
    animateValueChange('percent-uptime', newPercentUptime, lastValues.percentUptime);

    setPercentClass('percent-watched', ((totalWatchedCurrent - totalWatchedPrevious) / totalWatchedPrevious) * 100);
    setPercentClass('percent-viewers', ((avgViewersCurrent - avgViewersPrevious) / avgViewersPrevious) * 100);
    setPercentClass('percent-followers', ((totalFollowersCurrent - totalFollowersPrevious) / totalFollowersPrevious) * 100);
    setPercentClass('percent-uptime', ((totalUptimeCurrent - totalUptimePrevious) / totalUptimePrevious) * 100);

    lastValues.watched = newWatched;
    lastValues.viewers = newViewers;
    lastValues.followers = newFollowers;
    lastValues.uptime = newUptime;
    lastValues.percentWatched = newPercentWatched;
    lastValues.percentViewers = newPercentViewers;
    lastValues.percentFollowers = newPercentFollowers;
    lastValues.percentUptime = newPercentUptime;
}

function animateValueChange(elementId, newValue, oldValue) {
    if (newValue === oldValue) return;
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerText = newValue;
    el.classList.add('flip-animation');
    setTimeout(() => el.classList.remove('flip-animation'), 250);
}

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
        if (currentCount > lastNotificationCount) {
            triggerNotificationAnimation();
        }
        const dropdown = document.getElementById('notificationDropdown');
        if (!dropdown.classList.contains('show')) {
            renderNotifications(data.notifications);
        }
        checkUnreadNotifications(data.notifications);
        lastNotificationCount = currentCount;
    } catch (e) {
        console.error(e);
    }
}

async function checkOpenBugReports() {
    try {
        const response = await fetch('/api/bugreports');
        const data = await response.json();
        const openCount = (data.reports || []).filter(r => r.status === 'open').length;
        const badge = document.getElementById('sidebarBugBadge');
        if (badge) {
            badge.classList.toggle('show', openCount > 0);
        }
    } catch (e) {
        console.error(e);
    }
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
            item.innerHTML = `
                <div class="notification-header">
                    <span>${formattedDate} • ${notif.from_user}</span>
                    ${unreadDot}
                </div>
                <div class="notification-message">${notif.message}</div>
            `;
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
    } catch (e) {
        console.error(e);
    }
}

async function markAsRead(id) {
    try {
        await fetch(`/api/notifications/${id}/read`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            }
        });
        loadNotifications();
    } catch (e) {
        console.error(e);
    }
}

document.getElementById('profileBtn').addEventListener('click', function() {
    const dropdown = document.getElementById('profileDropdown');
    dropdown.classList.toggle('show');
    document.getElementById('notificationDropdown').classList.remove('show');
});

document.getElementById('notificationBtn').addEventListener('click', function() {
    const dropdown = document.getElementById('notificationDropdown');
    if (!dropdown.classList.contains('show')) {
        markNotificationsAsRead();
    } else {
        loadNotifications();
    }
    dropdown.classList.toggle('show');
    document.getElementById('profileDropdown').classList.remove('show');
});

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
        document.body.style.overflow = 'auto';
    }, 300);
}

document.getElementById('bugReportBtn').addEventListener('click', function() {
    openModal('bugReportModal');
    document.body.style.overflow = 'hidden';
});

async function logout() {
    if (statsUpdateInterval) clearInterval(statsUpdateInterval);
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

async function submitBugReport() {
    const subjectInput = document.getElementById('bugSubject');
    const descInput = document.getElementById('bugDescription');
    const subject = subjectInput.value.trim();
    const description = descInput.value.trim();
    let hasError = false;

    subjectInput.classList.remove('input-error');
    descInput.classList.remove('input-error');

    if (!subject) {
        subjectInput.classList.add('input-error');
        hasError = true;
    }
    if (!description) {
        descInput.classList.add('input-error');
        hasError = true;
    }

    if (hasError) {
        setTimeout(() => {
            subjectInput.classList.remove('input-error');
            descInput.classList.remove('input-error');
        }, 3000);
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
        alert('Netzwerkfehler: ' + e.message);
    }
}

function openBugReportWithSuggestion() {
    openModal('bugReportModal');
    setTimeout(() => {
        const subjectField = document.getElementById('bugSubject');
        if (subjectField) {
            subjectField.value = 'Verbesserung: ';
            subjectField.focus();
            subjectField.setSelectionRange(subjectField.value.length, subjectField.value.length);
        }
    }, 100);
}

function showToast(message, duration = 4000) {
    const toast = document.getElementById('toast');
    document.getElementById('toastMessage').innerText = message;

    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}

document.addEventListener('DOMContentLoaded', initApp);