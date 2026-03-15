import os
import time
import subprocess
import sys
import signal
import json
import shutil
import requests
import threading
from datetime import datetime, timezone

CHANNEL = "fibii"
BASE_DIR = "/srv/fibiibot"
VOD_DIR = os.path.join(BASE_DIR, "vod")
LOG_DIR = os.path.join(BASE_DIR, "logs")
LIVE_CHECK_INTERVAL = 1
THUMBNAIL_INTERVAL = 600
TOKEN_LIFETIME = 3500

os.makedirs(VOD_DIR, exist_ok=True)
os.makedirs(LOG_DIR, exist_ok=True)

FFMPEG_PATH = shutil.which('ffmpeg') or "/usr/bin/ffmpeg"
STREAMLINK_PATH = shutil.which('streamlink') or "/usr/local/bin/streamlink"
TWITCH_CLIENT_ID = os.environ.get('TWITCH_CLIENT_ID')
TWITCH_CLIENT_SECRET = os.environ.get('TWITCH_CLIENT_SECRET')

active_processes = []
_cached_token = None
_token_time = 0


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")
    sys.stdout.flush()


def get_twitch_access_token():
    global _cached_token, _token_time
    now = time.time()
    if _cached_token and (now - _token_time) < TOKEN_LIFETIME:
        return _cached_token
    url = 'https://id.twitch.tv/oauth2/token'
    params = {
        'client_id': TWITCH_CLIENT_ID,
        'client_secret': TWITCH_CLIENT_SECRET,
        'grant_type': 'client_credentials'
    }
    for attempt in range(3):
        try:
            resp = requests.post(url, params=params, timeout=10)
            if resp.status_code == 200:
                _cached_token = resp.json().get('access_token')
                _token_time = now
                return _cached_token
        except Exception as e:
            log(f"Token-Abruf Versuch {attempt + 1}/3 fehlgeschlagen: {e}")
            time.sleep(1)
    return _cached_token


