function toggleDropdown(dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;

    const isShowing = dropdown.classList.contains('show');
    const profileBtn = document.querySelector('.profile-button');

    document.querySelectorAll('.glass-dropdown, .dropdown-menu').forEach(d => d.classList.remove('show'));

    if (profileBtn) {
        profileBtn.classList.remove('active');
    }

    if (!isShowing) {
        dropdown.classList.add('show');

        if (dropdownId.toLowerCase().includes('profile') && profileBtn) {
            profileBtn.classList.add('active');
        }

        if (dropdownId === 'notificationDropdown') {
            if (typeof loadNotifications === 'function') {
                loadNotifications();
            }
        }

        if (typeof computeAndSet === 'function') {
            computeAndSet();
        }
    }
}