import os
import time
import subprocess
import sys
import json
import shutil
import requests
import threading
import re
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

CHANNEL = "fibii"
BASE_DIR = "/srv/fibiibot"
VOD_DIR = os.path.join(BASE_DIR, "vod")
LOG_DIR = os.path.join(BASE_DIR, "logs")
LIVE_CHECK_INTERVAL = 1
THUMBNAIL_INTERVAL = 600

os.makedirs(VOD_DIR, exist_ok=True)
os.makedirs(LOG_DIR, exist_ok=True)

FFMPEG_PATH = shutil.which('ffmpeg') or "/usr/bin/ffmpeg"
TWITCH_CLIENT_ID = os.environ.get('TWITCH_CLIENT_ID', '').strip()
TWITCH_CLIENT_SECRET = os.environ.get('TWITCH_CLIENT_SECRET', '').strip()

raw_token = os.environ.get('OAUTH_TOKEN', '')
OAUTH_TOKEN = raw_token.replace('"', '').replace("'", "").strip()

GQL_CLIENT_ID = "kimne78kx3ncx6brs4gm76iz8n1864"

_cached_token = None
_token_time = 0

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")
    sys.stdout.flush()

def get_twitch_access_token():
    global _cached_token, _token_time
    now = time.time()
    if _cached_token and (now - _token_time) < 3500:
        return _cached_token
        
    if not TWITCH_CLIENT_ID or not TWITCH_CLIENT_SECRET:
        log("FEHLER: TWITCH_CLIENT_ID oder TWITCH_CLIENT_SECRET in der .env fehlen!")
        return None

    url = 'https://id.twitch.tv/oauth2/token'
    params = {
        'client_id': TWITCH_CLIENT_ID,
        'client_secret': TWITCH_CLIENT_SECRET,
        'grant_type': 'client_credentials'
    }
    try:
        resp = requests.post(url, params=params, timeout=10)
        if resp.status_code == 200:
            _cached_token = resp.json().get('access_token')
            _token_time = now
            return _cached_token
    except Exception:
        pass
    return None

def get_stream_info():
    global _cached_token, _token_time
    access_token = get_twitch_access_token()
    if not access_token:
        return None
        
    headers = {
        'Client-ID': TWITCH_CLIENT_ID,
        'Authorization': f'Bearer {access_token}',
        'User-Agent': 'Mozilla/5.0'
    }
    url = f'https://api.twitch.tv/helix/streams?user_login={CHANNEL}'
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
            return None
    except Exception:
        return None

def get_hls_url():
    url = 'https://gql.twitch.tv/gql'
    query = {
        "query": "query PlaybackAccessToken($login: String!, $isLive: Boolean!, $playerType: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: \"web\", playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isLive) { value signature } }",
        "variables": {
            "isLive": True,
            "login": CHANNEL,
            "playerType": "site"
        }
    }
    
    headers = {
        "Client-ID": GQL_CLIENT_ID,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Device-Id": "1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p"
    }
    
    if OAUTH_TOKEN:
        headers["Authorization"] = f"OAuth {OAUTH_TOKEN}"
        
    try:
        resp = requests.post(url, json=query, headers=headers, timeout=10)
        
        if resp.status_code == 401 or resp.status_code == 403:
            log(f"FEHLER: Token abgelaufen oder abgelehnt. HTTP Code: {resp.status_code}")
            return None
            
        resp_data = resp.json()
        
        if 'errors' in resp_data:
            err_msg = resp_data['errors'][0].get('message', 'Unbekannt')
            log(f"FEHLER von Twitch API: {err_msg}")
            return None
            
        if not resp_data.get('data') or not resp_data['data'].get('streamPlaybackAccessToken'):
            log("FEHLER: Konnte keine Stream-Daten abrufen (Stream offline?).")
            return None
            
        token = resp_data['data']['streamPlaybackAccessToken']['value']
        sig = resp_data['data']['streamPlaybackAccessToken']['signature']
        master_url = f"https://usher.ttvnw.net/api/channel/hls/{CHANNEL}.m3u8?sig={sig}&token={token}&allow_source=true"
        
        m_resp = requests.get(master_url, headers={"User-Agent": headers["User-Agent"]}, timeout=10)
        
        if m_resp.status_code == 200:
            urls = re.findall(r'(https?://[^\s]+)', m_resp.text)
            if urls:
                return urls[0]
        else:
            log(f"FEHLER: Master Playlist konnte nicht geladen werden (Code: {m_resp.status_code})")
            
        return None
    except Exception as e:
        log(f"HLS Fetch Exception: {e}")
        return None

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
                segments = [f for f in os.listdir(stream_dir) if f.startswith('segment_') and f.endswith('.ts')]
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

def first_segment_watcher(stream_id, stop_event):
    stream_dir = os.path.join(VOD_DIR, stream_id, 'video')
    while not stop_event.is_set():
        if os.path.exists(stream_dir):
            segments = [f for f in os.listdir(stream_dir) if f.startswith('segment_') and f.endswith('.ts')]
            if segments:
                now = datetime.now(timezone.utc).isoformat()
                meta = load_meta(stream_id)
                meta['started_at'] = now
                save_meta(stream_id, meta)
                log(f"Erstes Segment da, Startzeit: {now}")
                return
        stop_event.wait(0.5)

