function adjustHeaderSpaceAndStick() {
    const header = document.querySelector('.dynamic-header');
    const mainContent = document.querySelector('.main-content');
    if (!header || !mainContent) return;
    if (initialHeaderTop === null) initialHeaderTop = header.getBoundingClientRect().top;
    const space = header.offsetHeight + Math.max(0, initialHeaderTop);
    mainContent.style.paddingTop = space + 'px';
    if (window.scrollY > initialHeaderTop) header.classList.add('stuck'); else header.classList.remove('stuck');
}

window.addEventListener('resize', () => { setTimeout(adjustHeaderSpaceAndStick, 60); });
window.addEventListener('scroll', adjustHeaderSpaceAndStick);
window.addEventListener('load', adjustHeaderSpaceAndStick);