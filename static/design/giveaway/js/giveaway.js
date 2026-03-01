let currentUser = { name: null, display_name: null, role: 'editor', avatar: '', id: null };
let csrfToken = null;
let unreadExists = false;
let animationInterval = null;
let lastNotificationCount = 0;
let notificationCheckInterval = null;
let leakProtection = true;

let allGiveaways = [];
let currentTypeFilter = 'all';
let currentStatusFilter = 'all';
let currentSearchTerm = '';

let pendingDeleteId = null;

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

            await loadGiveaways();

            document.getElementById('winnerSearch').addEventListener('input', (e) => {
                currentSearchTerm = e.target.value.toLowerCase();
                filterAndRenderGiveaways();
            });

            document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
                if (pendingDeleteId) {
                    await executeDelete(pendingDeleteId);
                    pendingDeleteId = null;
                    closeModal('confirmDeleteModal');
                }
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
                if (dropdown.id === 'typeFilterDropdown') {
                    currentTypeFilter = value;
                    selected.innerHTML = `<span>${text}</span>`;
                } else if (dropdown.id === 'statusFilterDropdown') {
                    currentStatusFilter = value;
                    selected.innerHTML = `<span>${text}</span>`;
                }
                dropdown.classList.remove('active');
                filterAndRenderGiveaways();
            });
        });
    });
}

