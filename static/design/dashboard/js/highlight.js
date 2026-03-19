function highlightStream(index, cardId) {
    if (!currentStreams[index]) return;
    const stream = currentStreams[index];
    const watchedEl = document.getElementById('val-watched');
    const viewersEl = document.getElementById('val-viewers');
    const followersEl = document.getElementById('val-followers');
    const uptimeEl = document.getElementById('val-uptime');
    if (watchedEl) watchedEl.innerText = formatLargeNumber(stream.watched / 60);
    if (viewersEl) viewersEl.innerText = formatLargeNumber(stream.viewers);
    if (followersEl) followersEl.innerText = formatLargeNumber(stream.followers);
    if (uptimeEl) uptimeEl.innerText = formatTime(stream.uptime);
    let percentWatched = 0, percentViewers = 0, percentFollowers = 0, percentUptime = 0;
    if (index < currentStreams.length - 1) {
        const prevStream = currentStreams[index + 1];
        if (prevStream && prevStream.watched) percentWatched = ((stream.watched - prevStream.watched) / prevStream.watched) * 100;
        if (prevStream && prevStream.viewers) percentViewers = ((stream.viewers - prevStream.viewers) / prevStream.viewers) * 100;
        if (prevStream && prevStream.followers) percentFollowers = ((stream.followers - prevStream.followers) / prevStream.followers) * 100;
        if (prevStream && prevStream.uptime) percentUptime = ((stream.uptime - prevStream.uptime) / prevStream.uptime) * 100;
    }
    const percentWatchedEl = document.getElementById('percent-watched');
    const percentViewersEl = document.getElementById('percent-viewers');
    const percentFollowersEl = document.getElementById('percent-followers');
    const percentUptimeEl = document.getElementById('percent-uptime');
    if (percentWatchedEl) percentWatchedEl.innerText = formatPercent(percentWatched);
    if (percentViewersEl) percentViewersEl.innerText = formatPercent(percentViewers);
    if (percentFollowersEl) percentFollowersEl.innerText = formatPercent(percentFollowers);
    if (percentUptimeEl) percentUptimeEl.innerText = formatPercent(percentUptime);
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
        if (valueEl) valueEl.classList.add('value-pulse');
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
    const watchedEl = document.getElementById('val-watched');
    const viewersEl = document.getElementById('val-viewers');
    const followersEl = document.getElementById('val-followers');
    const uptimeEl = document.getElementById('val-uptime');
    if (watchedEl) watchedEl.innerText = formatLargeNumber(totalWatchedCurrent);
    if (viewersEl) viewersEl.innerText = formatLargeNumber(avgViewersCurrent);
    if (followersEl) followersEl.innerText = formatLargeNumber(totalFollowersCurrent);
    if (uptimeEl) uptimeEl.innerText = formatTime(totalUptimeCurrent);
    const percentWatched = ((totalWatchedCurrent - totalWatchedPrevious) / Math.max(1, totalWatchedPrevious)) * 100;
    const percentViewers = ((avgViewersCurrent - avgViewersPrevious) / Math.max(1, avgViewersPrevious)) * 100;
    const percentFollowers = ((totalFollowersCurrent - totalFollowersPrevious) / Math.max(1, totalFollowersPrevious)) * 100;
    const percentUptime = ((totalUptimeCurrent - totalUptimePrevious) / Math.max(1, totalUptimePrevious)) * 100;
    const percentWatchedEl = document.getElementById('percent-watched');
    const percentViewersEl = document.getElementById('percent-viewers');
    const percentFollowersEl = document.getElementById('percent-followers');
    const percentUptimeEl = document.getElementById('percent-uptime');
    if (percentWatchedEl) percentWatchedEl.innerText = formatPercent(percentWatched);
    if (percentViewersEl) percentViewersEl.innerText = formatPercent(percentViewers);
    if (percentFollowersEl) percentFollowersEl.innerText = formatPercent(percentFollowers);
    if (percentUptimeEl) percentUptimeEl.innerText = formatPercent(percentUptime);
    setPercentClass('percent-watched', percentWatched);
    setPercentClass('percent-viewers', percentViewers);
    setPercentClass('percent-followers', percentFollowers);
    setPercentClass('percent-uptime', percentUptime);
    const sdw = document.getElementById('stream-date-watched');
    const sdv = document.getElementById('stream-date-viewers');
    const sdf = document.getElementById('stream-date-followers');
    const sdu = document.getElementById('stream-date-uptime');
    if (sdw) sdw.textContent = '';
    if (sdv) sdv.textContent = '';
    if (sdf) sdf.textContent = '';
    if (sdu) sdu.textContent = '';
    document.querySelectorAll('.stat-card').forEach(card => {
        card.classList.remove('overlay-hidden');
        card.classList.remove('card-highlight');
    });
    document.querySelectorAll('.stat-bar').forEach(bar => {
        bar.classList.remove('active', 'dimmed');
    });
}