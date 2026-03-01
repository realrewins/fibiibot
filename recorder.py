#!/usr/bin/env python3
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

# ========== KONFIGURATION ==========
CHANNEL = "fibii"
BASE_DIR = "/srv/fibiibot"
VOD_DIR = os.path.join(BASE_DIR, "vod")
HEARTBEAT_INTERVAL = 2
OUTAGE_THRESHOLD = 5 
LIVE_CHECK_INTERVAL = 5 

os.makedirs(VOD_DIR, exist_ok=True)

FFMPEG_PATH = shutil.which('ffmpeg')
if FFMPEG_PATH is None:
    FFMPEG_PATH = "/usr/bin/ffmpeg"
    if not os.path.exists(FFMPEG_PATH):
        print("FFmpeg nicht gefunden. Bitte installieren: sudo apt install ffmpeg")
        sys.exit(1)

STREAMLINK_PATH = shutil.which('streamlink')
if STREAMLINK_PATH is None:
    STREAMLINK_PATH = "/usr/local/bin/streamlink"
    if not os.path.exists(STREAMLINK_PATH):
        print("Streamlink nicht gefunden. Bitte in der venv installieren: pip install streamlink")
        sys.exit(1)

TWITCH_CLIENT_ID = os.environ.get('TWITCH_CLIENT_ID')
TWITCH_CLIENT_SECRET = os.environ.get('TWITCH_CLIENT_SECRET')
if not TWITCH_CLIENT_ID or not TWITCH_CLIENT_SECRET:
    print("TWITCH_CLIENT_ID und TWITCH_CLIENT_SECRET müssen in der .env gesetzt sein.")
    sys.exit(1)

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def get_twitch_access_token():
    url = 'https://id.twitch.tv/oauth2/token'
    params = {
        'client_id': TWITCH_CLIENT_ID,
        'client_secret': TWITCH_CLIENT_SECRET,
        'grant_type': 'client_credentials'
    }
    try:
        resp = requests.post(url, params=params, timeout=5)
        if resp.status_code == 200:
            return resp.json().get('access_token')
    except:
        pass
    return None

