"""
Clip API Routes
"""
import requests
import concurrent.futures
from flask import Blueprint, jsonify, request, session
from datetime import datetime
from app.config import TWITCH_CLIENT_ID
from app.decorators import login_required, api_role_required
from app.auth import validate_csrf, generate_csrf_token
from app.database import (
    get_clips, save_clips, generate_id, find_item_by_id, delete_item_from_list
)
from app.audit_logger import add_audit_log
from app.twitch_api import get_twitch_access_token, fetch_clip_views

clips_bp = Blueprint('clips', __name__, url_prefix='/api')

@clips_bp.route('/clip-info', methods=['GET'])
@login_required
@api_role_required(['admin','dev','broadcaster','editor'])
def get_clip_info():
    slug = request.args.get('slug')
    if not slug:
        return jsonify({'error': 'Slug fehlt'}), 400
    try:
        access_token = get_twitch_access_token()
        if not access_token:
            return jsonify({'name': slug, 'thumbnail': f'https://clips-media-assets2.twitch.tv/{slug}.jpg', 'created_at': datetime.now().isoformat(), 'view_count': 0})
        headers = {
            'Client-ID': TWITCH_CLIENT_ID,
            'Authorization': f'Bearer {access_token}'
        }
        response = requests.get(f'https://api.twitch.tv/helix/clips?id={slug}', headers=headers, timeout=5)
        if response.status_code == 200:
            data = response.json()
            if data.get('data') and len(data['data']) > 0:
                clip_data = data['data'][0]
                thumbnail_url = clip_data.get('thumbnail_url', f'https://clips-media-assets2.twitch.tv/{slug}.jpg')
                return jsonify({
                    'name': clip_data.get('title', slug),
                    'thumbnail': thumbnail_url,
                    'created_at': clip_data.get('created_at', datetime.now().isoformat()),
                    'view_count': clip_data.get('view_count', 0)
                })
        return jsonify({'name': slug, 'thumbnail': f'https://clips-media-assets2.twitch.tv/{slug}.jpg', 'created_at': datetime.now().isoformat(), 'view_count': 0})
    except:
        return jsonify({'name': slug, 'thumbnail': f'https://clips-media-assets2.twitch.tv/{slug}.jpg', 'created_at': datetime.now().isoformat(), 'view_count': 0})

@clips_bp.route('/clips', methods=['GET'])
@login_required
@api_role_required(['admin','dev','broadcaster','editor'])
def get_clips_api():
    clips = get_clips()
    return jsonify({'clips': clips, 'csrf_token': generate_csrf_token()})

@clips_bp.route('/clips', methods=['POST'])
@login_required
@api_role_required(['admin','dev','broadcaster','editor'])
def add_clip_api():
    if not validate_csrf():
        return jsonify({'error': 'Invalid CSRF token'}), 403
    data = request.json
    if not data.get('slug'):
        return jsonify({'error': 'Clip Slug fehlt'}), 400
    data['id'] = generate_id()
    data['timestamp'] = data.get('timestamp', datetime.now().isoformat())
    data['views'] = data.get('views', 0)
    data['thumbnail'] = data.get('thumbnail', f'https://clips-media-assets2.twitch.tv/{data["slug"]}.jpg')
    data['name'] = data.get('name', data['slug'])
    partner = data.get('partner', 'kein')
    data['badge'] = f'badge-{partner}'
    date_attr = data.get('dateAttr', datetime.now().strftime('%Y-%m-%d'))
    data['dateDisplay'] = datetime.strptime(date_attr, '%Y-%m-%d').strftime('%d.%m.%Y')
    clips = get_clips()
    clips.append(data)
    if save_clips(clips):
        add_audit_log(
            username=session['user']['name'],
            user_id=session['user']['id'],
            success=True,
            reason="Clip erstellt",
            action_type="CLIP_CREATE",
            object_id=data['id'],
            object_name=data['name'],
            link_url=f"/clips#highlight={data['id']}",
            link_label="Clip anzeigen"
        )
        return jsonify({'id': data['id'], 'status': 'success', 'csrf_token': generate_csrf_token()})
    else:
        return jsonify({'error': 'Speichern fehlgeschlagen'}), 500

@clips_bp.route('/clips/<item_id>', methods=['DELETE'])
@login_required
@api_role_required(['admin','dev','broadcaster','editor'])
def delete_clip_api(item_id):
    if not validate_csrf():
        return jsonify({'error': 'Invalid CSRF token'}), 403
    clips = get_clips()
    clip = find_item_by_id(clips, item_id)
    if delete_item_from_list(clips, item_id):
        if save_clips(clips):
            add_audit_log(
                username=session['user']['name'],
                user_id=session['user']['id'],
                success=True,
                reason="Clip gelöscht",
                action_type="CLIP_DELETE",
                object_id=item_id,
                object_name=clip.get('name') if clip else 'Unbekannt',
                link_url="/clips",
                link_label=clip.get('name') if clip else 'Unbekannt'
            )
            return jsonify({'status': 'success', 'csrf_token': generate_csrf_token()})
        else:
            return jsonify({'error': 'Speichern fehlgeschlagen'}), 500
    else:
        return jsonify({'error': 'Clip nicht gefunden'}), 404

@clips_bp.route('/update-views', methods=['POST'])
@login_required
@api_role_required(['admin','dev','broadcaster','editor'])
def manual_update_views():
    if not validate_csrf():
        return jsonify({'error': 'Invalid CSRF token'}), 403
    try:
        access_token = get_twitch_access_token()
        if not access_token:
            return jsonify({'error': 'Twitch API nicht verfügbar'}), 500
        clips = get_clips()
        updated = False
        with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
            future_to_clip = {}
            for clip in clips:
                slug = clip.get('slug')
                if not slug:
                    continue
                future = executor.submit(fetch_clip_views, slug, access_token)
                future_to_clip[future] = clip
            for future in concurrent.futures.as_completed(future_to_clip):
                clip = future_to_clip[future]
                try:
                    new_views = future.result(timeout=5)
                    if new_views is not None and isinstance(clip.get('views'), int):
                        if new_views != clip['views']:
                            clip['views'] = new_views
                            updated = True
                except:
                    continue
        if updated:
            save_clips(clips)
        add_audit_log(
            username=session['user']['name'],
            user_id=session['user']['id'],
            success=True,
            reason="Clip-Aufrufe manuell aktualisiert",
            action_type="CLIP_VIEWS_UPDATE",
            object_id=None,
            object_name=None,
            link_url="/clips",
            link_label="Zu den Clips"
        )
        return jsonify({'status': 'success', 'updated': updated, 'csrf_token': generate_csrf_token()})
    except Exception as e:
        return jsonify({'error': str(e)}), 500