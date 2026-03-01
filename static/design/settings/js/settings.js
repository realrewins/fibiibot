let currentUser = { name: null, display_name: null, role: 'editor', avatar: '', id: null };
let csrfToken = null;
let activeDropdown = null;
let activeDropdownButton = null;
let closeTimeout = null;
let selectedAddRole = 'editor';
let unreadExists = false;
let animationInterval = null;
let lastNotificationCount = 0;
let notificationCheckInterval = null;
let allUsers = [];
let usersWithRoles = [];
let allDropdownItems = [];
let selectedRecipients = [];
let selectedSender = 'user';

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
    if (!e.target.closest('.custom-combobox')) {
        document.getElementById('userDropdown')?.classList.remove('show');
        document.getElementById('senderDropdown')?.classList.remove('show');
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

            document.getElementById('accountName').innerText = currentUser.display_name || currentUser.name;
            document.getElementById('accountImage').src = currentUser.avatar;
            let roleBadgeHtml = '';
            if (currentUser.name === 'xqirby') {
                roleBadgeHtml = `<span class="role-tag role-master"><i class="fas fa-crown"></i> Master</span>`;
            } else {
                let style, label, icon;
                if (currentUser.role === 'admin') {
                    style = 'role-admin'; label = 'Admin'; icon = 'fa-shield-alt';
                } else if (currentUser.role === 'dev') {
                    style = 'role-dev'; label = 'Dev'; icon = 'fa-code';
                } else if (currentUser.role === 'broadcaster') {
                    style = 'role-broadcaster'; label = 'Broadcaster'; icon = 'fa-broadcast-tower';
                } else if (currentUser.role === 'editor') {
                    style = 'role-editor'; label = 'Editor'; icon = 'fa-pencil-alt';
                } else if (currentUser.role === 'viewer') {
                    style = 'role-viewer'; label = 'Viewer'; icon = 'fa-eye';
                } else {
                    style = 'role-editor'; label = 'Editor'; icon = 'fa-pencil-alt';
                }
                roleBadgeHtml = `<span class="role-tag ${style}"><i class="fas ${icon}"></i> ${label}</span>`;
            }
            document.getElementById('accountRoleBadge').innerHTML = roleBadgeHtml;

            const bugNav = document.getElementById('navBugReports');
            if (currentUser.role === 'admin' || currentUser.role === 'dev' || currentUser.role === 'broadcaster') {
                bugNav.style.display = 'flex';
            } else {
                bugNav.style.display = 'none';
            }

            if (currentUser.role === 'viewer' || currentUser.role === 'editor') {
                const roleTab = document.querySelector('.settings-tab[data-tab="roles"]');
                const auditTab = document.querySelector('.settings-tab[data-tab="audit"]');
                const notifTab = document.querySelector('.settings-tab[data-tab="notification"]');
                if (roleTab) roleTab.style.display = 'none';
                if (auditTab) auditTab.style.display = 'none';
                if (notifTab) notifTab.style.display = 'none';
                document.getElementById('panel-roles').style.display = 'none';
                document.getElementById('panel-audit').style.display = 'none';
                document.getElementById('panel-notification').style.display = 'none';
            }

            document.querySelectorAll('.settings-tab').forEach(tab => {
                tab.addEventListener('click', switchSettingsTab);
            });
            switchToTab('account');

            if (currentUser.role !== 'viewer' && currentUser.role !== 'editor') {
                initRoleSelector();
            }

            if (currentUser.role !== 'viewer' && currentUser.role !== 'editor') {
                await loadAllUsers();
                initSenderDropdown();
                initNotificationTab();
            }

            loadNotifications();
            if (notificationCheckInterval) clearInterval(notificationCheckInterval);
            notificationCheckInterval = setInterval(checkForNewNotifications, 5000);
        } else {
            window.location.href = '/login';
        }
    } catch (e) {
        console.error('Fehler in initApp:', e);
    }
}

function getHighestRole(roles) {
    if (!roles || roles.length === 0) return 'editor';
    const hierarchy = { 'admin': 1, 'dev': 1, 'broadcaster': 2, 'editor': 3, 'viewer': 4 };
    let highest = roles[0];
    let highestRank = hierarchy[highest] || 99;
    for (let i = 1; i < roles.length; i++) {
        const rank = hierarchy[roles[i]] || 99;
        if (rank < highestRank) {
            highestRank = rank;
            highest = roles[i];
        }
    }
    return highest;
}

