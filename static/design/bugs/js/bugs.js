let currentUser = { name: null, display_name: null, role: 'editor', avatar: '', id: null };
let csrfToken = null;
let activeDropdown = null;
let activeDropdownButton = null;
let closeTimeout = null;
let currentUserRole = 'editor';
let currentUserName = '';
let currentCloseBugId = null;
let currentCloseUsername = null;
let lastNotificationCount = 0;
let notificationCheckInterval = null;
let unreadExists = false;
let animationInterval = null;
let allReports = [];
let currentStatusFilter = 'all';
let currentSortFilter = 'newest';
let currentHighlightId = null;

document.addEventListener('click', function(e) {
    if (activeDropdown && activeDropdownButton) {
        if (!activeDropdown.contains(e.target) && e.target !== activeDropdownButton && !activeDropdownButton.contains(e.target)) {
            closeDropdown();
        }
    }
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

function closeDropdown() {
    if (!activeDropdown) return;
    if (closeTimeout) clearTimeout(closeTimeout);
    activeDropdown.classList.remove('show');
    activeDropdown.classList.add('closing');
    closeTimeout = setTimeout(() => {
        if (activeDropdown) {
            activeDropdown.remove();
            activeDropdown = null;
            activeDropdownButton = null;
        }
        closeTimeout = null;
    }, 180);
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
            currentUserRole = currentUser.role;
            currentUserName = currentUser.name;
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
            const hash = window.location.hash;
            if (hash && hash.startsWith('#highlight=')) {
                currentHighlightId = hash.substring('#highlight='.length);
            }
            loadBugReports();
            loadNotifications();
            if (notificationCheckInterval) clearInterval(notificationCheckInterval);
            notificationCheckInterval = setInterval(checkForNewNotifications, 5000);
            document.getElementById('searchInput').addEventListener('input', filterAndRenderReports);
            initCustomDropdowns();
        } else {
            window.location.href = '/login';
        }
    } catch (e) {
        window.location.href = '/login';
    }
}

async function loadBugReports() {
  try {
    const response = await fetch('/api/bugreports');

    // Wenn nicht OK: versuche eine verständliche Meldung zu bauen
    if (!response.ok) {
      if (response.status === 401) {
        // nicht eingeloggt -> login
        window.location.href = '/login';
        return;
      }

      let errText = '';
      try {
        const errJson = await response.json();
        errText = errJson.error || JSON.stringify(errJson);
      } catch {
        errText = await response.text();
      }
      throw new Error(`HTTP ${response.status}: ${errText}`);
    }

    const data = await response.json();
    allReports = data.reports || [];
    filterAndRenderReports();
  } catch (e) {
    console.error('Fehler beim Laden der Bug-Reports', e);
    document.getElementById('bugReportsBody').innerHTML =
      '<tr><td colspan="5" class="empty-message">Fehler beim Laden.</td></tr>';
  }
}

document.getElementById('reloadBugsBtn')?.addEventListener('click', function() {
    loadBugReports();
});

function filterAndRenderReports() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    let filtered = allReports.filter(report => {
        if (currentStatusFilter !== 'all' && report.status !== currentStatusFilter) return false;
        if (searchTerm) {
            const username = (report.display_name || report.username || '').toLowerCase();
            const subject = (report.subject || '').toLowerCase();
            const description = (report.description || '').toLowerCase();
            if (!username.includes(searchTerm) && !subject.includes(searchTerm) && !description.includes(searchTerm)) {
                return false;
            }
        }
        return true;
    });
    filtered.sort((a, b) => {
        const dateA = new Date(a.timestamp);
        const dateB = new Date(b.timestamp);
        if (currentSortFilter === 'newest') {
            return dateB - dateA;
        } else {
            return dateA - dateB;
        }
    });
    if (currentHighlightId) {
        const highlightIndex = filtered.findIndex(r => r.id === currentHighlightId);
        if (highlightIndex !== -1) {
            const highlightItem = filtered[highlightIndex];
            filtered.splice(highlightIndex, 1);
            filtered.unshift(highlightItem);
        }
    }
    renderReports(filtered);
}

function renderReports(reports) {
  const tbody = document.getElementById('bugReportsBody');
  tbody.innerHTML = '';

  if (!Array.isArray(reports) || reports.length === 0) {
    const emptyRow = document.createElement('tr');
    emptyRow.className = 'empty-state-row';
    const emptyCell = document.createElement('td');
    emptyCell.colSpan = 5;
    emptyCell.className = 'empty-row-text';
    emptyCell.textContent = 'Keine Bug-Reports gefunden.';
    emptyRow.appendChild(emptyCell);
    tbody.appendChild(emptyRow);
    return;
  }

  reports.forEach(report => {
    const ts = report?.timestamp ?? Date.now();
    const date = new Date(ts).toLocaleString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    const subject = (report?.subject ?? '').toString();
    const shortSubject = subject.length > 40 ? subject.substring(0, 40) + '…' : (subject || '-');

    const status = report?.status === 'closed' ? 'closed' : 'open';
    const statusBadge = `<span class="status-badge ${status}">${status === 'closed' ? 'Geschlossen' : 'Offen'}</span>`;
    const closedClass = status === 'closed' ? 'is-closed' : '';
    const displayName = report?.display_name || report?.username || '-';
    const id = report?.id ?? '';

    const row = `<tr class="data-row ${closedClass}" data-id="${id}">
        <td>${date}</td>
        <td>${displayName}</td>
        <td>${shortSubject}</td>
        <td>${statusBadge}</td>
        <td class="text-right">
            <button class="btn" style="padding: 0.4rem 1rem; font-size: 0.8rem;" onclick="showBugDetail('${encodeURIComponent(JSON.stringify(report))}')">Details</button>
        </td>
    </tr>`;
    tbody.insertAdjacentHTML('beforeend', row);
  });

  if (currentHighlightId) highlightReport(currentHighlightId);
}

