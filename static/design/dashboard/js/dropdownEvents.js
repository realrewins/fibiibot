function replaceWithClone(node) {
    if (!node || !node.parentNode) return node;
    const clone = node.cloneNode(true);
    node.parentNode.replaceChild(clone, node);
    return clone;
}

function closeAll(exceptId) {
    ['profileDropdown', 'notificationDropdown', 'navDropdown'].forEach(id => {
        if (id === exceptId) return;
        const el = document.getElementById(id);
        if (el) el.classList.remove('show');

        if (id === 'profileDropdown') {
            const pb = document.getElementById('profileBtn');
            if (pb) pb.classList.remove('active');
        }
    });
}

function setupHeaderDropdowns() {
    const profileBtnOrig = document.getElementById('profileBtn');
    const notificationBtnOrig = document.getElementById('notificationBtn');
    const menuToggleOrig = document.getElementById('menuToggle');
    const profileBtn = replaceWithClone(profileBtnOrig);
    const notificationBtn = replaceWithClone(notificationBtnOrig);
    const menuToggleBtn = replaceWithClone(menuToggleOrig);

    if (profileBtn) {
        profileBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
            const dropdown = document.getElementById('profileDropdown');
            if (!dropdown) return;

            if (dropdown.classList.contains('show')) {
                dropdown.classList.remove('show');
                profileBtn.classList.remove('active');
            } else {
                closeAll('profileDropdown');
                dropdown.classList.add('show');
                profileBtn.classList.add('active');
                computeAndSet();
            }
        }, false);
    }

    if (notificationBtn) {
        notificationBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
            const dropdown = document.getElementById('notificationDropdown');
            if (!dropdown) return;

            if (dropdown.classList.contains('show')) {
                dropdown.classList.remove('show');
            } else {
                closeAll('notificationDropdown');
                markNotificationsAsRead();
                loadNotifications();
                dropdown.classList.add('show');
                computeAndSet();
            }
        }, false);
    }

    if (menuToggleBtn) {
        menuToggleBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
            const navDropdown = document.getElementById('navDropdown');
            if (!navDropdown) return;
            const menuLottie = document.getElementById('menuLottie');
            const isOpen = navDropdown.classList.contains('show');
            _removeLottieComplete(menuLottie);

            if (isOpen) {
                _addLottieComplete(menuLottie, function () { try { if (menuLottie.pause) menuLottie.pause(); } catch (err) { } _removeLottieComplete(menuLottie); });
                _playLottieReverse(menuLottie, [14, 0]);
                navDropdown.classList.remove('show');
            } else {
                closeAll('navDropdown');
                navDropdown.classList.add('show');
                computeAndSet();
                _addLottieComplete(menuLottie, function () { try { if (menuLottie.pause) menuLottie.pause(); } catch (err) { } _removeLottieComplete(menuLottie); });
                _playLottieForward(menuLottie, [0, 14]);
            }
        }, true);
    }

    document.addEventListener('click', function (e) {
        const target = e.target;
        const profileDropdown = document.getElementById('profileDropdown');
        const notificationDropdown = document.getElementById('notificationDropdown');
        const navDropdown = document.getElementById('navDropdown');
        const menuLottie = document.getElementById('menuLottie');

        if (profileDropdown && profileDropdown.classList.contains('show')) {
            const btn = profileBtn;
            if (!profileDropdown.contains(target) && btn && !btn.contains(target)) {
                profileDropdown.classList.remove('show');
                if (btn) btn.classList.remove('active');
            }
        }

        if (notificationDropdown && notificationDropdown.classList.contains('show')) {
            const btn = notificationBtn;
            if (!notificationDropdown.contains(target) && btn && !btn.contains(target)) {
                notificationDropdown.classList.remove('show');
            }
        }

        if (navDropdown && navDropdown.classList.contains('show')) {
            const btn = menuToggleBtn;
            if (!navDropdown.contains(target) && btn && !btn.contains(target)) {
                _removeLottieComplete(menuLottie);
                _addLottieComplete(menuLottie, function () { try { if (menuLottie.pause) menuLottie.pause(); } catch (err) { } _removeLottieComplete(menuLottie); });
                _playLottieReverse(menuLottie, [14, 0]);
                navDropdown.classList.remove('show');
            }
        }
    }, true);

    observeLayoutChanges();
}