async function loadAllUsers() {
    if (currentUser.role === 'viewer' || currentUser.role === 'editor') return;
    try {
        const response = await fetch('/api/users');
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                console.warn("Keine Berechtigung zum Laden der Benutzer");
                usersWithRoles = [];
                allUsers = [];
                allDropdownItems = [];
                return;
            }
            throw new Error('Fehler beim Laden der User');
        }
        const data = await response.json();
        const users = data.users || [];
        usersWithRoles = users.map(u => {
            let roles = [];
            if (Array.isArray(u.roles)) {
                roles = u.roles;
            } else if (u.role) {
                roles = [u.role];
            } else {
                roles = ['editor'];
            }
            const highest = getHighestRole(roles);
            return {
                username: u.username,
                displayName: u.display_name || u.username,
                roles: roles,
                highestRole: highest
            };
        }).filter(u => u.username);
        usersWithRoles.sort((a, b) => a.username.localeCompare(b.username));
        allUsers = usersWithRoles.map(u => u.username);

        const roleItems = [
            { type: 'role', name: 'admin', displayName: 'Admin', role: 'admin' },
            { type: 'role', name: 'dev', displayName: 'Dev', role: 'dev' },
            { type: 'role', name: 'broadcaster', displayName: 'Broadcaster', role: 'broadcaster' },
            { type: 'role', name: 'editor', displayName: 'Editor', role: 'editor' },
            { type: 'role', name: 'viewer', displayName: 'Viewer', role: 'viewer' }
        ];

        const roleRank = { 'admin': 1, 'dev': 2, 'broadcaster': 3, 'editor': 4, 'viewer': 5 };
        const userItems = usersWithRoles.map(u => ({
            type: 'user',
            name: u.username,
            displayName: u.displayName,
            role: u.highestRole
        }));
        userItems.sort((a, b) => {
            const rankA = roleRank[a.role] || 99;
            const rankB = roleRank[b.role] || 99;
            if (rankA !== rankB) return rankA - rankB;
            return a.displayName.localeCompare(b.displayName);
        });

        allDropdownItems = [
            { type: 'all', name: 'all', displayName: 'Alle Benutzer', role: null },
            { type: 'divider' },
            ...roleItems,
            { type: 'divider' },
            ...userItems
        ];

        populateUserDropdown();
    } catch (e) {
        console.error('Fehler beim Laden der User für Benachrichtigungen', e);
        usersWithRoles = [];
        allUsers = [];
        allDropdownItems = [];
    }
}

