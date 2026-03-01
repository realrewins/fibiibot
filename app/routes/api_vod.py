"""
VOD API Routes
"""
import os
import json
from flask import Blueprint, jsonify, send_from_directory, request
from datetime import datetime
from app.decorators import login_required
from app.config import VOD_FOLDER

vod_bp = Blueprint('vod', __name__, url_prefix='/api')

@vod_bp.route('/stream/info')
@login_required
def stream_info():
    from app.config import TWITCH_CLIENT_ID
    from app.twitch_api import get_twitch_access_token
    import requests
    
    channel = "letshugotv"
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
        print(f"Fehler bei Stream-Info: {e}")
        return jsonify({'error': str(e)}), 500

@vod_bp.route('/vods')
@login_required
def list_vods():
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
            thumbnail = f'/vod/{stream_id}/thumbnail.png'
            duration = 0
            if 'started_at' in meta and 'ended_at' in meta:
                start = datetime.fromisoformat(meta['started_at'].replace('Z', '+00:00'))
                end = datetime.fromisoformat(meta['ended_at'].replace('Z', '+00:00'))
                duration = int((end - start).total_seconds())
            sessions.append({
                'id': stream_id,
                'title': meta.get('title', 'Unbekannter Stream'),
                'game': meta.get('game', ''),
                'date': meta.get('started_at', ''),
                'duration': duration,
                'thumbnail': thumbnail if os.path.exists(os.path.join(stream_path, 'thumbnail.png')) else '/static/img/vod-placeholder.jpg'
            })
        except Exception as e:
            print(f"Fehler beim Verarbeiten von {stream_id}: {e}")
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
        return jsonify(meta)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@vod_bp.route('/download/session__settings')
def download_chatty_settings():
    file_path = os.path.join('static', 'downloads', 'session__settings')
    if os.path.exists(file_path):
        from flask import send_file
        return send_file(file_path, as_attachment=True, download_name='session__settings')
    else:
        return "File not found", 404

@vod_bp.route('/vod/<path:filename>')
@login_required
def serve_vod(filename):
    return send_from_directory(VOD_FOLDER, filename)

@vod_bp.route('/clip/create', methods=['POST'])
@login_required
def create_clip():
    from app.auth import validate_csrf
    from app.config import CLIP_FOLDER
    import secrets
    
    if not validate_csrf():
        return jsonify({'error': 'Invalid CSRF token'}), 403
    data = request.json
    stream_id = data.get('streamId')
    start = data.get('start')
    end = data.get('end')
    name = data.get('name')
    if not stream_id or start is None or end is None or not name:
        return jsonify({'error': 'Missing fields'}), 400
    vod_dir = os.path.join(VOD_FOLDER, stream_id)
    if not os.path.isdir(vod_dir):
        return jsonify({'error': 'Stream not found'}), 404
    hash = secrets.token_urlsafe(16)
    clip_data = {
        'hash': hash,
        'stream_id': stream_id,
        'start': start,
        'end': end,
        'name': name,
        'created_by': request.environ.get('HTTP_X_REMOTE_USER', 'unknown'),
        'created_at': datetime.now().__str__()
    }
    os.makedirs(CLIP_FOLDER, exist_ok=True)
    clip_file = os.path.join(CLIP_FOLDER, f'{hash}.json')
    with open(clip_file, 'w', encoding='utf-8') as f:
        json.dump(clip_data, f, indent=2)
    return jsonify({'hash': hash})

@vod_bp.route('/clip/download/<hash>')
@login_required
def download_clip(hash):
    from app.config import CLIP_FOLDER
    clip_file = os.path.join(CLIP_FOLDER, f'{hash}.json')
    if not os.path.exists(clip_file):
        return jsonify({'error': 'Clip not found'}), 404
    with open(clip_file, 'r') as f:
        clip = json.load(f)
    return jsonify({'message': 'Download not yet implemented', 'clip': clip})