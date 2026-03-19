function formatLargeNumber(num) {
    if (num === undefined || num === null) return '0';
    const val = Number(num);
    if (val < 1000) return Math.floor(val).toString();
    const thousands = val / 1000;
    const rounded = Math.round(thousands * 10) / 10;
    if (Math.abs(rounded - Math.round(rounded)) < 0.01) return Math.round(rounded) + 'k';
    return rounded.toFixed(1) + 'k';
}

function formatTime(seconds) {
    if (!seconds || seconds === 0) return '0h 0m';
    const totalMinutes = Math.floor(seconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
}

function formatPercent(value) {
    if (value === null || value === undefined || isNaN(value)) return '';
    const rounded = Math.round(value * 10) / 10;
    const sign = value > 0 ? '+' : '';
    return sign + rounded + '%';
}