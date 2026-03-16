import os
import json
import secrets
import random
import string
import requests
import subprocess
import re
import threading
import time
import tempfile
from flask import Blueprint, jsonify, send_from_directory, request, send_file, session
from datetime import datetime
from app.decorators import login_required
from app.config import VOD_FOLDER, TWITCH_CLIENT_ID
from app.twitch_api import get_twitch_access_token
from app.auth import validate_csrf

vod_bp = Blueprint('vod', __name__, url_prefix='/api')

def cleanup_old_clips():
    try:
        clips_base = os.path.join(VOD_FOLDER, 'clips')
        if not os.path.exists(clips_base): return
        now = time.time()
        for c in os.listdir(clips_base):
            mp4_path = os.path.join(clips_base, c, 'clip.mp4')
            if os.path.exists(mp4_path):
                if os.path.getmtime(mp4_path) < now - (24 * 3600):
                    os.remove(mp4_path)
    except Exception:
        pass

def get_input_video(stream_dir):
    checks = [
        ('playlist.m3u8', 'hls'),
        ('index.m3u8', 'hls'),
        ('video/playlist.m3u8', 'hls'),
        ('video/index.m3u8', 'hls'),
        (f'{os.path.basename(stream_dir)}.mp4', 'mp4'),
        ('video.mp4', 'mp4'),
    ]
    for path, typ in checks:
        full = os.path.join(stream_dir, path)
        if os.path.exists(full):
            return full, typ
    return None, None

def parse_m3u8(playlist_path):
    """Parst die .m3u8 Playlist und gibt eine Liste von (duration, segment_path) zurück."""
    segments = []
    playlist_dir = os.path.dirname(playlist_path)
    current_duration = 0.0

    with open(playlist_path, 'r') as f:
        for line in f:
            line = line.strip()
            if line.startswith('#EXTINF:'):
                current_duration = float(line.split(':')[1].rstrip(','))
            elif line and not line.startswith('#'):
                seg_path = os.path.join(playlist_dir, line)
                segments.append((current_duration, seg_path))

    return segments

