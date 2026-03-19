function setPercentClass(elementId, value) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.classList.remove('positive', 'negative');
    if (value > 0) el.classList.add('positive');
    else if (value < 0) el.classList.add('negative');
}

function showToast(message, duration = 4000) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    const msg = document.getElementById('toastMessage');
    if (msg) msg.innerText = message;
    toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); }, duration);
}