function populateUserDropdown(filter = '') {
    const dropdown = document.getElementById('userDropdown');
    if (!dropdown) return;
    dropdown.innerHTML = '';

    const filterLower = filter.toLowerCase();

    if (filterLower === '') {
        allDropdownItems.forEach(item => {
            if (item.type === 'divider') {
                const divider = document.createElement('div');
                divider.className = 'dropdown-divider';
                dropdown.appendChild(divider);
            } else {
                const div = document.createElement('div');
                div.className = 'dropdown-item';
                if (item.type === 'all') {
                    div.innerHTML = `<span class="item-name">${item.displayName}</span>`;
                } else if (item.type === 'role') {
                    const roleClass = `role-tag role-${item.role}`;
                    div.innerHTML = `
                        <span class="item-name">${item.displayName}</span>
                        <span class="${roleClass}">${item.displayName}</span>
                    `;
                } else {
                    const roleClass = `role-tag role-${item.role}`;
                    let roleDisplayName = '';
                    if (item.role === 'admin') roleDisplayName = 'Admin';
                    else if (item.role === 'dev') roleDisplayName = 'Dev';
                    else if (item.role === 'broadcaster') roleDisplayName = 'Broadcaster';
                    else if (item.role === 'editor') roleDisplayName = 'Editor';
                    else if (item.role === 'viewer') roleDisplayName = 'Viewer';
                    else roleDisplayName = 'Editor';
                    div.innerHTML = `
                        <span class="item-name">${item.displayName}</span>
                        <span class="${roleClass}">${roleDisplayName}</span>
                    `;
                }
                div.addEventListener('click', () => {
                    selectRecipient(item);
                    document.getElementById('userSearchInput').value = '';
                    dropdown.classList.remove('show');
                });
                dropdown.appendChild(div);
            }
        });
    } else {
        let filtered = allDropdownItems.filter(item => 
            item.type !== 'divider' && item.displayName.toLowerCase().includes(filterLower)
        );
        filtered.sort((a, b) => {
            if (a.type === 'all') return -1;
            if (b.type === 'all') return 1;
            if (a.type === 'role' && b.type === 'user') return -1;
            if (a.type === 'user' && b.type === 'role') return 1;
            if (a.type === 'role' && b.type === 'role') return a.role.localeCompare(b.role);
            return a.displayName.localeCompare(b.displayName);
        });
        filtered.forEach(item => {
            const div = document.createElement('div');
            div.className = 'dropdown-item';
            if (item.type === 'all') {
                div.innerHTML = `<span class="item-name">${item.displayName}</span>`;
            } else if (item.type === 'role') {
                const roleClass = `role-tag role-${item.role}`;
                div.innerHTML = `
                    <span class="item-name">${item.displayName}</span>
                    <span class="${roleClass}">${item.displayName}</span>
                `;
            } else {
                const roleClass = `role-tag role-${item.role}`;
                let roleDisplayName = '';
                if (item.role === 'admin') roleDisplayName = 'Admin';
                else if (item.role === 'dev') roleDisplayName = 'Dev';
                else if (item.role === 'broadcaster') roleDisplayName = 'Broadcaster';
                else if (item.role === 'editor') roleDisplayName = 'Editor';
                else if (item.role === 'viewer') roleDisplayName = 'Viewer';
                else roleDisplayName = 'Editor';
                div.innerHTML = `
                    <span class="item-name">${item.displayName}</span>
                    <span class="${roleClass}">${roleDisplayName}</span>
                `;
            }
            div.addEventListener('click', () => {
                selectRecipient(item);
                document.getElementById('userSearchInput').value = '';
                dropdown.classList.remove('show');
            });
            dropdown.appendChild(div);
        });
        if (filtered.length === 0) {
            const emptyItem = document.createElement('div');
            emptyItem.className = 'dropdown-item empty';
            emptyItem.textContent = 'Keine Ergebnisse';
            emptyItem.style.cursor = 'default';
            dropdown.appendChild(emptyItem);
        }
    }
}

function updateAddButtonState() {
    const searchInput = document.getElementById('userSearchInput');
    const addBtn = document.getElementById('addRecipientBtn');
    const query = searchInput.value.trim().toLowerCase();
    const isValid = allDropdownItems.some(item => item.type !== 'divider' && item.name.toLowerCase() === query);
    addBtn.disabled = !isValid;
}

function selectRecipient(item) {
    if (item.type === 'all') {
        selectedRecipients = [{ type: 'all', name: 'all', displayName: 'Alle Benutzer' }];
    } else if (item.type === 'role') {
        if (selectedRecipients.some(r => r.type === 'all')) {
            selectedRecipients = [];
        }
        if (!selectedRecipients.some(r => r.type === 'role' && r.name === item.name)) {
            selectedRecipients.push({ type: 'role', name: item.name, displayName: item.displayName, role: item.role });
        }
    } else {
        if (selectedRecipients.some(r => r.type === 'all')) {
            selectedRecipients = [];
        }
        if (!selectedRecipients.some(r => r.type === 'user' && r.name === item.name)) {
            selectedRecipients.push({ type: 'user', name: item.name, displayName: item.displayName, role: item.role });
        }
    }
    updateRecipientChips();
    updateAddButtonState();
}

function updateRecipientChips() {
    const container = document.getElementById('selectedRecipientsContainer');
    container.innerHTML = '';
    selectedRecipients.forEach(rec => {
        const chip = document.createElement('span');
        chip.className = 'recipient-chip';
        if (rec.type === 'all') {
            chip.innerHTML = `👥 Alle Benutzer <button class="remove-chip" onclick="removeRecipient('all', 'all')"><i class="fas fa-times"></i></button>`;
        } else if (rec.type === 'role') {
            chip.classList.add(`role-${rec.role}`);
            chip.innerHTML = `${rec.displayName} <button class="remove-chip" onclick="removeRecipient('role', '${rec.name}')"><i class="fas fa-times"></i></button>`;
        } else {
            chip.innerHTML = `${rec.displayName} <button class="remove-chip" onclick="removeRecipient('user', '${rec.name}')"><i class="fas fa-times"></i></button>`;
        }
        container.appendChild(chip);
    });
}

function removeRecipient(type, name) {
    if (type === 'all') {
        selectedRecipients = [];
    } else {
        selectedRecipients = selectedRecipients.filter(r => !(r.type === type && r.name === name));
    }
    updateRecipientChips();
    updateAddButtonState();
}

