function updateLastValues() {
    const el = id => document.getElementById(id) ? document.getElementById(id).innerText : '';
    lastValues.watched = el('val-watched');
    lastValues.viewers = el('val-viewers');
    lastValues.followers = el('val-followers');
    lastValues.uptime = el('val-uptime');
    lastValues.percentWatched = el('percent-watched');
    lastValues.percentViewers = el('percent-viewers');
    lastValues.percentFollowers = el('percent-followers');
    lastValues.percentUptime = el('percent-uptime');
}

function animateAllValues() {
    const totalWatchedCurrent = currentStreams.reduce((sum, s) => sum + (s.watched || 0), 0) / 60;
    const avgViewersCurrent = currentStreams.length ? currentStreams.reduce((sum, s) => sum + (s.viewers || 0), 0) / currentStreams.length : 0;
    const totalFollowersCurrent = currentStreams.reduce((sum, s) => sum + (s.followers || 0), 0);
    const totalUptimeCurrent = currentStreams.reduce((sum, s) => sum + (s.uptime || 0), 0);
    const totalWatchedPrevious = previousStreams.reduce((sum, s) => sum + (s.watched || 0), 0) / 60;
    const avgViewersPrevious = previousStreams.length ? previousStreams.reduce((sum, s) => sum + (s.viewers || 0), 0) / previousStreams.length : 0;
    const totalFollowersPrevious = previousStreams.reduce((sum, s) => sum + (s.followers || 0), 0);
    const totalUptimePrevious = previousStreams.reduce((sum, s) => sum + (s.uptime || 0), 0);
    const newWatched = formatLargeNumber(totalWatchedCurrent);
    const newViewers = formatLargeNumber(avgViewersCurrent);
    const newFollowers = formatLargeNumber(totalFollowersCurrent);
    const newUptime = formatTime(totalUptimeCurrent);
    const newPercentWatched = formatPercent(((totalWatchedCurrent - totalWatchedPrevious) / Math.max(1, totalWatchedPrevious)) * 100);
    const newPercentViewers = formatPercent(((avgViewersCurrent - avgViewersPrevious) / Math.max(1, avgViewersPrevious)) * 100);
    const newPercentFollowers = formatPercent(((totalFollowersCurrent - totalFollowersPrevious) / Math.max(1, totalFollowersPrevious)) * 100);
    const newPercentUptime = formatPercent(((totalUptimeCurrent - totalUptimePrevious) / Math.max(1, totalUptimePrevious)) * 100);
    animateValueChange('val-watched', newWatched, lastValues.watched);
    animateValueChange('val-viewers', newViewers, lastValues.viewers);
    animateValueChange('val-followers', newFollowers, lastValues.followers);
    animateValueChange('val-uptime', newUptime, lastValues.uptime);
    animateValueChange('percent-watched', newPercentWatched, lastValues.percentWatched);
    animateValueChange('percent-viewers', newPercentViewers, lastValues.percentViewers);
    animateValueChange('percent-followers', newPercentFollowers, lastValues.percentFollowers);
    animateValueChange('percent-uptime', newPercentUptime, lastValues.percentUptime);
    setPercentClass('percent-watched', ((totalWatchedCurrent - totalWatchedPrevious) / Math.max(1, totalWatchedPrevious)) * 100);
    setPercentClass('percent-viewers', ((avgViewersCurrent - avgViewersPrevious) / Math.max(1, avgViewersPrevious)) * 100);
    setPercentClass('percent-followers', ((totalFollowersCurrent - totalFollowersPrevious) / Math.max(1, totalFollowersPrevious)) * 100);
    setPercentClass('percent-uptime', ((totalUptimeCurrent - totalUptimePrevious) / Math.max(1, totalUptimePrevious)) * 100);
    lastValues.watched = newWatched;
    lastValues.viewers = newViewers;
    lastValues.followers = newFollowers;
    lastValues.uptime = newUptime;
    lastValues.percentWatched = newPercentWatched;
    lastValues.percentViewers = newPercentViewers;
    lastValues.percentFollowers = newPercentFollowers;
    lastValues.percentUptime = newPercentUptime;
}

function animateValueChange(elementId, newValue, oldValue) {
    if (newValue === oldValue) return;
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerText = newValue;
    el.classList.add('flip-animation');
    setTimeout(() => el.classList.remove('flip-animation'), 250);
}