def update_playlist(stream_dir, segments_data, is_ended=False):
    playlist_path = os.path.join(stream_dir, 'index.m3u8')
    temp_path = playlist_path + '.tmp'
    try:
        target_duration = 10
        max_d = 0.0
        for _, d_str in segments_data:
            try:
                val = float(d_str.split(':')[1].split(',')[0])
                if val > max_d:
                    max_d = val
            except Exception:
                pass
        if max_d > 0:
            target_duration = int(max_d + 1)

        with open(temp_path, 'w') as f:
            f.write("#EXTM3U\n")
            f.write("#EXT-X-VERSION:6\n")
            f.write(f"#EXT-X-TARGETDURATION:{target_duration}\n")
            f.write("#EXT-X-MEDIA-SEQUENCE:0\n")
            f.write("#EXT-X-INDEPENDENT-SEGMENTS\n")
            f.write("#EXT-X-PLAYLIST-TYPE:EVENT\n")
            for local_seg, duration_str in segments_data:
                f.write(f"{duration_str}\n")
                f.write(f"{local_seg}\n")
            if is_ended:
                f.write("#EXT-X-ENDLIST\n")
        os.replace(temp_path, playlist_path)
    except Exception:
        pass

def download_worker(m3u8_url, stream_id, stop_event):
    stream_dir = os.path.join(VOD_DIR, stream_id, 'video')
    os.makedirs(stream_dir, exist_ok=True)
    downloaded_segments = set()
    segments_data = []
    segment_counter = get_last_segment_number(stream_id)
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    while not stop_event.is_set():
        try:
            resp = requests.get(m3u8_url, headers=headers, timeout=10)
            if resp.status_code != 200:
                break
            
            lines = resp.text.split('\n')
            base_url = m3u8_url.rsplit('/', 1)[0]
            
            for i in range(len(lines)):
                if lines[i].startswith('#EXTINF:'):
                    duration_line = lines[i]
                    segment_name = lines[i+1].strip()
                    
                    if segment_name and segment_name not in downloaded_segments:
                        if segment_name.startswith('http'):
                            seg_url = segment_name
                        else:
                            seg_url = f"{base_url}/{segment_name}"
                            
                        try:
                            ts_data = requests.get(seg_url, headers=headers, timeout=10).content
                            local_seg_name = f"segment_{segment_counter:06d}.ts"
                            file_path = os.path.join(stream_dir, local_seg_name)
                            
                            with open(file_path, "wb") as f:
                                f.write(ts_data)
                                
                            downloaded_segments.add(segment_name)
                            segments_data.append((local_seg_name, duration_line))
                            segment_counter += 1
                        except Exception:
                            pass
            
            update_playlist(stream_dir, segments_data, is_ended=False)
            
            if len(downloaded_segments) > 2000:
                downloaded_segments.clear()
                
            time.sleep(1)
        except Exception:
            break
            
    update_playlist(stream_dir, segments_data, is_ended=True)

def record_stream(stream_info):
    stream_id = stream_info['id']
    stream_dir = os.path.join(VOD_DIR, stream_id, 'video')
    os.makedirs(stream_dir, exist_ok=True)

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

    hls_url = get_hls_url()
    if not hls_url:
        return None, None

    log(f"Starte Aufnahme: {CHANNEL} (ID: {stream_id})")

    stop_event = threading.Event()
    
    thread = threading.Thread(target=download_worker, args=(hls_url, stream_id, stop_event))
    thread.start()
    
    threading.Thread(target=thumbnail_worker, args=(stream_id, stop_event), daemon=True).start()
    threading.Thread(target=first_segment_watcher, args=(stream_id, stop_event), daemon=True).start()

    return thread, stop_event

def finish_stream(current_stream_id, thread, stop_event):
    if stop_event:
        stop_event.set()
    if thread:
        thread.join()
    meta = load_meta(current_stream_id)
    meta['ended_at'] = datetime.now(timezone.utc).isoformat()
    save_meta(current_stream_id, meta)
    log(f"Stream beendet: {current_stream_id}")

def monitor():
    current_thread = None
    stop_event = None
    current_stream_id = None
    
    log(f"Monitoring aktiv fuer: {CHANNEL}")

    while True:
        try:
            info = get_stream_info()
            stream_is_live = (info is not False and info is not None)

            if stream_is_live and info:
                if not current_thread:
                    current_stream_id = info['id']
                    current_thread, stop_event = record_stream(info)
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
                if current_thread:
                    log("Stream offline API Meldung.")
                    finish_stream(current_stream_id, current_thread, stop_event)
                    current_thread = None
                    stop_event = None
                    current_stream_id = None

            time.sleep(LIVE_CHECK_INTERVAL)

        except Exception:
            time.sleep(LIVE_CHECK_INTERVAL)

if __name__ == "__main__":
    monitor()