function showSendConfirmation() {
    if (selectedRecipients.length === 0) {
        alert('Bitte wähle mindestens einen Empfänger aus.');
        return;
    }

    const message = document.getElementById('messageText').value.trim();
    if (!message) {
        alert('Bitte gib eine Nachricht ein.');
        return;
    }

    const confirmList = document.getElementById('confirmRecipientList');
    confirmList.innerHTML = '';

    let allSelected = false;
    let users = [];
    let roles = [];

    selectedRecipients.forEach(rec => {
        if (rec.type === 'all') {
            allSelected = true;
            const span = document.createElement('span');
            span.className = 'recipient-badge all-badge';
            span.textContent = '👥 Alle Benutzer';
            confirmList.appendChild(span);
        } else if (rec.type === 'role') {
            roles.push(rec.name);
            const span = document.createElement('span');
            span.className = `recipient-badge role-${rec.role}`;
            span.textContent = rec.displayName;
            confirmList.appendChild(span);
        } else {
            users.push(rec.name);
            const span = document.createElement('span');
            span.className = 'recipient-badge';
            span.textContent = rec.displayName;
            confirmList.appendChild(span);
        }
    });

    window.pendingNotification = {
        all: allSelected,
        users: users,
        roles: roles,
        message: message,
        sender: document.getElementById('senderValue').value
    };

    openModal('sendConfirmModal');
}

async function sendNotification() {
    if (!window.pendingNotification) return;

    const { all, users, roles, message, sender } = window.pendingNotification;

    let recipients_type = null;
    let recipients = [];

    if (all) {
        recipients_type = 'all';
        recipients = [];
    } else if (roles && roles.length > 0) {
        recipients_type = 'roles';
        recipients = roles;
    } else {
        recipients_type = 'users';
        recipients = users || [];
    }

    const payload = {
        recipients_type,
        recipients,
        message,
        sender
    };

    try {
        const response = await fetch('/api/notifications/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify(payload)
        });
        if (response.status === 401) { window.location.href = '/login'; return; }
        if (response.ok) {
            const data = await response.json();
            closeModal('sendConfirmModal');
            showToast(`Nachricht an ${data.sent_to} Empfänger gesendet.`, 3000);
            resetNotificationForm();
            window.pendingNotification = null;
        } else {
            const err = await response.json();
            alert('Fehler: ' + (err.error || 'Unbekannter Fehler'));
        }
    } catch (e) {
        console.error('Fehler beim Senden', e);
        alert('Netzwerkfehler: ' + e.message);
    }
}

function resetNotificationForm() {
    selectedRecipients = [];
    document.getElementById('userSearchInput').value = '';
    document.getElementById('messageText').value = '';
    document.getElementById('senderInput').value = '';
    document.getElementById('senderValue').value = 'user';
    updateRecipientChips();
    updateAddButtonState();
    document.getElementById('userDropdown').classList.remove('show');
    document.getElementById('senderDropdown').classList.remove('show');
}

function initNotificationTab() {
    const searchInput = document.getElementById('userSearchInput');
    const dropdown = document.getElementById('userDropdown');
    const addBtn = document.getElementById('addRecipientBtn');

    if (!searchInput || !dropdown || !addBtn) return;

    const newSearch = searchInput.cloneNode(true);
    searchInput.parentNode.replaceChild(newSearch, searchInput);
    const newDropdown = dropdown.cloneNode(true);
    dropdown.parentNode.replaceChild(newDropdown, dropdown);
    const newAddBtn = addBtn.cloneNode(true);
    addBtn.parentNode.replaceChild(newAddBtn, addBtn);

    const finalSearch = document.getElementById('userSearchInput');
    const finalDropdown = document.getElementById('userDropdown');
    const finalAdd = document.getElementById('addRecipientBtn');

    finalSearch.addEventListener('focus', () => {
        populateUserDropdown(finalSearch.value.trim());
        finalDropdown.classList.add('show');
    });

    finalSearch.addEventListener('input', () => {
        populateUserDropdown(finalSearch.value.trim());
        finalDropdown.classList.add('show');
        updateAddButtonState();
    });

    finalAdd.addEventListener('click', () => {
        const query = finalSearch.value.trim().toLowerCase();
        const item = allDropdownItems.find(it => it.type !== 'divider' && it.name.toLowerCase() === query);
        if (item) {
            selectRecipient(item);
            finalSearch.value = '';
            finalDropdown.classList.remove('show');
        }
    });

    document.addEventListener('click', (e) => {
        if (!finalSearch.contains(e.target) && !finalDropdown.contains(e.target)) {
            finalDropdown.classList.remove('show');
        }
    });

    updateAddButtonState();
}