def ffmpeg_cut_clip(input_video, typ, start, duration, out_path):
    start = float(start)
    duration = float(duration)

    if typ == 'hls':
        segments = parse_m3u8(input_video)
        if not segments:
            raise Exception("Keine Segmente in Playlist gefunden")

        cumulative = 0.0
        start_idx = 0
        end_idx = len(segments) - 1

        for i, (seg_dur, seg_path) in enumerate(segments):
            if cumulative + seg_dur > start:
                start_idx = i
                break
            cumulative += seg_dur

        offset_in_segment = start - cumulative

        clip_end = start + duration
        cumulative2 = 0.0
        for i, (seg_dur, seg_path) in enumerate(segments):
            cumulative2 += seg_dur
            if cumulative2 >= clip_end + 10:
                end_idx = i
                break

        needed = segments[start_idx:end_idx + 1]

        concat_file = os.path.join(os.path.dirname(out_path), 'concat.txt')
        try:
            with open(concat_file, 'w') as f:
                for seg_dur, seg_path in needed:
                    f.write(f"file '{seg_path}'\n")

            cmd = [
                'ffmpeg', '-y',
                '-f', 'concat',
                '-safe', '0',
                '-i', concat_file,
                '-ss', str(offset_in_segment),
                '-t', str(duration),
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-crf', '23',
                '-c:a', 'aac',
                '-avoid_negative_ts', 'make_zero',
                '-map_metadata', '-1',
                '-movflags', '+faststart',
                out_path
            ]

            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode == 0 and os.path.exists(out_path):
                thumb_path = os.path.splitext(out_path)[0] + '.jpg'
                subprocess.run([
                    'ffmpeg', '-y', 
                    '-ss', '1', 
                    '-i', out_path, 
                    '-vframes', '1', 
                    '-q:v', '2', 
                    thumb_path
                ], capture_output=True)
                
            if result.returncode != 0:
                raise subprocess.CalledProcessError(result.returncode, cmd)
        finally:
            if os.path.exists(concat_file):
                os.remove(concat_file)
    else:
        cmd = [
            'ffmpeg', '-y',
            '-ss', str(start),
            '-i', input_video,
            '-t', str(duration),
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-crf', '23',
            '-c:a', 'aac',
            '-avoid_negative_ts', 'make_zero',
            '-map_metadata', '-1',
            '-movflags', '+faststart',
            out_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode == 0 and os.path.exists(out_path):
            thumb_path = os.path.splitext(out_path)[0] + '.jpg'
            subprocess.run([
                'ffmpeg', '-y', 
                '-ss', '1', 
                '-i', out_path, 
                '-vframes', '1', 
                '-q:v', '2', 
                thumb_path
            ], capture_output=True)

def get_real_hls_duration(stream_id):
    index_path = os.path.join(VOD_FOLDER, stream_id, 'video', 'index.m3u8')
    if not os.path.exists(index_path):
        return 0
    duration = 0.0
    try:
        with open(index_path, 'r', encoding='utf-8') as f:
            for line in f:
                if line.startswith('#EXTINF:'):
                    duration += float(line.split(':')[1].split(',')[0])
    except Exception:
        pass
    return int(duration)

def render_clip_background(clip_dir, start, duration, stream_dir):
    out_path = os.path.join(clip_dir, 'clip.mp4')
    thumb_path = os.path.join(clip_dir, 'thumbnail.png')

    input_video, typ = get_input_video(stream_dir)
    if not input_video:
        return

    try:
        ffmpeg_cut_clip(input_video, typ, start, duration, out_path)

        if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
            cmd_thumb = [
                'ffmpeg', '-y',
                '-i', out_path,
                '-ss', '0.5',
                '-vframes', '1',
                '-q:v', '2',
                thumb_path
            ]
            subprocess.run(cmd_thumb, check=True, capture_output=True, text=True)
    except Exception as e:
        print(f"[CLIP] Error: {e}")

@vod_bp.route('/stream/info')
@login_required
def stream_info():
    channel = "fibii"
    access_token = get_twitch_access_token()
    if not access_token:
        return jsonify({'error': 'Twitch API nicht verfügbar'}), 503
    headers = {
        'Client-ID': TWITCH_CLIENT_ID,
        'Authorization': f'Bearer {access_token}'
    }
    stream_url = f'https://api.twitch.tv/helix/streams?user_login={channel}'
    try:
        resp = requests.get(stream_url, headers=headers, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            if data['data']:
                stream = data['data'][0]
                return jsonify({
                    'live': True,
                    'title': stream['title'],
                    'game': stream['game_name'],
                    'viewers': stream['viewer_count'],
                    'thumbnail': stream['thumbnail_url'].format(width=1280, height=720),
                    'started_at': stream['started_at'],
                    'stream_id': stream['id']
                })
            else:
                return jsonify({'live': False})
        else:
            return jsonify({'error': 'Twitch API Fehler'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@vod_bp.route('/vods')
@login_required
def list_vods():
    cleanup_old_clips()
    if not os.path.exists(VOD_FOLDER):
        return jsonify({'vods': []})
    sessions = []
    for stream_id in sorted(os.listdir(VOD_FOLDER), reverse=True):
        stream_path = os.path.join(VOD_FOLDER, stream_id)
        if not os.path.isdir(stream_path):
            continue
        meta_path = os.path.join(stream_path, 'meta.json')
        if not os.path.exists(meta_path):
            continue
        try:
            with open(meta_path, 'r', encoding='utf-8') as f:
                meta = json.load(f)
            thumbnail = f'/api/vod/{stream_id}/thumbnail.png'
            duration = 0
            if 'started_at' in meta and 'ended_at' in meta:
                s = datetime.fromisoformat(meta['started_at'].replace('Z', '+00:00'))
                e = datetime.fromisoformat(meta['ended_at'].replace('Z', '+00:00'))
                duration = int((e - s).total_seconds())

            thumb_disk = os.path.join(stream_path, 'thumbnail.png')
            sessions.append({
                'id': stream_id,
                'title': meta.get('title', 'Unbekannter Stream'),
                'game': meta.get('game', ''),
                'date': meta.get('started_at', ''),
                'ended_at': meta.get('ended_at'),
                'duration': duration,
                'thumbnail': thumbnail if os.path.exists(thumb_disk) else '/static/img/vod-placeholder.jpg'
            })
        except Exception:
            continue
    return jsonify({'vods': sessions})

@vod_bp.route('/vod/<stream_id>/info')
@login_required
def vod_info(stream_id):
    meta_path = os.path.join(VOD_FOLDER, stream_id, 'meta.json')
    if not os.path.exists(meta_path):
        return jsonify({'error': 'VOD nicht gefunden'}), 404
    try:
        with open(meta_path, 'r', encoding='utf-8') as f:
            meta = json.load(f)
        if 'started_at' in meta and 'ended_at' in meta:
            s = datetime.fromisoformat(meta['started_at'].replace('Z', '+00:00'))
            e = datetime.fromisoformat(meta['ended_at'].replace('Z', '+00:00'))
            meta['duration'] = int((e - s).total_seconds())

        stream_dir = os.path.join(VOD_FOLDER, stream_id)
        video_url = None
        video_type = None

        checks = [
            ('video/playlist.m3u8', 'hls'),
            ('video/index.m3u8', 'hls'),
            ('playlist.m3u8', 'hls'),
            ('index.m3u8', 'hls'),
            ('video.mp4', 'mp4'),
            (f'{stream_id}.mp4', 'mp4')
        ]

        for path, vtype in checks:
            if os.path.exists(os.path.join(stream_dir, path)):
                video_url = f'/api/vod/{stream_id}/{path}'
                video_type = vtype
                break

        meta['video_url'] = video_url
        meta['video_type'] = video_type

        return jsonify(meta)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@vod_bp.route('/clip/create', methods=['POST'])
@login_required
def create_clip():
    if not validate_csrf():
        return jsonify({'error': 'Invalid CSRF token'}), 403

    data = request.json
    stream_id = data.get('streamId')
    start = data.get('start')
    end = data.get('end')
    name = data.get('name')
    start_formatted = data.get('startFormatted', '00:00:00')
    end_formatted = data.get('endFormatted', '00:00:00')

    if not stream_id or start is None or end is None or not name:
        return jsonify({'error': 'Missing fields'}), 400

    hash_val = ''.join(random.choices(string.ascii_letters + string.digits, k=16))
    clip_dir = os.path.join(VOD_FOLDER, 'clips', hash_val)
    os.makedirs(clip_dir, exist_ok=True)

    creator = session.get('user', {}).get('name', 'Unknown')

    clip_data = {
        'id': hash_val,
        'stream_id': stream_id,
        'name': name,
        'creator': creator,
        'created_at': datetime.now().isoformat(),
        'start': start,
        'end': end,
        'start_formatted': start_formatted,
        'end_formatted': end_formatted
    }

    with open(os.path.join(clip_dir, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(clip_data, f, indent=2)

    stream_dir = os.path.join(VOD_FOLDER, stream_id)
    input_video, typ = get_input_video(stream_dir)

    if input_video:
        duration = float(end) - float(start)
        thread = threading.Thread(target=render_clip_background, args=(clip_dir, start, duration, stream_dir))
        thread.daemon = True
        thread.start()

    return jsonify({'hash': hash_val})

@vod_bp.route('/vod/clips/<clip_id>/<path:filename>')
def serve_clip_file(clip_id, filename):
    clip_dir = os.path.join(VOD_FOLDER, 'clips', clip_id)
    return send_from_directory(clip_dir, filename)

@vod_bp.route('/clip/<clip_id>/info')
def clip_info(clip_id):
    try:
        clip_dir = os.path.join(VOD_FOLDER, 'clips', clip_id)
        meta_path = os.path.join(clip_dir, 'meta.json')
        if not os.path.exists(meta_path):
            return jsonify({'error': 'Clip not found'}), 404

        with open(meta_path, 'r', encoding='utf-8') as f:
            clip_data = json.load(f)

        stream_id = clip_data.get('stream_id')
        if stream_id:
            stream_dir = os.path.join(VOD_FOLDER, stream_id)
            video_url = None
            video_type = None

            checks = [
                ('video/playlist.m3u8', 'hls'),
                ('video/index.m3u8', 'hls'),
                ('playlist.m3u8', 'hls'),
                ('index.m3u8', 'hls'),
                ('video.mp4', 'mp4'),
                (f'{stream_id}.mp4', 'mp4')
            ]

            for path, vtype in checks:
                if os.path.exists(os.path.join(stream_dir, path)):
                    video_url = f'/api/vod/{stream_id}/{path}'
                    video_type = vtype
                    break

            clip_data['video_url'] = video_url
            clip_data['video_type'] = video_type

        return jsonify(clip_data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@vod_bp.route('/clip/<clip_id>/status')
def clip_status(clip_id):
    clip_dir = os.path.join(VOD_FOLDER, 'clips', clip_id)
    mp4_path = os.path.join(clip_dir, 'clip.mp4')
    return jsonify({'ready': os.path.exists(mp4_path)})

@vod_bp.route('/clip/<clip_id>/download')
def download_clip(clip_id):
    try:
        clip_dir = os.path.join(VOD_FOLDER, 'clips', clip_id)
        meta_path = os.path.join(clip_dir, 'meta.json')
        out_path = os.path.join(clip_dir, 'clip.mp4')

        if not os.path.exists(meta_path):
            return jsonify({'error': 'Clip not found'}), 404

        with open(meta_path, 'r', encoding='utf-8') as f:
            clip_data = json.load(f)

        safe_name = re.sub(r'[\\/*?:"<>|]', "", clip_data.get('name', 'clip'))
        safe_name = safe_name.strip() or f"clip_{clip_id}"
        filename = f"{safe_name}.mp4"

        if os.path.exists(out_path):
            return send_file(out_path, as_attachment=True, download_name=filename)

        stream_id = clip_data.get('stream_id')
        start = float(clip_data.get('start', 0))
        duration = float(clip_data.get('end', 0)) - start

        stream_dir = os.path.join(VOD_FOLDER, stream_id)
        input_video, typ = get_input_video(stream_dir)

        if not input_video:
            return jsonify({'error': 'Source video not found'}), 404

        ffmpeg_cut_clip(input_video, typ, start, duration, out_path)
        return send_file(out_path, as_attachment=True, download_name=filename)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@vod_bp.route('/download/session__settings')
def download_chatty_settings():
    file_path = os.path.join('static', 'downloads', 'session__settings')
    if os.path.exists(file_path):
        return send_file(file_path, as_attachment=True, download_name='session__settings')
    else:
        return "File not found", 404

@vod_bp.route('/vod/<stream_id>/video/<path:filename>')
def serve_vod_video(stream_id, filename):
    stream_dir = os.path.join(VOD_FOLDER, stream_id, 'video')
    return send_from_directory(stream_dir, filename)

@vod_bp.route('/vod/<stream_id>/<path:filename>')
def serve_vod_base(stream_id, filename):
    stream_dir = os.path.join(VOD_FOLDER, stream_id)
    return send_from_directory(stream_dir, filename)