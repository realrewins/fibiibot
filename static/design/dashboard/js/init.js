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
                try { await loadStreamStats(); } catch (e) { console.error('Fehler beim initialen Laden der Stream-Daten:', e); }
                window.currentUser = currentUser;
                const profileAvatar = document.getElementById('profileAvatar');
                const dropdownAvatar = document.getElementById('dropdownAvatar');
                const dropdownName = document.getElementById('dropdownName');
                const dropdownRole = document.getElementById('dropdownRole');
                if (profileAvatar) profileAvatar.src = currentUser.avatar;
                if (dropdownAvatar) dropdownAvatar.src = currentUser.avatar;
                if (dropdownName) dropdownName.innerText = currentUser.display_name || currentUser.name;
                if (dropdownRole) {
                    const role = currentUser.role || 'editor';
                    const formattedRole = role.charAt(0).toUpperCase() + role.slice(1);
                    dropdownRole.innerText = formattedRole;
                    dropdownRole.className = `role-tag role-${role}`;
                }
                const bugNav = document.getElementById('navBugReports');
                if (bugNav) bugNav.style.display = 'flex';
                setupHeaderDropdowns();
                computeAndSet();
                adjustHeaderSpaceAndStick();
            } catch (e) {
                console.error('Fehler in initApp:', e);
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