function initSenderDropdown() {
    const senderInput = document.getElementById('senderInput');
    const senderDropdown = document.getElementById('senderDropdown');
    const senderValue = document.getElementById('senderValue');

    if (!senderInput || !senderDropdown || !senderValue) return;

    const newInput = senderInput.cloneNode(true);
    senderInput.parentNode.replaceChild(newInput, senderInput);
    const newDropdown = senderDropdown.cloneNode(true);
    senderDropdown.parentNode.replaceChild(newDropdown, senderDropdown);
    const newValue = senderValue.cloneNode(true);
    senderValue.parentNode.replaceChild(newValue, senderValue);

    const finalInput = document.getElementById('senderInput');
    const finalDropdown = document.getElementById('senderDropdown');
    const finalValue = document.getElementById('senderValue');

    let options = [];
    if (currentUser) {
        options.push({ value: 'user', label: `Ich (${currentUser.display_name || currentUser.name})` });
        if (currentUser.role === 'admin' || currentUser.role === 'dev') {
            options.push({ value: 'admin', label: 'Admin / Dev' });
        }
        options.push({ value: 'server', label: 'Server' });
    }

    const updateDisplay = () => {
        const selected = options.find(opt => opt.value === selectedSender);
        finalInput.value = selected ? selected.label : (options[0]?.label || '');
        finalValue.value = selected ? selected.value : (options[0]?.value || 'user');
    };

    const populate = () => {
        finalDropdown.innerHTML = '';
        options.forEach(opt => {
            const item = document.createElement('div');
            item.className = 'dropdown-item';
            item.textContent = opt.label;
            item.dataset.value = opt.value;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                selectedSender = opt.value;
                updateDisplay();
                finalDropdown.classList.remove('show');
            });
            finalDropdown.appendChild(item);
        });
    };

    finalInput.addEventListener('click', (e) => {
        e.stopPropagation();
        populate();
        finalDropdown.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
        if (!finalInput.contains(e.target) && !finalDropdown.contains(e.target)) {
            finalDropdown.classList.remove('show');
        }
    });

    updateDisplay();
}

function initRoleSelector() {
    const button = document.getElementById('selectedRoleButton');
    if (!button) return;
    button.removeEventListener('click', toggleAddRoleDropdown);
    button.addEventListener('click', toggleAddRoleDropdown);
    updateRoleBadge(selectedAddRole);
}

function updateRoleBadge(role) {
    const badgeSpan = document.getElementById('selectedRoleBadge');
    if (!badgeSpan) return;
    let icon = '';
    let label = '';
    if (role === 'admin') { icon = 'fa-shield-alt'; label = 'Admin'; }
    else if (role === 'dev') { icon = 'fa-code'; label = 'Dev'; }
    else if (role === 'broadcaster') { icon = 'fa-broadcast-tower'; label = 'Broadcaster'; }
    else if (role === 'editor') { icon = 'fa-pencil-alt'; label = 'Editor'; }
    else if (role === 'viewer') { icon = 'fa-eye'; label = 'Viewer'; }
    else { icon = 'fa-pencil-alt'; label = 'Editor'; }
    badgeSpan.innerHTML = `<i class="fas ${icon}"></i> ${label}`;
    badgeSpan.className = `role-badge role-${role}`;
}

