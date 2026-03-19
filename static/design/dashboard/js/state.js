let unreadExists = false;
let animationInterval = null;
let lastNotificationCount = 0;
let notificationCheckInterval = null;
let allStreams = [];
let currentStreams = [];
let previousStreams = [];
let statsUpdateInterval = null;
let lastValues = {
    watched: '',
    viewers: '',
    followers: '',
    uptime: '',
    percentWatched: '',
    percentViewers: '',
    percentFollowers: '',
    percentUptime: ''
};
let initialHeaderTop = null;
let resizeTimer = null;