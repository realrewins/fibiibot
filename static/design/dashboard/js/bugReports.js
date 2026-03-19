async function checkOpenBugReports() {
    try {
        const response = await fetch('/api/bugreports');
        const data = await response.json();
        const openCount = (data.reports || []).filter(r => r.status === 'open').length;
        const badge = document.getElementById('sidebarBugBadge');
        if (badge) badge.classList.toggle('show', openCount > 0);
    } catch (e) {
        console.error(e);
    }
}

async function submitBugReport() {
    const subjectInput = document.getElementById('bugSubject');
    const descInput = document.getElementById('bugDescription');
    if (!subjectInput || !descInput) return;
    const subject = subjectInput.value.trim();
    const description = descInput.value.trim();
    let hasError = false;
    subjectInput.classList.remove('input-error');
    descInput.classList.remove('input-error');
    if (!subject) { subjectInput.classList.add('input-error'); hasError = true; }
    if (!description) { descInput.classList.add('input-error'); hasError = true; }
    if (hasError) { setTimeout(() => { subjectInput.classList.remove('input-error'); descInput.classList.remove('input-error'); }, 3000); return; }
    try {
        const response = await fetch('/api/bugreport', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ subject: subject, description: description }) });
        const data = await response.json();
        if (response.ok) {
            closeModal('bugReportModal');
            showToast('Danke für deine Hilfe! Wir werden dir bald ein Update zum Bug geben.');
            document.getElementById('bugSubject').value = '';
            document.getElementById('bugDescription').value = '';
        } else {
            alert('Fehler beim Senden: ' + (data.error || 'Unbekannter Fehler (HTTP ' + response.status + ')'));
        }
    } catch (e) {
        alert('Netzwerkfehler: ' + e.message);
    }
}

function openBugReportWithSuggestion() {
    openModal('bugReportModal');
    setTimeout(() => {
        const subjectField = document.getElementById('bugSubject');
        if (subjectField) {
            subjectField.value = 'Verbesserung: ';
            subjectField.focus();
            subjectField.setSelectionRange(subjectField.value.length, subjectField.value.length);
        }
    }, 100);
}