function highlightReport(id) {
    const row = document.querySelector(`.data-row[data-id="${id}"]`);
    if (row) {
        row.classList.add('highlight');
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}
function showBugDetail(reportJson) {
    const report = JSON.parse(decodeURIComponent(reportJson));
    const date = new Date(report.timestamp).toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const isClosed = report.status === 'closed';
    const closeButton = (currentUserRole === 'admin' || currentUserRole === 'dev') && !isClosed 
        ? `<button class="btn" style="background: #ff4a4a; margin-right: auto;" onclick="openCloseTicketModal('${report.id}', '${report.username}')">Ticket schließen</button>` 
        : '';
    const displayName = report.display_name || report.username || '-';
    const html = `
        <p><strong>Zeitpunkt:</strong> ${date}</p>
        <p><strong>Benutzer:</strong> ${displayName}</p>
        <p><strong>Betreff:</strong> ${report.subject}</p>
        <p><strong>Beschreibung:</strong></p>
        <p style="background: #1a1a24; padding: 1rem; border-radius: 1rem; white-space: pre-wrap;">${report.description}</p>
        <p><strong>Status:</strong> ${isClosed ? 'Geschlossen' : 'Offen'}</p>
    `;
    document.getElementById('bugDetailBody').innerHTML = html;
    const footer = document.getElementById('bugDetailFooter');
    footer.innerHTML = closeButton + `<button class="btn" onclick="closeModal('bugDetailModal')">Schließen</button>`;
    openModal('bugDetailModal');
}

function openCloseTicketModal(bugId, username) {
    currentCloseBugId = bugId;
    currentCloseUsername = username;
    document.getElementById('closeMessage').value = '';
    openModal('closeTicketModal');
}

async function submitCloseTicket() {
    const message = document.getElementById('closeMessage').value.trim();
    if (!message) {
        alert('Bitte gib eine Nachricht für den User ein.');
        return;
    }
    try {
        await fetch('/api/bugreply', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({
                target_user: currentCloseUsername,
                message: message,
                bug_id: currentCloseBugId
            })
        });
        await fetch(`/api/bugreport/${currentCloseBugId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({ status: 'closed' })
        });
        closeModal('closeTicketModal');
        closeModal('bugDetailModal');
        loadBugReports();
        showToast('Ticket wurde geschlossen und Benachrichtigung gesendet.');
    } catch (e) {
        console.error('Fehler beim Schließen des Tickets', e);
        alert('Fehler: ' + e.message);
    }
}

async function loadNotifications() {
    try {
        const response = await fetch('/api/notifications');
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
        console.error('Fehler beim Prüfen offener Bug-Reports', e);
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
            item.innerHTML = `<div class="notification-header"><span>${formattedDate} • ${notif.from_user}</span>${unreadDot}</div><div class="notification-message">${notif.message}</div>`;
            dropdown.appendChild(item);
        });
    } else {
        const empty = document.createElement('div');
        empty.className = 'notification-item';
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
        document.title = `(${unreadCount}) Fibii Bot · Bug Reports`;
    } else {
        badge.classList.remove('show', 'glow');
        if (animationInterval) {
            clearInterval(animationInterval);
            animationInterval = null;
        }
        document.title = `Fibii Bot · Bug Reports`;
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
            body: JSON.stringify({ subject, description })
        });
        const data = await response.json();
        if (response.ok) {
            closeModal('bugReportModal');
            showToast('Danke für deine Hilfe! Wir werden dir bald ein Update zum Bug geben.');
            document.getElementById('bugSubject').value = '';
            document.getElementById('bugDescription').value = '';
            loadBugReports();
        } else {
            alert('Fehler beim Senden: ' + (data.error || 'Unbekannter Fehler'));
        }
    } catch (e) {
        console.error('Fehler beim Senden des Bugreports', e);
        alert('Netzwerkfehler: ' + e.message);
    }
}

function showToast(message, duration = 4000) {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    toastMessage.innerText = message;
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

function openSettingsModal() {
    window.location.href = '/';
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

document.getElementById('bugReportBtn')?.addEventListener('click', function(e) {
    e.stopPropagation();
    openModal('bugReportModal');
});

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

window.addEventListener('load', initApp);

function initCustomDropdowns() {
    document.querySelectorAll('.custom-dropdown').forEach(dropdown => {
        const selected = dropdown.querySelector('.dropdown-selected');
        const optionsList = dropdown.querySelectorAll('.dropdown-option');
        selected.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.custom-dropdown').forEach(d => {
                if (d !== dropdown) d.classList.remove('active');
            });
            dropdown.classList.toggle('active');
        });
        optionsList.forEach(option => {
            option.addEventListener('click', () => {
                const value = option.getAttribute('data-value');
                if (dropdown.id === 'statusDropdown') {
                    currentStatusFilter = value;
                    selected.innerHTML = option.innerHTML; 
                } else if (dropdown.id === 'sortDropdown') {
                    currentSortFilter = value;
                    selected.innerText = option.innerText;
                }
                dropdown.classList.remove('active');
                filterAndRenderReports(); 
            });
        });
    });
    document.addEventListener('click', () => {
        document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('active'));
    });
}