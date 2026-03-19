function _removeLottieComplete(el) {
    try {
        if (!el) return;
        if (el._lottieCompleteHandler) {
            try { el.removeEventListener('complete', el._lottieCompleteHandler); } catch (err) { }
            try { const anim = el.getLottie && el.getLottie(); if (anim && anim.removeEventListener) anim.removeEventListener('complete', el._lottieCompleteHandler); } catch (err) { }
            el._lottieCompleteHandler = null;
        }
    } catch (e) { }
}

function _addLottieComplete(el, fn) {
    try {
        if (!el) return;
        _removeLottieComplete(el);
        el._lottieCompleteHandler = fn;
        try { el.addEventListener('complete', fn); } catch (err) { }
        try { const anim = el.getLottie && el.getLottie(); if (anim && anim.addEventListener) anim.addEventListener('complete', fn); } catch (err) { }
    } catch (e) { }
}

function _playLottieForward(el, fromTo = [0, 14]) {
    if (!el) return;
    try {
        if (typeof el.playSegments === 'function') { el.playSegments(fromTo, true); return; }
        const anim = el.getLottie && el.getLottie();
        if (anim && typeof anim.playSegments === 'function') { anim.playSegments(fromTo, true); return; }
        if (typeof el.setDirection === 'function') el.setDirection(1);
        if (typeof el.play === 'function') el.play();
    } catch (e) {
        try { if (typeof el.play === 'function') el.play(); } catch (err) { }
    }
}

function _playLottieReverse(el, fromTo = [14, 0]) {
    if (!el) return;
    try {
        if (typeof el.playSegments === 'function') { el.playSegments(fromTo, true); return; }
        const anim = el.getLottie && el.getLottie();
        if (anim && typeof anim.playSegments === 'function') { anim.playSegments(fromTo, true); return; }
        if (typeof el.setDirection === 'function') el.setDirection(-1);
        if (typeof el.play === 'function') el.play();
    } catch (e) {
        try { if (typeof el.play === 'function') el.play(); } catch (err) { }
    }
}