def get_stream_info():
    global _cached_token, _token_time
    access_token = get_twitch_access_token()
    if not access_token:
        return None
    headers = {
        'Client-ID': TWITCH_CLIENT_ID,
        'Authorization': f'Bearer {access_token}'
    }
    url = f'https://api.twitch.tv/helix/streams?user_login={CHANNEL}'
    for attempt in range(2):
        try:
            resp = requests.get(url, headers=headers, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                if data.get('data') and len(data['data']) > 0:
                    s = data['data'][0]
                    return {
                        'id': str(s['id']),
                        'title': s['title'],
                        'game': s['game_name'],
                        'started_at': s['started_at']
                    }
                return False
            elif resp.status_code == 401:
                _cached_token = None
                _token_time = 0
                access_token = get_twitch_access_token()
                if access_token:
                    headers['Authorization'] = f'Bearer {access_token}'
                    continue
                return None
            else:
                return None
        except requests.exceptions.Timeout:
            time.sleep(1)
        except Exception:
            return None
    return None


def is_stream_live_fast():
    try:
        result = subprocess.run(
            [STREAMLINK_PATH, '--json', f'twitch.tv/{CHANNEL}'],
            capture_output=True, text=True, timeout=8
        )
        if result.returncode == 0:
            data = json.loads(result.stdout)
            if 'streams' in data and len(data['streams']) > 0:
                return True
        return False
    except Exception:
        return False


def get_last_segment_number(stream_id):
    stream_dir = os.path.join(VOD_DIR, stream_id, "video")
    if not os.path.exists(stream_dir):
        return 0
    max_num = -1
    for f in os.listdir(stream_dir):
        if f.startswith("segment_") and f.endswith('.ts'):
            try:
                num = int(f[len("segment_"):-3])
                if num > max_num:
                    max_num = num
            except ValueError:
                continue
    return max_num + 1


def get_newest_segment_time(stream_id):
    stream_dir = os.path.join(VOD_DIR, stream_id, "video")
    if not os.path.exists(stream_dir):
        return 0
    newest = 0
    for f in os.listdir(stream_dir):
        if f.startswith("segment_") and f.endswith('.ts'):
            path = os.path.join(stream_dir, f)
            try:
                mtime = os.path.getmtime(path)
                if mtime > newest:
                    newest = mtime
            except OSError:
                continue
    return newest


def load_meta(stream_id):
    meta_path = os.path.join(VOD_DIR, stream_id, 'meta.json')
    if os.path.exists(meta_path):
        try:
            with open(meta_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_meta(stream_id, meta):
    meta_dir = os.path.join(VOD_DIR, stream_id)
    os.makedirs(meta_dir, exist_ok=True)
    meta_path = os.path.join(meta_dir, 'meta.json')
    tmp_path = meta_path + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, meta_path)


def thumbnail_worker(stream_id, stop_event):
    while not stop_event.is_set():
        try:
            stream_dir = os.path.join(VOD_DIR, stream_id, 'video')
            if os.path.exists(stream_dir):
                segments = [f for f in os.listdir(stream_dir)
                            if f.startswith('segment_') and f.endswith('.ts')]
                if segments:
                    segments.sort()
                    seg_path = os.path.join(stream_dir, segments[-1])
                    thumb_path = os.path.join(VOD_DIR, stream_id, 'thumbnail.png')
                    subprocess.run(
                        [FFMPEG_PATH, '-y', '-i', seg_path, '-frames:v', '1', '-q:v', '2', thumb_path],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15
                    )
        except Exception:
            pass
        stop_event.wait(THUMBNAIL_INTERVAL)


def graceful_kill(proc, name="Prozess", timeout=5):
    if proc is None:
        return
    try:
        if proc.poll() is not None:
            return
        proc.terminate()
        try:
            proc.wait(timeout=timeout)
            return
        except subprocess.TimeoutExpired:
            pass
        proc.kill()
        proc.wait(timeout=3)
    except Exception:
        pass


def first_segment_watcher(stream_id, stop_event):
    stream_dir = os.path.join(VOD_DIR, stream_id, 'video')
    while not stop_event.is_set():
        if os.path.exists(stream_dir):
            segments = [f for f in os.listdir(stream_dir)
                        if f.startswith('segment_') and f.endswith('.ts')]
            if segments:
                now = datetime.now(timezone.utc).isoformat()
                meta = load_meta(stream_id)
                meta['started_at'] = now
                save_meta(stream_id, meta)
                log(f"Erstes Segment da -> started_at = {now}")
                return
        stop_event.wait(0.5)


def record_stream(stream_info):
    global active_processes
    stream_id = stream_info['id']
    stream_dir = os.path.join(VOD_DIR, stream_id, 'video')
    os.makedirs(stream_dir, exist_ok=True)

    start_number = get_last_segment_number(stream_id)
    meta = load_meta(stream_id)
    if not meta:
        meta = stream_info.copy()
        meta.pop('started_at', None)
        meta['chapters'] = [{
            'game': stream_info['game'],
            'title': stream_info['title'],
            'stream_sec': 0,
            'timestamp': time.time()
        }]
        meta['outages'] = []
        save_meta(stream_id, meta)

    if 'outages' not in meta:
        meta['outages'] = []
        save_meta(stream_id, meta)

    playlist_path = os.path.join(stream_dir, 'playlist.m3u8')
    log(f"Starte Aufnahme: {CHANNEL} (ID: {stream_id}) ab Segment {start_number}")

    sl_log = open(os.path.join(LOG_DIR, f'streamlink_{stream_id}.log'), 'a')
    ff_log = open(os.path.join(LOG_DIR, f'ffmpeg_{stream_id}.log'), 'a')

    # Shell-Pipeline: Streamlink | FFmpeg
    # Der Kernel verwaltet die Pipe komplett – Python hat keine Referenz darauf
    segment_pattern = os.path.join(stream_dir, 'segment_%04d.ts')
    shell_cmd = (
        f'{STREAMLINK_PATH} twitch.tv/{CHANNEL} best '
        f'--twitch-disable-ads --hls-live-edge 2 -O '
        f'| {FFMPEG_PATH} -i pipe:0 -c copy -f hls '
        f'-hls_time 10 -hls_list_size 0 '
        f'-hls_flags append_list+independent_segments '
        f'-hls_segment_filename {segment_pattern} '
        f'-start_number {start_number} '
        f'{playlist_path}'
    )

    try:
        proc = subprocess.Popen(
            shell_cmd,
            shell=True,
            stdout=subprocess.DEVNULL,
            stderr=ff_log,
            preexec_fn=os.setsid  # Eigene Prozessgruppe für sauberes Cleanup
        )

        active_processes = [proc]

        stop_event = threading.Event()

        threading.Thread(
            target=thumbnail_worker, args=(stream_id, stop_event), daemon=True
        ).start()
        threading.Thread(
            target=first_segment_watcher, args=(stream_id, stop_event), daemon=True
        ).start()

        return proc, stop_event, sl_log, ff_log

    except Exception as e:
        log(f"Kritischer Fehler beim Prozess-Start: {e}")
        sl_log.close()
        ff_log.close()
        return None, None, None, None


def cleanup_recording(proc, stop_event, sl_log, ff_log):
    if stop_event:
        stop_event.set()
    if proc is not None:
        try:
            if proc.poll() is None:
                # Ganze Prozessgruppe killen (Streamlink + FFmpeg)
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                    proc.wait(timeout=3)
        except Exception:
            pass
    active_processes.clear()
    for f in [sl_log, ff_log]:
        if f:
            try:
                f.close()
            except Exception:
                pass


def log_outage(stream_id, reason):
    meta = load_meta(stream_id)
    if 'outages' not in meta:
        meta['outages'] = []
    outage = {
        'timestamp': time.time(),
        'time_readable': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'segment': get_last_segment_number(stream_id),
        'reason': reason
    }
    meta['outages'].append(outage)
    save_meta(stream_id, meta)
    log(f"OUTAGE protokolliert: {reason}")


def finish_stream(current_stream_id, proc, stop_event, sl_log, ff_log):
    meta = load_meta(current_stream_id)
    meta['ended_at'] = datetime.now(timezone.utc).isoformat()
    save_meta(current_stream_id, meta)
    cleanup_recording(proc, stop_event, sl_log, ff_log)
    log(f"Stream beendet: {current_stream_id} um {meta['ended_at']}")


def monitor():
    global active_processes
    proc = None
    stop_event = None
    sl_log = None
    ff_log = None
    current_stream_id = None
    restart_count = 0
    max_restarts_per_minute = 10
    restart_timestamps = []
    last_streamlink_check = 0
    streamlink_check_interval = 3

    def kill_all():
        log("Beende alle Prozesse...")
        cleanup_recording(proc, stop_event, sl_log, ff_log)

    signal.signal(signal.SIGINT, lambda s, f: (kill_all(), sys.exit(0)))
    signal.signal(signal.SIGTERM, lambda s, f: (kill_all(), sys.exit(0)))

    log(f"Monitoring aktiv für: {CHANNEL} (Check alle {LIVE_CHECK_INTERVAL}s)")

    while True:
        try:
            now = time.time()
            is_recording = proc is not None

            stream_is_live = False
            info = None

            if not is_recording and (now - last_streamlink_check) >= streamlink_check_interval:
                last_streamlink_check = now
                if is_stream_live_fast():
                    log("Streamlink: Stream erkannt! Hole API-Info...")
                    stream_is_live = True
                    info = get_stream_info()
                    if not info or info is False:
                        info = get_stream_info()
                    if not info or info is False:
                        time.sleep(2)
                        info = get_stream_info()
                    if not info or info is False:
                        log("API noch nicht ready, warte...")
                        time.sleep(LIVE_CHECK_INTERVAL)
                        continue

            if not stream_is_live:
                info = get_stream_info()
                if info is None:
                    time.sleep(LIVE_CHECK_INTERVAL)
                    continue
                stream_is_live = (info is not False)

            if stream_is_live and info and info is not False:
                needs_restart = False
                restart_reason = None

                if proc is None:
                    needs_restart = True
                    restart_reason = "Erststart"
                elif proc.poll() is not None:
                    rc = proc.returncode
                    if rc == 0 or rc == -13 or rc == 141:
                        # 0 = sauber, -13/141 = SIGPIPE (normal bei Stream-Ende)
                        log(f"Pipeline beendet (code={rc}), Stream-Ende erkannt.")
                        finish_stream(current_stream_id, proc, stop_event, sl_log, ff_log)
                        proc, stop_event, sl_log, ff_log, current_stream_id = None, None, None, None, None
                        restart_count = 0
                        restart_timestamps.clear()
                        time.sleep(LIVE_CHECK_INTERVAL)
                        continue
                    else:
                        needs_restart = True
                        restart_reason = f"Pipeline crashed (code={rc})"
                # KEIN Segment-Health-Check mehr – Streamlink/FFmpeg wissen selbst
                # wann der Stream tot ist. Unnötige Restarts verursachen Lücken.

                if needs_restart:
                    now_ts = time.time()
                    restart_timestamps = [t for t in restart_timestamps if now_ts - t < 60]
                    if len(restart_timestamps) >= max_restarts_per_minute:
                        log(f"WARNUNG: {max_restarts_per_minute} Restarts in 1 Min. Warte 30s...")
                        time.sleep(30)
                        restart_timestamps.clear()

                    if proc is not None:
                        if restart_reason != "Erststart":
                            log_outage(current_stream_id or info['id'], restart_reason)
                        log(f"Neustart nötig: {restart_reason}")
                        cleanup_recording(proc, stop_event, sl_log, ff_log)
                        time.sleep(2)

                    current_stream_id = info['id']
                    result = record_stream(info)
                    proc = result[0]
                    stop_event = result[1]
                    sl_log = result[2]
                    ff_log = result[3]

                    if proc is None:
                        log("Aufnahme-Start fehlgeschlagen, versuche erneut...")
                        time.sleep(2)
                    else:
                        restart_timestamps.append(now_ts)
                        restart_count += 1
                        log(f"Aufnahme läuft (Restart #{restart_count})" if restart_count > 1
                            else "Aufnahme gestartet.")
                else:
                    meta = load_meta(current_stream_id)
                    if meta.get('game') != info['game'] or meta.get('title') != info['title']:
                        log(f"Wechsel: {info['game']} - {info['title']}")
                        meta['game'] = info['game']
                        meta['title'] = info['title']
                        rel_sec = get_last_segment_number(current_stream_id) * 10
                        if 'chapters' not in meta:
                            meta['chapters'] = []
                        meta['chapters'].append({
                            'game': info['game'],
                            'title': info['title'],
                            'stream_sec': rel_sec,
                            'timestamp': time.time()
                        })
                        save_meta(current_stream_id, meta)

            else:
                if proc is not None:
                    log("API: Stream offline.")
                    finish_stream(current_stream_id, proc, stop_event, sl_log, ff_log)
                    proc, stop_event, sl_log, ff_log, current_stream_id = None, None, None, None, None
                    restart_count = 0
                    restart_timestamps.clear()

            time.sleep(LIVE_CHECK_INTERVAL)

        except Exception as e:
            log(f"Monitor Fehler: {e}")
            import traceback
            traceback.print_exc()
            sys.stdout.flush()
            time.sleep(LIVE_CHECK_INTERVAL)


if __name__ == "__main__":
    monitor()