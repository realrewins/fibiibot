function startStatsAutoUpdate(intervalMs = 30000) {
    if (statsUpdateInterval) clearInterval(statsUpdateInterval);
    statsUpdateInterval = setInterval(async () => {
        try { await loadStreamStats(true); } catch (e) { console.error('Fehler im automatischen Update:', e); }
    }, intervalMs);
}