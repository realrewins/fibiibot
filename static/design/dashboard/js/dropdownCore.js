function computeAndSet() {
    const SAFE_VIEWPORT_PADDING = 8;
    const DEFAULT_DROPDOWN_INSET = 0;
    const header = document.querySelector('.dynamic-header');
    const headerLeft = document.querySelector('.header-left');
    const menuToggle = document.getElementById('menuToggle');
    const navDropdown = document.getElementById('navDropdown');
    if (!header || !headerLeft || !menuToggle || !navDropdown) return;

    const dropdownParent = navDropdown.offsetParent || document.documentElement;
    const vpWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const headerRect = header.getBoundingClientRect();
    const dropdownParentRect = dropdownParent.getBoundingClientRect();
    const menuRect = menuToggle.getBoundingClientRect();

    let dropdownLeft = Math.round(headerRect.left - dropdownParentRect.left + DEFAULT_DROPDOWN_INSET);
    dropdownLeft = Math.max(SAFE_VIEWPORT_PADDING, dropdownLeft);

    let ddWidth = navDropdown.offsetWidth;
    if (!ddWidth) {
        const cs = getComputedStyle(navDropdown);
        ddWidth = parseFloat(cs.width) || 280;
    }

    const dropdownViewportLeft = dropdownParentRect.left + dropdownLeft;
    const dropdownViewportRight = dropdownViewportLeft + ddWidth;
    if (dropdownViewportRight > vpWidth - SAFE_VIEWPORT_PADDING) {
        const overflow = dropdownViewportRight - (vpWidth - SAFE_VIEWPORT_PADDING);
        dropdownLeft = Math.max(SAFE_VIEWPORT_PADDING, dropdownLeft - Math.ceil(overflow));
    }

    const menuCenterX = menuRect.left + (menuRect.width / 2);
    let menuIconLeft = Math.round(menuCenterX - dropdownParentRect.left - ((parseInt(getComputedStyle(document.documentElement).getPropertyValue('--menu-icon-width')) || 28) / 2));
    menuIconLeft = Math.max(SAFE_VIEWPORT_PADDING, menuIconLeft);

    document.documentElement.style.setProperty('--dropdown-left', dropdownLeft + 'px');
    document.documentElement.style.setProperty('--menu-icon-left', menuIconLeft + 'px');

    if (navDropdown.offsetWidth && navDropdown.offsetWidth < 280) navDropdown.style.minWidth = '280px';

    function positionLocal(btnSelector, ddSelector, iconSelector = null, align = 'center') {
        const btn = document.querySelector(btnSelector);
        const dd = document.querySelector(ddSelector);
        if (!btn || !dd) return;

        const parent = dd.offsetParent || document.documentElement;
        const parentRect = parent.getBoundingClientRect();
        const btnRect = btn.getBoundingClientRect();

        let centerX;
        if (iconSelector) {
            let icon = btn.querySelector(iconSelector);
            if (!icon) icon = document.querySelector(iconSelector);
            if (icon) {
                const iconRect = icon.getBoundingClientRect();
                centerX = iconRect.left + iconRect.width / 2;
            }
        }
        if (centerX === undefined) centerX = btnRect.left + btnRect.width / 2;

        let ddWidthLocal = dd.offsetWidth;
        if (!ddWidthLocal) {
            const cs = getComputedStyle(dd);
            ddWidthLocal = parseFloat(cs.width) || 280;
        }

        let left;
        if (align === 'center') {
            left = Math.round(centerX - parentRect.left - ddWidthLocal / 2);
        } else if (align === 'right') {
            left = Math.round(centerX - parentRect.left - ddWidthLocal);
        } else if (align === 'left') {
            left = Math.round(centerX - parentRect.left);
        } else {
            left = Math.round(centerX - parentRect.left - ddWidthLocal / 2);
        }

        const maxLeft = Math.max(SAFE_VIEWPORT_PADDING, parentRect.width - ddWidthLocal - SAFE_VIEWPORT_PADDING);
        left = Math.max(SAFE_VIEWPORT_PADDING, Math.min(left, maxLeft));

        dd.style.left = left + 'px';
        dd.style.right = 'auto';
        dd.style.transform = 'translateX(0)';
    }

    positionLocal('#menuToggle', '#navDropdown', 'lottie-player#menuLottie', 'center');
    positionLocal('#notificationBtn', '#notificationDropdown', '.fa-bell', 'right');
    positionLocal('#profileBtn', '#profileDropdown', '.profile-avatar', 'right');
}

function scheduleCompute() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { computeAndSet(); resizeTimer = null; }, 80);
}

function observeLayoutChanges() {
    const header = document.querySelector('.dynamic-header');
    if (!header) return;
    const ro = window.ResizeObserver ? new ResizeObserver(scheduleCompute) : null;
    if (ro) {
        const headerLeft = document.querySelector('.header-left');
        const menuToggle = document.getElementById('menuToggle');
        const navDropdown = document.getElementById('navDropdown');
        try {
            if (header) ro.observe(header);
            if (headerLeft) ro.observe(headerLeft);
            if (menuToggle) ro.observe(menuToggle);
            if (navDropdown) ro.observe(navDropdown);
        } catch (e) { }
    }
    if (window.MutationObserver) {
        const mo = new MutationObserver(scheduleCompute);
        mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
        window.__dashboardDropdownMutationObserver = mo;
    }
}