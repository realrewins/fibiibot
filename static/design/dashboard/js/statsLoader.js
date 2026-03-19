async function loadStreamStats(animateChanges = false) {
    try {
        const response = await fetch('/api/dashboard/stats');
        if (!response.ok) throw new Error(`HTTP error ${response.status}`);
        const data = await response.json();
        let streamsArray = null;
        if (Array.isArray(data)) {
            streamsArray = data;
        } else if (data && data.streams) {
            if (Array.isArray(data.streams)) streamsArray = data.streams;
            else if (data.streams.streams && Array.isArray(data.streams.streams)) streamsArray = data.streams.streams;
        }
        if (!streamsArray || streamsArray.length < 28) {
            console.error('Nicht genügend Stream-Daten (mind. 28 erforderlich)', streamsArray);
            return;
        }
        const newAllStreams = streamsArray.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        const newCurrentStreams = newAllStreams.slice(0, 14);
        const newPreviousStreams = newAllStreams.slice(14, 28);
        const hasChanged = !currentStreams.length ||
            currentStreams[0].timestamp !== newCurrentStreams[0].timestamp ||
            currentStreams.length !== newCurrentStreams.length;
        allStreams = newAllStreams;
        currentStreams = newCurrentStreams;
        previousStreams = newPreviousStreams;
        renderCharts(currentStreams);
        if (animateChanges && hasChanged) animateAllValues();
        else if (!animateChanges) updateLastValues();
    } catch (e) {
        console.error('Fehler beim Laden der Stream-Statistiken:', e);
    }
}