function toggleAddRoleDropdown(e) {
    e.stopPropagation();
    const button = document.getElementById('selectedRoleButton');
    if (activeDropdown && activeDropdownButton === button) {
        closeDropdown();
        return;
    }
    if (activeDropdown) {
        closeDropdown();
    }
    const roles = [
        { value: 'admin', label: 'Admin', icon: 'fa-shield-alt', class: 'role-admin' },
        { value: 'dev', label: 'Dev', icon: 'fa-code', class: 'role-dev' },
        { value: 'broadcaster', label: 'Broadcaster', icon: 'fa-broadcast-tower', class: 'role-broadcaster' },
        { value: 'editor', label: 'Editor', icon: 'fa-pencil-alt', class: 'role-editor' },
        { value: 'viewer', label: 'Viewer', icon: 'fa-eye', class: 'role-viewer' }
    ];
    const rect = button.getBoundingClientRect();
    const dropdown = document.createElement('div');
    dropdown.className = 'dropdown-menu';
    dropdown.style.position = 'fixed';
    dropdown.style.top = (rect.bottom + 8) + 'px';
    dropdown.style.left = rect.left + 'px';
    dropdown.style.width = button.offsetWidth + 'px';
    dropdown.style.zIndex = '99999';
    roles.forEach(role => {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        item.innerHTML = `<i class="fas ${role.icon}"></i> <span>${role.label}</span>
                          <span class="role-tag ${role.class}"><i class="fas ${role.icon}"></i> ${role.label}</span>`;
        item.onclick = (e) => {
            e.stopPropagation();
            selectedAddRole = role.value;
            updateRoleBadge(role.value);
            closeDropdown();
        };
        dropdown.appendChild(item);
    });
    document.body.appendChild(dropdown);
    setTimeout(() => dropdown.classList.add('show'), 10);
    activeDropdown = dropdown;
    activeDropdownButton = button;
}

function createDropdown(button, username, existingRoles) {
    if (activeDropdown) {
        closeDropdown();
    }
    const allRoles = ['admin', 'dev', 'broadcaster', 'editor', 'viewer'];
    const availableRoles = allRoles.filter(role => !existingRoles.includes(role));
    if (availableRoles.length === 0) {
        alert('Dieser User besitzt bereits alle möglichen Rollen.');
        return null;
    }
    const rect = button.getBoundingClientRect();
    const dropdown = document.createElement('div');
    dropdown.className = 'dropdown-menu';
    dropdown.style.position = 'fixed';
    dropdown.style.top = (rect.bottom + 8) + 'px';
    dropdown.style.left = rect.left + 'px';
    dropdown.style.zIndex = '99999';
    availableRoles.forEach(role => {
        let icon = '', label = '', cls = '';
        if (role === 'admin') { icon = 'fa-shield-alt'; label = 'Admin'; cls = 'role-admin'; }
        else if (role === 'dev') { icon = 'fa-code'; label = 'Dev'; cls = 'role-dev'; }
        else if (role === 'broadcaster') { icon = 'fa-broadcast-tower'; label = 'Broadcaster'; cls = 'role-broadcaster'; }
        else if (role === 'editor') { icon = 'fa-pencil-alt'; label = 'Editor'; cls = 'role-editor'; }
        else if (role === 'viewer') { icon = 'fa-eye'; label = 'Viewer'; cls = 'role-viewer'; }
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        item.innerHTML = `<i class="fas ${icon}"></i> <span>${label}</span><span class="role-tag ${cls}"><i class="fas ${icon}"></i> ${label}</span>`;
        item.onclick = (e) => {
            e.stopPropagation();
            addRoleToUser(username, role);
            closeDropdown();
        };
        dropdown.appendChild(item);
    });
    document.body.appendChild(dropdown);
    setTimeout(() => dropdown.classList.add('show'), 10);
    activeDropdown = dropdown;
    activeDropdownButton = button;
    return dropdown;
}

