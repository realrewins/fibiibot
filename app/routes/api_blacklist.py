"""
Blacklist API Routes
"""
from flask import Blueprint, jsonify, request, session
from app.decorators import login_required, api_role_required
from app.auth import validate_csrf, generate_csrf_token
from app.database import get_blacklist, save_blacklist, generate_id, find_item_by_id, update_item_in_list, delete_item_from_list
from app.audit_logger import add_audit_log
from datetime import datetime

blacklist_bp = Blueprint('blacklist', __name__, url_prefix='/api')

@blacklist_bp.route('/blacklist', methods=['GET'])
@login_required
@api_role_required(['admin','dev','broadcaster','editor'])
def get_blacklist_api():
    blacklist = get_blacklist()
    return jsonify({'blacklist': blacklist, 'csrf_token': generate_csrf_token()})

@blacklist_bp.route('/blacklist', methods=['POST'])
@login_required
@api_role_required(['admin','dev','broadcaster','editor'])
def add_blacklist_api():
    if not validate_csrf():
        return jsonify({'error': 'Invalid CSRF token'}), 403
    data = request.json
    if not data.get('name'):
        return jsonify({'error': 'Name fehlt'}), 400
    data['id'] = generate_id()
    data['timestamp'] = datetime.now().isoformat()
    status_map = {
        'blacklist': 'Auf keinen Fall Mod',
        'ungern': 'Ungern Mod',
        'empfehlung': 'Mod Empfehlung'
    }
    data['statusText'] = status_map.get(data.get('status', 'blacklist'), 'blacklist')
    blacklist = get_blacklist()
    blacklist.append(data)
    if save_blacklist(blacklist):
        add_audit_log(
            username=session['user']['name'],
            user_id=session['user']['id'],
            success=True,
            reason="Blacklist-Eintrag erstellt",
            action_type="BLACKLIST_CREATE",
            object_id=data['id'],
            object_name=data['name'],
            link_url=f"/suggestions#highlight={data['id']}",
            link_label="Eintrag anzeigen"
        )
        return jsonify({'id': data['id'], 'status': 'success', 'csrf_token': generate_csrf_token()})
    else:
        return jsonify({'error': 'Speichern fehlgeschlagen'}), 500

@blacklist_bp.route('/blacklist/<item_id>', methods=['PUT'])
@login_required
@api_role_required(['admin','dev','broadcaster','editor'])
def update_blacklist_api(item_id):
    if not validate_csrf():
        return jsonify({'error': 'Invalid CSRF token'}), 403
    data = request.json
    status_map = {
        'blacklist': 'Auf keinen Fall Mod',
        'ungern': 'Ungern Mod',
        'empfehlung': 'Mod Empfehlung'
    }
    data['statusText'] = status_map.get(data.get('status', 'blacklist'), 'blacklist')
    blacklist = get_blacklist()
    old_entry = find_item_by_id(blacklist, item_id)
    if update_item_in_list(blacklist, item_id, data):
        if save_blacklist(blacklist):
            add_audit_log(
                username=session['user']['name'],
                user_id=session['user']['id'],
                success=True,
                reason="Blacklist-Eintrag bearbeitet",
                action_type="BLACKLIST_UPDATE",
                object_id=item_id,
                object_name=data.get('name', old_entry.get('name') if old_entry else 'Unbekannt'),
                link_url=f"/suggestions#highlight={item_id}",
                link_label="Eintrag anzeigen"
            )
            return jsonify({'status': 'success', 'csrf_token': generate_csrf_token()})
        else:
            return jsonify({'error': 'Speichern fehlgeschlagen'}), 500
    else:
        return jsonify({'error': 'Eintrag nicht gefunden'}), 404

@blacklist_bp.route('/blacklist/<item_id>', methods=['DELETE'])
@login_required
@api_role_required(['admin','dev','broadcaster','editor'])
def delete_blacklist_api(item_id):
    if not validate_csrf():
        return jsonify({'error': 'Invalid CSRF token'}), 403
    blacklist = get_blacklist()
    entry = find_item_by_id(blacklist, item_id)
    if delete_item_from_list(blacklist, item_id):
        if save_blacklist(blacklist):
            add_audit_log(
                username=session['user']['name'],
                user_id=session['user']['id'],
                success=True,
                reason="Blacklist-Eintrag gelöscht",
                action_type="BLACKLIST_DELETE",
                object_id=item_id,
                object_name=entry.get('name') if entry else 'Unbekannt',
                link_url="/suggestions",
                link_label=entry.get('name') if entry else 'Unbekannt'
            )
            return jsonify({'status': 'success', 'csrf_token': generate_csrf_token()})
        else:
            return jsonify({'error': 'Speichern fehlgeschlagen'}), 500
    else:
        return jsonify({'error': 'Eintrag nicht gefunden'}), 404