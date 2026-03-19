async function logout() {
    if (statsUpdateInterval) clearInterval(statsUpdateInterval);
    try {
        await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken } });
        window.location.href = '/login';
    } catch {
        window.location.href = '/login';
    }
}