async function loadRolesList() {
    if (currentUser.role === 'viewer' || currentUser.role === 'editor') return;
    try {
        const response = await fetch('/api/users');
        const data = await response.json();
        const tbody = document.getElementById('rolesListBody');
        tbody.innerHTML = '';
        let users = Array.isArray(data.users) ? data.users : [];
        const roleHierarchy = { 'admin': 1, 'dev': 1, 'broadcaster': 2, 'editor': 3, 'viewer': 4 };
        users.sort((a, b) => {
            const nameA = (a.username || a.slug || '').toLowerCase();
            const nameB = (b.username || b.slug || '').toLowerCase();
            if (nameA === 'xqirby') return -1;
            if (nameB === 'xqirby') return 1;
            const roleA = getHighestRole(a.roles || [a.role]);
            const roleB = getHighestRole(b.roles || [b.role]);
            const orderA = roleHierarchy[roleA] || 99;
            const orderB = roleHierarchy[roleB] || 99;
            if (orderA !== orderB) return orderA - orderB;
            return nameA.localeCompare(nameB);
        });
        users.forEach(u => {
            const username = u.username || u.slug;
            if (!username) return;
            const isMaster = username.toLowerCase() === 'xqirby';
            const roles = u.roles || (u.role ? [u.role] : ['editor']);
            let roleBadgesHtml = '';
            roles.forEach(role => {
                let label = role === 'admin' ? (isMaster ? 'Master' : 'Admin') : 
                            role === 'dev' ? 'Dev' : 
                            role === 'broadcaster' ? 'Broadcaster' : 
                            role === 'editor' ? 'Editor' : 
                            role === 'viewer' ? 'Viewer' : 'Editor';
                let icon = role === 'admin' ? (isMaster ? 'fa-crown' : 'fa-shield-alt') : 
                           role === 'dev' ? 'fa-code' : 
                           role === 'broadcaster' ? 'fa-broadcast-tower' : 
                           role === 'editor' ? 'fa-pencil-alt' :
                           role === 'viewer' ? 'fa-eye' : 'fa-pencil-alt';
                let cls = role === 'admin' || role === 'dev' ? (role === 'dev' ? 'role-dev' : 'role-admin') : 
                          role === 'broadcaster' ? 'role-broadcaster' : 
                          role === 'editor' ? 'role-editor' :
                          role === 'viewer' ? 'role-viewer' : 'role-editor';
                if (isMaster && role === 'admin') { cls = 'role-master'; icon = 'fa-crown'; }
                let removeBtn = '';
                if (!isMaster || role !== 'admin') {
                    removeBtn = `<button class="role-remove-btn" onclick="removeRoleFromUser('${username}', '${role}'); event.stopPropagation();"><i class="fas fa-times"></i></button>`;
                }
                roleBadgesHtml += `<span class="role-tag ${cls}"><i class="fas ${icon}"></i> ${label} ${removeBtn}</span>`;
            });
            const addButtonId = 'add-' + username + '-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
            const addButton = `<button id="${addButtonId}" class="role-add-btn" data-username="${username}" data-roles='${JSON.stringify(roles)}'>+</button>`;
            const deleteButton = isMaster ?
                `<button class="action-icon" style="cursor:default; background:transparent;" disabled><i class="fas fa-crown"></i></button>` :
                `<button class="action-icon btn-delete" onclick="deleteUser('${username}')"><i class="fas fa-trash-alt"></i></button>`;
            const displayName = u.display_name || username;
            const row = `<tr class="twitch-row">
                <td><div style="display: flex; align-items: center;">@${displayName}</div></td>
                <td><div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px;">${roleBadgesHtml} ${addButton}</div></td>
                <td class="text-right"><div class="action-container">${deleteButton}</div></td>
            </tr>`;
            tbody.insertAdjacentHTML('beforeend', row);
            const btn = document.getElementById(addButtonId);
            if (btn) {
                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const uname = btn.getAttribute('data-username');
                    let existing = [];
                    try {
                        existing = JSON.parse(btn.getAttribute('data-roles'));
                    } catch (err) {}
                    createDropdown(btn, uname, existing);
                };
            }
        });
        if (users.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" class="empty-message">Keine Benutzer</td></tr>`;
        }
    } catch (e) {
        document.getElementById('rolesListBody').innerHTML = `<tr><td colspan="3" class="empty-message">Fehler beim Laden</td></tr>`;
    }
}

async function assignRole() {
    if (currentUser.role === 'viewer' || currentUser.role === 'editor') return;
    const user = document.getElementById('newRoleUser').value.toLowerCase().trim();
    const role = selectedAddRole;
    if (!user) return;
    try {
        await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
            body: JSON.stringify({ username: user, role: role })
        });
        document.getElementById('newRoleUser').value = '';
        loadRolesList();
    } catch (e) {
        alert('Fehler: ' + e.message);
    }
}

async function addRoleToUser(username, role) {
    if (currentUser.role === 'viewer' || currentUser.role === 'editor') return;
    try {
        const response = await fetch(`/api/users/${username}/roles`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
            body: JSON.stringify({ role: role })
        });
        if (response.ok) {
            closeDropdown();
            loadRolesList();
        } else {
            const err = await response.json();
            alert('Fehler: ' + err.error);
        }
    } catch (e) {
        alert('Fehler: ' + e.message);
    }
}