function initModalDropdown() {
    const modalDropdown = document.getElementById('modalTypeDropdown');
    if (!modalDropdown) return;
    const selected = modalDropdown.querySelector('.dropdown-selected');
    const options = modalDropdown.querySelectorAll('.dropdown-option');
    const hiddenInput = document.getElementById('newCodeType');
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

async function loadGiveaways() {
    try {
        const response = await fetch('/api/giveaways');
        if (response.status === 401) {
            window.location.href = '/login';
            return;
        }
        const data = await response.json();
        allGiveaways = data.giveaways || [];
        filterAndRenderGiveaways();
    } catch (e) {
        console.error("Fehler beim Laden der Giveaways", e);
        document.getElementById('giveawayListBody').innerHTML = '<tr><td colspan="5" class="empty-message">Fehler beim Laden.</td></tr>';
    }
}

function filterAndRenderGiveaways() {
    let filtered = allGiveaways.filter(g => {
        if (currentTypeFilter !== 'all' && g.type !== currentTypeFilter) return false;
        if (currentStatusFilter === 'open' && g.used) return false;
        if (currentStatusFilter === 'used' && !g.used) return false;
        if (currentSearchTerm && g.winner && !g.winner.toLowerCase().includes(currentSearchTerm)) return false;
        return true;
    });
    renderGiveaways(filtered);
}

async function renderGiveaways(giveaways) {
    const tbody = document.getElementById('giveawayListBody');
    tbody.innerHTML = '';
    let openCount = giveaways.filter(g => !g.used).length;
    document.getElementById('openCodeCount').innerText = openCount;

    if (giveaways.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-message">Keine Einträge gefunden.</td></tr>';
        return;
    }

    giveaways.forEach(g => {
        let badgeClass = 'badge-kein';
        if (g.type.includes("Dominos")) {
            if (g.type === "Dominos 50€") {
                badgeClass = 'badge-dominos50';
            } else {
                badgeClass = 'badge-dominos';
            }
        }
        if (g.type.includes("JBL")) badgeClass = 'badge-jbl';

        let displayContent;
        if (leakProtection) {
            displayContent = '•••••••••••••••••• | PIN: ••••••';
        } else {
            displayContent = `<span class="code-loading" data-id="${g.id}"><i class="fa-solid fa-spinner fa-spin"></i> Laden...</span>`;
        }

        const opacity = g.used ? '0.5' : '1';
        const statusText = g.used ? 'Vergeben' : 'Offen';
        const checked = g.used ? 'checked' : '';
        const buttonClass = g.used ? 'disabled-btn' : '';
        const buttonDisabled = g.used ? 'disabled' : '';

        const row = document.createElement('tr');
        row.className = 'twitch-row';
        row.setAttribute('data-giveaway-id', g.id);
        row.style.opacity = opacity;
        row.innerHTML = `
            <td><span class="partner-badge ${badgeClass}"><i class="fa-solid fa-tag"></i> ${g.type}</span></td>
            <td class="code-cell" data-id="${g.id}" style="font-family: monospace; color: #707088;">${displayContent}</td>
            <td><input type="text" class="winner-input" placeholder="@Name" value="${g.winner || ''}" onchange="updateGiveawayWinner('${g.id}', this.value)"></td>
            <td><label class="checkbox-container"><input type="checkbox" ${checked} onchange="toggleGiveawayUsed('${g.id}', this.checked)"><span class="checkmark"></span> <span style="color:${g.used ? '#3acf6b' : '#a8a8c0'}; font-weight:${g.used ? 'bold' : 'normal'}">${statusText}</span></label></td>
            <td style="text-align: right;">
                <button class="btn-copy-small ${buttonClass}" onclick="copyCodeOnly('${g.id}')" ${buttonDisabled}><i class="fa-solid fa-list"></i> Code</button>
                <button class="btn-copy-full ${buttonClass}" onclick="copyFullInstructions('${g.id}')" ${buttonDisabled}><i class="fa-regular fa-clipboard"></i> Anleitung</button>
                <button class="action-icon btn-delete ${buttonClass}" onclick="promptDelete('${g.id}')" ${buttonDisabled}><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(row);
    });

    if (!leakProtection) {
        loadAllCodesAutomatically();
    }

    highlightGiveaway();
}

async function loadAllCodesAutomatically() {
    const loadingSpans = document.querySelectorAll('.code-loading');
    if (loadingSpans.length === 0) return;
    const promises = Array.from(loadingSpans).map(async span => {
        const id = span.dataset.id;
        try {
            const data = await fetchCode(id);
            if (data) {
                const cell = span.closest('.code-cell');
                cell.innerHTML = `${data.code} | PIN: ${data.pin}`;
                cell.style.color = '#f0f0f0';
            }
        } catch (e) {
            console.warn(`Fehler beim Laden von Code ${id}`, e);
        }
    });
    await Promise.allSettled(promises);
}

async function fetchCode(id) {
    const response = await fetch(`/api/giveaways/${id}/code?csrf_token=${encodeURIComponent(csrfToken)}`, {
        method: 'GET',
        headers: { 'X-CSRF-Token': csrfToken }
    });
    if (response.status === 401) { window.location.href = '/login'; return null; }
    if (response.ok) {
        return await response.json();
    }
    return null;
}

function highlightGiveaway() {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#highlight=')) {
        const id = hash.substring('#highlight='.length);
        const row = document.querySelector(`.twitch-row[data-giveaway-id="${id}"]`);
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

async function copyCodeOnly(id) {
    const data = await fetchCode(id);
    if (data) {
        navigator.clipboard.writeText(`Code: ${data.code} | PIN: ${data.pin}`);
        showToast('Code kopiert!', 2000);
    }
}

async function copyFullInstructions(id) {
    const data = await fetchCode(id);
    if (data) {
        const text = `${data.type} | Code: ${data.code} | PIN: ${data.pin} | Am Ende des Bestellvorgangs unter Zahlungsmethode, kannst du deinen Gutschein unter dem Punkt „Gutscheinkarte" einlösen.`;
        navigator.clipboard.writeText(text);
        showToast('Code mit Anleitung kopiert!', 2000);
    }
}

async function addGiveawayCode() {
    const code = document.getElementById('newCodeValue').value.trim();
    const pin = document.getElementById('newCodePin').value.trim();
    const type = document.getElementById('newCodeType').value;
    if (!code || !pin) {
        highlightEmptyFields();
        return;
    }
    const giveawayData = { type, code, pin, winner: "", used: false };
    try {
        const response = await fetch('/api/giveaways', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
            body: JSON.stringify(giveawayData)
        });
        if (response.status === 401) { window.location.href = '/login'; return; }
        if (response.ok) {
            document.getElementById('newCodeValue').value = "";
            document.getElementById('newCodePin').value = "";
            document.querySelector('#modalTypeDropdown .dropdown-selected span').innerText = 'Dominos 20€';
            document.getElementById('newCodeType').value = 'Dominos 20€';
            closeModal('addCodeModal');
            await loadGiveaways();
            showToast('Code hinzugefügt!', 2000);
        } else {
            const err = await response.json();
            alert('Fehler: ' + err.error);
        }
    } catch (e) {
        console.error("Fehler beim Hinzufügen", e);
        alert("Fehler beim Hinzufügen: " + e.message);
    }
}

async function toggleGiveawayUsed(docId, isChecked) {
    try {
        const row = document.querySelector(`.twitch-row[data-giveaway-id="${docId}"]`);
        if (!row) return;

        const statusSpan = row.querySelector('.checkbox-container span:last-child');
        statusSpan.textContent = isChecked ? 'Vergeben' : 'Offen';
        statusSpan.style.color = isChecked ? '#3acf6b' : '#a8a8c0';
        statusSpan.style.fontWeight = isChecked ? 'bold' : 'normal';

        row.style.opacity = isChecked ? '0.5' : '1';

        const buttons = row.querySelectorAll('td:last-child button');
        buttons.forEach(btn => {
            if (isChecked) {
                btn.classList.add('disabled-btn');
                btn.disabled = true;
            } else {
                btn.classList.remove('disabled-btn');
                btn.disabled = false;
            }
        });

        const openCountElement = document.getElementById('openCodeCount');
        let currentCount = parseInt(openCountElement.textContent) || 0;
        openCountElement.textContent = isChecked ? Math.max(0, currentCount - 1) : currentCount + 1;

        const response = await fetch(`/api/giveaways/${docId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
            body: JSON.stringify({ used: isChecked })
        });
        if (response.status === 401) { window.location.href = '/login'; return; }
        if (!response.ok) {
            throw new Error('Speichern fehlgeschlagen');
        }
        await loadGiveaways();
    } catch (e) {
        console.error("Fehler beim Aktualisieren", e);
        alert("Fehler: " + e.message);
        loadGiveaways();
    }
}

async function updateGiveawayWinner(docId, newName) {
    try {
        await fetch(`/api/giveaways/${docId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
            body: JSON.stringify({ winner: newName })
        });
    } catch (e) {
        console.error("Fehler beim Aktualisieren", e);
    }
}

function promptDelete(id) {
    const row = document.querySelector(`.twitch-row[data-giveaway-id="${id}"]`);
    if (row && row.querySelector('.checkbox-container input').checked) {
        showToast('Vergebene Codes können nicht gelöscht werden!', 3000);
        return;
    }
    pendingDeleteId = id;
    openModal('confirmDeleteModal');
}

async function executeDelete(id) {
    try {
        const response = await fetch(`/api/giveaways/${id}`, {
            method: 'DELETE',
            headers: { 'X-CSRF-Token': csrfToken }
        });
        if (response.status === 401) { window.location.href = '/login'; return; }
        if (response.ok) {
            await loadGiveaways();
            showToast('Code gelöscht.', 2000);
        } else {
            const err = await response.json();
            alert('Fehler: ' + err.error);
        }
    } catch (e) {
        console.error("Fehler beim Löschen", e);
        alert("Fehler beim Löschen: " + e.message);
    }
}

async function toggleLeakProtection() {
    try {
        if (currentUser.role === 'broadcaster') {
            alert("🔒 Sicherheit: Als Broadcaster ist der Leakschutz dauerhaft aktiviert.");
            return;
        }
        if (currentUser.role === 'admin' || currentUser.role === 'dev') {
            leakProtection = !leakProtection;
            const banner = document.getElementById('leakProtectionBanner');
            const btn = banner.querySelector('button');
            const txt = banner.querySelector('span');
            if (leakProtection) {
                banner.className = 'leak-banner active';
                txt.innerHTML = '<i class="fa-solid fa-shield"></i> Leakschutz aktiv!';
                btn.innerHTML = '<i class="fa-solid fa-eye"></i> Anzeigen';
            } else {
                banner.className = 'leak-banner inactive';
                txt.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ACHTUNG: Codes sichtbar!';
                btn.innerHTML = '<i class="fa-solid fa-lock"></i> Verstecken';
            }
            await fetch('/api/leak_protection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: JSON.stringify({ state: leakProtection })
            });
            await loadGiveaways();
        } else {
            alert("Keine Berechtigung. Nur Admins/Devs können den Leakschutz ändern.");
        }
    } catch (e) {
        console.error("Fehler beim Umschalten", e);
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
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
            body: JSON.stringify({ subject, description })
        });
        if (response.status === 401) { window.location.href = '/login'; return; }
        if (response.ok) {
            closeModal('bugReportModal');
            showToast('Danke für deine Hilfe! Wir werden dir bald ein Update zum Bug geben.');
            subjectInput.value = '';
            descInput.value = '';
        } else {
            const data = await response.json();
            alert('Fehler beim Senden: ' + (data.error || 'Unbekannter Fehler'));
        }
    } catch (e) {
        console.error(e);
        alert('Netzwerkfehler: ' + e.message);
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
    while (dropdown.children.length > 1) dropdown.removeChild(dropdown.lastChild);
    if (notifications && notifications.length > 0) {
        notifications.forEach(notif => {
            const date = new Date(notif.timestamp);
            const formattedDate = `${String(date.getDate()).padStart(2,'0')}.${String(date.getMonth()+1).padStart(2,'0')}, ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
            const unreadDot = !notif.read ? '<span class="unread-dot"></span>' : '';
            const item = document.createElement('div');
            item.className = 'notification-item';
            item.innerHTML = `<div class="notification-header"><span>${formattedDate} • ${notif.from_user}</span>${unreadDot}</div><div class="notification-message">${notif.message}</div>`;
            dropdown.appendChild(item);
        });
    } else {
        dropdown.innerHTML += '<div class="notification-item" style="justify-content:center; color:var(--text-muted);">Keine neuen Benachrichtigungen</div>';
    }
}
function checkUnreadNotifications(notifications) {
    const unreadCount = notifications ? notifications.filter(n => !n.read).length : 0;
    const badge = document.getElementById('notificationBadge');
    unreadExists = unreadCount > 0;
    if (unreadExists) {
        badge.classList.add('show', 'glow');
        if (!animationInterval) startNotificationAnimation();
        document.title = `(${unreadCount}) Fibii Bot · Giveaway`;
    } else {
        badge.classList.remove('show', 'glow');
        if (animationInterval) clearInterval(animationInterval);
        document.title = 'Fibii Bot · Giveaway';
    }
}
function startNotificationAnimation() {
    if (animationInterval) clearInterval(animationInterval);
    animationInterval = setInterval(() => { if (unreadExists) triggerNotificationAnimation(); }, 5000);
}
function triggerNotificationAnimation() {
    const bellIcon = document.querySelector('#notificationBtn i');
    bellIcon.classList.add('bell-shake');
    setTimeout(() => bellIcon.classList.remove('bell-shake'), 500);
}
async function markNotificationsAsRead() {
    try {
        await fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken } });
        const badge = document.getElementById('notificationBadge');
        badge.classList.add('badge-fade-out');
        setTimeout(() => badge.classList.remove('show', 'glow', 'badge-fade-out'), 300);
    } catch (e) { console.error(e); }
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
}
async function logout() {
    try {
        await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken } });
        window.location.href = '/login';
    } catch { window.location.href = '/login'; }
}

document.getElementById('profileBtn')?.addEventListener('click', function(e) {
    e.stopPropagation();
    document.getElementById('profileDropdown').classList.toggle('show');
    document.getElementById('notificationDropdown').classList.remove('show');
});
document.getElementById('notificationBtn')?.addEventListener('click', function(e) {
    e.stopPropagation();
    const dropdown = document.getElementById('notificationDropdown');
    if (!dropdown.classList.contains('show')) markNotificationsAsRead();
    else loadNotifications();
    dropdown.classList.toggle('show');
    document.getElementById('profileDropdown').classList.remove('show');
});
document.getElementById('bugReportBtn')?.addEventListener('click', () => openModal('bugReportModal'));

window.addEventListener('load', initApp);