def get_stream_info():
    """Holt aktuelle Stream-Info (inkl. ID). Gibt None zurück, wenn nicht live."""
    access_token = get_twitch_access_token()
    if not access_token:
        return None
    headers = {
        'Client-ID': TWITCH_CLIENT_ID,
        'Authorization': f'Bearer {access_token}'
    }
    url = f'https://api.twitch.tv/helix/streams?user_login={CHANNEL}'
    try:
        resp = requests.get(url, headers=headers, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            if data['data']:
                s = data['data'][0]
                return {
                    'id': s['id'],
                    'title': s['title'],
                    'game': s['game_name'],
                    'started_at': s['started_at']
                }
    except:
        pass
    return None

def get_last_segment_number(stream_dir):
    """Ermittelt die höchste vorhandene Segmentnummer."""
    max_num = -1
    pattern = "segment_"
    if not os.path.exists(stream_dir):
        return 0
    for f in os.listdir(stream_dir):
        if f.startswith(pattern) and f.endswith('.ts'):
            try:
                num = int(f[len(pattern):-3])
                if num > max_num:
                    max_num = num
            except:
                continue
    return max_num + 1

def load_meta(stream_id):
    meta_path = os.path.join(VOD_DIR, stream_id, 'meta.json')
    if os.path.exists(meta_path):
        with open(meta_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

def save_meta(stream_id, meta):
    meta_dir = os.path.join(VOD_DIR, stream_id)
    os.makedirs(meta_dir, exist_ok=True)
    meta_path = os.path.join(meta_dir, 'meta.json')
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

def update_heartbeat(stream_id, last_seg, stream_sec):
    """Schreibt Heartbeat-Daten direkt in meta.json."""
    meta = load_meta(stream_id)
    meta['heartbeat'] = {
        'timestamp': time.time(),
        'segment': last_seg,
        'stream_sec': stream_sec
    }
    save_meta(stream_id, meta)

def get_heartbeat(stream_id):
    """Liest Heartbeat aus meta.json, falls vorhanden."""
    meta = load_meta(stream_id)
    return meta.get('heartbeat')

def delete_heartbeat(stream_id):
    """Entfernt Heartbeat aus meta.json."""
    meta = load_meta(stream_id)
    if 'heartbeat' in meta:
        del meta['heartbeat']
        save_meta(stream_id, meta)

def generate_thumbnail(stream_id, segment_path):
    thumb_path = os.path.join(VOD_DIR, stream_id, 'thumbnail.png')
    cmd = [
        FFMPEG_PATH, '-i', segment_path,
        '-frames:v', '1',
        '-update', '1',
        thumb_path
    ]
    try:
        subprocess.run(cmd, capture_output=True, timeout=10, check=False)
        log(f"Thumbnail gespeichert: {thumb_path}")
    except:
        pass

def heartbeat_worker(stream_id, stream_info, stop_event):
    """Läuft in eigenem Thread und aktualisiert den Heartbeat in meta.json."""
    while not stop_event.is_set():
        try:
            stream_dir = os.path.join(VOD_DIR, stream_id, 'video')
            last_seg = get_last_segment_number(stream_dir) - 1
            stream_sec = (datetime.now(timezone.utc) - datetime.fromisoformat(stream_info['started_at'].replace('Z', '+00:00'))).total_seconds()
            update_heartbeat(stream_id, last_seg if last_seg >= 0 else 0, stream_sec)
        except:
            pass
        stop_event.wait(HEARTBEAT_INTERVAL)

def record_stream(stream_info):
    stream_id = stream_info['id']
    stream_dir = os.path.join(VOD_DIR, stream_id, 'video')
    os.makedirs(stream_dir, exist_ok=True)

    last_hb = get_heartbeat(stream_id)
    if last_hb:
        time_since = time.time() - last_hb['timestamp']
        if time_since > OUTAGE_THRESHOLD:
            outage_start = last_hb['stream_sec']
            outage_end = outage_start + time_since
            meta = load_meta(stream_id)
            if 'outages' not in meta:
                meta['outages'] = []
            meta['outages'].append([outage_start, outage_end])
            if 'heartbeat' in meta:
                del meta['heartbeat']
            save_meta(stream_id, meta)
            log(f"Outage erkannt: {time_since:.1f}s Lücke, starte bei Segment {last_hb['segment']+1}")
            start_number = last_hb['segment'] + 1
        else:
            start_number = last_hb['segment'] + 1
    else:
        start_number = 0

    meta = load_meta(stream_id)
    if not meta:
        meta = stream_info.copy()
        save_meta(stream_id, meta)

    playlist_path = os.path.join(stream_dir, 'playlist.m3u8')
    segment_pattern = os.path.join(stream_dir, 'segment_%04d.ts')

    cmd_streamlink = [STREAMLINK_PATH, f'twitch.tv/{CHANNEL}', 'best', '-O']
    cmd_ffmpeg = [
        FFMPEG_PATH, '-i', 'pipe:0',
        '-c', 'copy',
        '-f', 'hls',
        '-hls_time', '10',
        '-hls_list_size', '0',
        '-hls_flags', 'append_list+delete_segments',
        '-hls_segment_filename', segment_pattern,
        '-start_number', str(start_number),
        playlist_path
    ]

    log(f"Starte Aufnahme für Stream-ID {stream_id} ab Segment {start_number}")
    process_streamlink = subprocess.Popen(cmd_streamlink, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    process_ffmpeg = subprocess.Popen(cmd_ffmpeg, stdin=process_streamlink.stdout, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    process_streamlink.stdout.close()

    stop_hb = threading.Event()
    hb_thread = threading.Thread(target=heartbeat_worker, args=(stream_id, stream_info, stop_hb), daemon=True)
    hb_thread.start()

    return process_ffmpeg, stop_hb

def monitor():
    recording_process = None
    stop_hb_event = None
    current_stream_id = None
    current_info = None

    def cleanup(*args):
        if recording_process:
            recording_process.terminate()
        if current_stream_id:
            delete_heartbeat(current_stream_id)
        sys.exit(0)

    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    log(f"Monitor gestartet für Kanal: {CHANNEL}")
    log(f"Aufnahmen in: {VOD_DIR}")

    while True:
        try:
            info = get_stream_info()
            live = info is not None

            if live and recording_process is None:
                current_stream_id = info['id']
                current_info = info
                log(f"Neuer Stream erkannt: ID {current_stream_id}, Titel: {info['title']}")
                recording_process, stop_hb_event = record_stream(info)

                def make_thumb():
                    time.sleep(15)
                    stream_dir = os.path.join(VOD_DIR, current_stream_id, 'video')
                    if os.path.exists(stream_dir):
                        for f in os.listdir(stream_dir):
                            if f.startswith('segment_') and f.endswith('.ts'):
                                seg_path = os.path.join(stream_dir, f)
                                generate_thumbnail(current_stream_id, seg_path)
                                break
                threading.Thread(target=make_thumb, daemon=True).start()

            elif live and recording_process is not None and current_stream_id != info['id']:
                log("Stream-ID geändert – starte neue Aufnahme.")
                recording_process.terminate()
                if stop_hb_event:
                    stop_hb_event.set()
                if current_stream_id:
                    delete_heartbeat(current_stream_id)
                recording_process = None
                current_stream_id = info['id']
                current_info = info
                recording_process, stop_hb_event = record_stream(info)

            elif not live and recording_process is not None:
                log("Stream offline – beende Aufnahme.")
                recording_process.terminate()
                if stop_hb_event:
                    stop_hb_event.set()
                if current_stream_id:
                    delete_heartbeat(current_stream_id)
                    meta = load_meta(current_stream_id)
                    meta['ended_at'] = datetime.now(timezone.utc).isoformat()
                    save_meta(current_stream_id, meta)
                recording_process = None
                current_stream_id = None
                current_info = None

            elif live and recording_process is not None and current_stream_id == info['id']:
                if current_info and (current_info['title'] != info['title'] or current_info['game'] != info['game']):
                    current_info = info
                    meta = load_meta(current_stream_id)
                    meta.update(info)
                    save_meta(current_stream_id, meta)

            time.sleep(LIVE_CHECK_INTERVAL)

        except Exception as e:
            log(f"Fehler in Monitor: {e}")
            time.sleep(LIVE_CHECK_INTERVAL)

if __name__ == "__main__":
    monitor()