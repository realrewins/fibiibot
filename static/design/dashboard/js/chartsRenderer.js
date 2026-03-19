async function renderCharts(streams) {
    if (!streams || streams.length === 0) return;
    const charts = [
        { id: 'watched', key: 'watched' },
        { id: 'viewers', key: 'viewers' },
        { id: 'followers', key: 'followers' },
        { id: 'uptime', key: 'uptime' }
    ];
    const MAX_BAR_HEIGHT = 105;

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
            wrapper.style.position = 'relative';

            const bar = document.createElement('div');
            bar.className = 'stat-bar';
            bar.style.height = pxHeight + 'px';
            bar.dataset.index = index;
            wrapper.appendChild(bar);

            const hitbox = document.createElement('div');
            hitbox.className = 'stat-bar-hitbox';
            hitbox.style.bottom = '0';
            hitbox.style.top = 'auto';
            hitbox.style.height = pxHeight + 'px';
            hitbox.dataset.index = index;
            hitbox.dataset.cardId = c.id;

            hitbox.addEventListener('mouseenter', (e) => {
                const idx = parseInt(e.currentTarget.dataset.index);
                highlightStream(idx, c.id);

                const statCard = container.closest('.stat-card');
                if (statCard) statCard.classList.add('bar-active');
                wrapper.classList.add('bar-hovered');
                bar.style.zIndex = '1';
            });

            hitbox.addEventListener('mouseleave', (e) => {
                removeHoverState();
            });

            function removeHoverState() {
                const statCard = container.closest('.stat-card');
                if (statCard) statCard.classList.remove('bar-active');
                wrapper.classList.remove('bar-hovered');
                bar.style.zIndex = '';
                resetHighlights();
            }

            wrapper.appendChild(hitbox);
            container.appendChild(wrapper);
        });

        container.addEventListener('mouseleave', resetHighlights);
    });

    resetHighlights();
}