async function removeRoleFromUser(username, role) {
    if (currentUser.role === 'viewer' || currentUser.role === 'editor') return;
    if (username === 'xqirby' && role === 'admin') {
        alert('Master-Rolle kann nicht entfernt werden.');
        return;
    }
    try {
        const response = await fetch(`/api/users/${username}/roles?role=${role}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }
        });
        if (response.ok) loadRolesList();
        else { const err = await response.json(); alert('Fehler: ' + err.error); }
    } catch (e) {
        alert('Fehler: ' + e.message);
    }
}

async function deleteUser(username) {
    if (currentUser.role === 'viewer' || currentUser.role === 'editor') return;
    if (!confirm(`${username} wirklich löschen?`)) return;
    try {
        await fetch(`/api/users/${username}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }
        });
        loadRolesList();
    } catch (e) {
        alert('Fehler: ' + e.message);
    }
}

async function loadAuditLogs() {
    if (currentUser.role === 'viewer' || currentUser.role === 'editor') return;
    try {
        const response = await fetch('/api/audit/logs');
        const data = await response.json();
        const tbody = document.getElementById('auditLogsBody');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (data.logs && data.logs.length > 0) {
            data.logs.forEach(log => {
                const date = new Date(log.timestamp).toLocaleString('de-DE', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', second: '2-digit'
                });
                const statusClass = log.success ? 'role-editor' : 'role-admin';
                const statusText = log.success ? '<i class="fa-solid fa-check"></i> Erfolg' : '<i class="fa-solid fa-x"></i> Fehler';
                const reason = log.reason || (log.success ? 'Login' : 'Nicht whitelisted');
                let usernameDisplay = log.username || '-';
                if (log.link_url && log.link_url.startsWith('https://www.twitch.tv/')) {
                    usernameDisplay = `<a href="${log.link_url}" target="_blank" style="color: #efeff1; text-decoration: none; border-bottom: 1px dashed #9146FF;">${log.username}</a>`;
                }
                let actionButton = '';
                if (log.link_url) {
                    if (log.link_url.startsWith('http')) {
                        actionButton = `<a href="${log.link_url}" target="_blank" class="btn" style="padding: 6px 12px; font-size: 12px; text-decoration: none; display: inline-block;">${log.link_label || 'Öffnen'}</a>`;
                    } else {
                        actionButton = `<a href="${log.link_url}" class="btn" style="padding: 6px 12px; font-size: 12px; text-decoration: none; display: inline-block;">${log.link_label || 'Öffnen'}</a>`;
                    }
                } else if (log.action_type && (log.action_type.startsWith('ROLE_') || log.action_type === 'USER_CREATE' || log.action_type === 'USER_DELETE')) {
                    actionButton = `<button class="btn" style="padding: 6px 12px; font-size: 12px;" onclick="switchToTab('roles')">Rollen öffnen</button>`;
                }
                const row = `<tr class="twitch-row">
                    <td style="white-space: nowrap;">${date}</td>
                    <td>${usernameDisplay}</td>
                    <td>${log.user_id || '-'}</td>
                    <td><span class="role-tag ${statusClass}">${statusText}</span></td>
                    <td>${reason}</td>
                    <td class="text-right">${actionButton}</td>
                </tr>`;
                tbody.insertAdjacentHTML('beforeend', row);
            });
        } else {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-message">Keine Logs vorhanden.</td></tr>';
        }
    } catch (e) {
        console.error("Fehler beim Laden der Audit-Logs", e);
        const tbody = document.getElementById('auditLogsBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="empty-message">Fehler beim Laden.</td></tr>';
    }
}

function refreshAuditLogs() {
    loadAuditLogs();
}

function switchSettingsTab(e) {
    const tab = e.currentTarget;
    const tabId = tab.dataset.tab;
    switchToTab(tabId);
}

function switchToTab(tabId) {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
    const activeTab = document.querySelector(`.settings-tab[data-tab="${tabId}"]`);
    if (activeTab) {
        activeTab.classList.add('active');
        document.getElementById(`panel-${tabId}`).classList.add('active');
    }
    if (tabId === 'roles' && currentUser.role !== 'viewer' && currentUser.role !== 'editor') {
        loadRolesList();
    }
    if (tabId === 'audit' && currentUser.role !== 'viewer' && currentUser.role !== 'editor') {
        loadAuditLogs();
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
        if (response.status === 401) { window.location.href = '/login'; return; }
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
        document.title = `(${unreadCount}) Fibii Bot · Einstellungen`;
    } else {
        badge.classList.remove('show', 'glow');
        if (animationInterval) {
            clearInterval(animationInterval);
            animationInterval = null;
        }
        document.title = 'Fibii Bot · Einstellungen';
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

document.getElementById('bugReportBtn')?.addEventListener('click', function() {
    openModal('bugReportModal');
});

window.addEventListener('load', initApp);