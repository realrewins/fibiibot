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

def render_clip_background(clip_dir, start, duration, stream_dir):
    out_path = os.path.join(clip_dir, 'clip.mp4')
    thumb_path = os.path.join(clip_dir, 'thumbnail.png')
    
    input_video, typ = get_input_video(stream_dir)
    if not input_video:
        return
    
    cmd_clip = [
        'ffmpeg', '-y',
        '-i', input_video,
        '-ss', str(start),
        '-t', str(duration),
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-c:a', 'aac',
        '-avoid_negative_ts', 'make_zero',
        '-map_metadata', '-1',
        out_path
    ]
    
    try:
        subprocess.run(cmd_clip, check=True, capture_output=True, text=True)
        
        if os.path.exists(out_path):
            cmd_thumb = [
                'ffmpeg', '-y',
                '-i', out_path,
                '-ss', '0.5',
                '-vframes', '1',
                '-q:v', '2',
                thumb_path
            ]
            subprocess.run(cmd_thumb, check=True, capture_output=True, text=True)
    except:
        pass

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
                start = datetime.fromisoformat(meta['started_at'].replace('Z', '+00:00'))
                end = datetime.fromisoformat(meta['ended_at'].replace('Z', '+00:00'))
                duration = int((end - start).total_seconds())
                
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
            start = datetime.fromisoformat(meta['started_at'].replace('Z', '+00:00'))
            end = datetime.fromisoformat(meta['ended_at'].replace('Z', '+00:00'))
            meta['duration'] = int((end - start).total_seconds())
            
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
    input_video, _ = get_input_video(stream_dir)
            
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
        input_video, _ = get_input_video(stream_dir)
                
        if not input_video:
            return jsonify({'error': 'Source video not found'}), 404
            
        cmd = [
            'ffmpeg', '-y',
            '-i', input_video,
            '-ss', str(start),
            '-t', str(duration),
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-crf', '23',
            '-c:a', 'aac',
            '-avoid_negative_ts', 'make_zero',
            '-map_metadata', '-1',
            out_path
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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