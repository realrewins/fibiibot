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
LIVE_CHECK_INTERVAL = 2
THUMBNAIL_INTERVAL = 10

os.makedirs(VOD_DIR, exist_ok=True)

FFMPEG_PATH = shutil.which('ffmpeg') or "/usr/bin/ffmpeg"
STREAMLINK_PATH = shutil.which('streamlink') or "/usr/local/bin/streamlink"
TWITCH_CLIENT_ID = os.environ.get('TWITCH_CLIENT_ID')
TWITCH_CLIENT_SECRET = os.environ.get('TWITCH_CLIENT_SECRET')

active_processes = []

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")
    sys.stdout.flush()

def get_twitch_access_token():
    url = 'https://id.twitch.tv/oauth2/token'
    params = {'client_id': TWITCH_CLIENT_ID, 'client_secret': TWITCH_CLIENT_SECRET, 'grant_type': 'client_credentials'}
    try:
        resp = requests.post(url, params=params, timeout=5)
        if resp.status_code == 200: return resp.json().get('access_token')
    except: pass
    return None

def get_stream_info():
    access_token = get_twitch_access_token()
    if not access_token:
        log("API Fehler: Token-Abruf fehlgeschlagen")
        return None
    headers = {'Client-ID': TWITCH_CLIENT_ID, 'Authorization': f'Bearer {access_token}'}
    url = f'https://api.twitch.tv/helix/streams?user_login={CHANNEL}'
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            if data['data'] and len(data['data']) > 0:
                s = data['data'][0]
                return {'id': str(s['id']), 'title': s['title'], 'game': s['game_name'], 'started_at': s['started_at']}
            return False
    except: pass
    return None

def get_last_segment_number(stream_id):
    stream_dir = os.path.join(VOD_DIR, stream_id, "video")
    if not os.path.exists(stream_dir): return 0
    max_num = -1
    for f in os.listdir(stream_dir):
        if f.startswith("segment_") and f.endswith('.ts'):
            try:
                num = int(f[len("segment_"):-3])
                if num > max_num: max_num = num
            except: continue
    return max_num + 1

def load_meta(stream_id):
    meta_path = os.path.join(VOD_DIR, stream_id, 'meta.json')
    if os.path.exists(meta_path):
        try:
            with open(meta_path, 'r', encoding='utf-8') as f: return json.load(f)
        except: return {}
    return {}

def save_meta(stream_id, meta):
    meta_dir = os.path.join(VOD_DIR, stream_id)
    os.makedirs(meta_dir, exist_ok=True)
    meta_path = os.path.join(meta_dir, 'meta.json')
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

def thumbnail_worker(stream_id, stop_event):
    while not stop_event.is_set():
        try:
            stream_dir = os.path.join(VOD_DIR, stream_id, 'video')
            segments = [f for f in os.listdir(stream_dir) if f.startswith('segment_') and f.endswith('.ts')]
            if segments:
                segments.sort()
                seg_path = os.path.join(stream_dir, segments[-1])
                thumb_path = os.path.join(VOD_DIR, stream_id, 'thumbnail.png')
                subprocess.run([FFMPEG_PATH, '-y', '-i', seg_path, '-frames:v', '1', '-q:v', '2', thumb_path], 
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
        except: pass
        stop_event.wait(THUMBNAIL_INTERVAL)

def record_stream(stream_info):
    global active_processes
    stream_id = stream_info['id']
    stream_dir = os.path.join(VOD_DIR, stream_id, 'video')
    os.makedirs(stream_dir, exist_ok=True)
    
    start_number = get_last_segment_number(stream_id)
    meta = load_meta(stream_id)
    if not meta:
        meta = stream_info.copy()
        meta['chapters'] = [{'game': stream_info['game'], 'title': stream_info['title'], 'stream_sec': 0, 'timestamp': time.time()}]
        save_meta(stream_id, meta)
    
    playlist_path = os.path.join(stream_dir, 'playlist.m3u8')
    log(f"Starte Aufnahme: {CHANNEL} (ID: {stream_id}) ab Segment {start_number}")
    
    cmd_sl = [STREAMLINK_PATH, f'twitch.tv/{CHANNEL}', 'best', '--twitch-disable-ads', '--hls-live-edge', '3', '-O']
    cmd_ff = [
        FFMPEG_PATH, '-i', 'pipe:0', '-c', 'copy', '-f', 'hls', '-hls_time', '10', '-hls_list_size', '0',
        '-hls_flags', 'append_list+independent_segments', '-hls_segment_filename', os.path.join(stream_dir, 'segment_%04d.ts'),
        '-start_number', str(start_number), playlist_path
    ]
    
    try:
        ps = subprocess.Popen(cmd_sl, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        pf = subprocess.Popen(cmd_ff, stdin=ps.stdout, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        active_processes = [ps, pf]
        
        stop_event = threading.Event()
        threading.Thread(target=thumbnail_worker, args=(stream_id, stop_event), daemon=True).start()
        return pf, stop_event
    except Exception as e:
        log(f"Kritischer Fehler beim Prozess-Start: {e}")
        return None, None

def monitor():
    global active_processes
    recording_process = None
    stop_event = None
    current_stream_id = None
    
    def kill_all():
        log("Beende alle Prozesse...")
        if stop_event: stop_event.set()
        for p in active_processes:
            try: p.kill()
            except: pass
        active_processes.clear()

    signal.signal(signal.SIGINT, lambda s, f: (kill_all(), sys.exit(0)))
    signal.signal(signal.SIGTERM, lambda s, f: (kill_all(), sys.exit(0)))

    log(f"Monitoring aktiv für: {CHANNEL}")

    while True:
        try:
            info = get_stream_info()
            
            if info is None: # API Fehler
                time.sleep(LIVE_CHECK_INTERVAL)
                continue
            
            if info is not False: # Stream ist LIVE
                if recording_process is None or recording_process.poll() is not None:
                    if recording_process and recording_process.poll() is not None:
                        log("Aufnahme-Prozess unerwartet beendet. Starte neu...")
                    current_stream_id = info['id']
                    recording_process, stop_event = record_stream(info)
                else:
                    # Prüfen auf Titel/Spiel-Wechsel
                    meta = load_meta(current_stream_id)
                    if meta.get('game') != info['game'] or meta.get('title') != info['title']:
                        log(f"Wechsel: {info['game']} - {info['title']}")
                        meta['game'] = info['game']
                        meta['title'] = info['title']
                        stream_dir = os.path.join(VOD_DIR, current_stream_id, "video")
                        rel_sec = get_last_segment_number(current_stream_id) * 10
                        if 'chapters' not in meta: meta['chapters'] = []
                        meta['chapters'].append({'game': info['game'], 'title': info['title'], 'stream_sec': rel_sec, 'timestamp': time.time()})
                        save_meta(current_stream_id, meta)
            else: # Stream ist OFFLINE
                if recording_process is not None:
                    log("Stream beendet. Speichere Meta...")
                    meta = load_meta(current_stream_id)
                    meta['ended_at'] = datetime.now(timezone.utc).isoformat()
                    save_meta(current_stream_id, meta)
                    kill_all()
                    recording_process = None
            
            time.sleep(LIVE_CHECK_INTERVAL)
        except Exception as e:
            log(f"Monitor Fehler: {e}")
            time.sleep(LIVE_CHECK_INTERVAL)

if __name__ == "__main__":
    monitor()