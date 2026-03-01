"""
Giveaway API Routes
"""
import os
import json
from flask import Blueprint, jsonify, request, session
from datetime import datetime
from app.decorators import login_required, api_role_required
from app.auth import validate_csrf, generate_csrf_token
from app.database import (
    get_giveaways, save_giveaways, generate_id, find_item_by_id, delete_item_from_list
)
from app.audit_logger import add_audit_log
from app.config import DATA_FOLDER

giveaway_bp = Blueprint('giveaway', __name__, url_prefix='/api')

@giveaway_bp.route('/giveaways', methods=['GET'])
@login_required
@api_role_required(['admin','dev','broadcaster','editor'])
def get_giveaways_api():
    giveaways = get_giveaways()
    for g in giveaways:
        g['code'] = '••••••••••••••••••'
        g['pin'] = '••••••'
    return jsonify({'giveaways': giveaways, 'csrf_token': generate_csrf_token()})

@giveaway_bp.route('/giveaways', methods=['POST'])
@login_required
@api_role_required(['admin','dev','broadcaster','editor'])
def add_giveaway_api():
    if not validate_csrf():
        return jsonify({'error': 'Invalid CSRF token'}), 403
    data = request.json
    if not data.get('code') or not data.get('pin'):
        return jsonify({'error': 'Code oder PIN fehlt'}), 400
    data['id'] = generate_id()
    data['timestamp'] = datetime.now().isoformat()
    data['used'] = data.get('used', False)
    data['winner'] = data.get('winner', '')
    giveaways = get_giveaways()
    giveaways.append(data)
    if save_giveaways(giveaways):
        add_audit_log(
            username=session['user']['name'],
            user_id=session['user']['id'],
            success=True,
            reason="Giveaway-Code erstellt",
            action_type="GIVEAWAY_CREATE",
            object_id=data['id'],
            object_name=data['code'],
            link_url=f"/giveaway#highlight={data['id']}",
            link_label="Code anzeigen"
        )
        return jsonify({'id': data['id'], 'status': 'success', 'csrf_token': generate_csrf_token()})
    else:
        return jsonify({'error': 'Speichern fehlgeschlagen'}), 500

@giveaway_bp.route('/giveaways/<item_id>', methods=['PUT'])
@login_required
@api_role_required(['admin','dev','broadcaster','editor'])
def update_giveaway_api(item_id):
    if not validate_csrf():
        return jsonify({'error': 'Invalid CSRF token'}), 403
    data = request.json
    filepath = os.path.join(DATA_FOLDER, 'giveaways.json')
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            giveaways_data = json.load(f)
        found = False
        giveaway_code = None
        for doc in giveaways_data.get('documents', []):
            if doc.get('id') == item_id:
                found = True
                if 'code' in doc.get('fields', {}):
                    giveaway_code = doc['fields']['code'].get('stringValue', 'Unbekannt')
                if 'used' in data:
                    doc['fields']['used'] = {'booleanValue': bool(data['used'])}
                if 'winner' in data:
                    doc['fields']['winner'] = {'stringValue': str(data['winner'])}
                break
        if not found:
            return jsonify({'error': 'Giveaway nicht gefunden'}), 404
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(giveaways_data, f, ensure_ascii=False, indent=2)
        changes = []
        if 'used' in data:
            changes.append(f"Status: {'vergeben' if data['used'] else 'offen'}")
        if 'winner' in data:
            changes.append(f"Gewinner: {data['winner']}")
        reason = "Giveaway-Code aktualisiert: " + ", ".join(changes)
        add_audit_log(
            username=session['user']['name'],
            user_id=session['user']['id'],
            success=True,
            reason=reason,
            action_type="GIVEAWAY_UPDATE",
            object_id=item_id,
            object_name=giveaway_code,
            link_url=f"/giveaway#highlight={item_id}",
            link_label="Code anzeigen"
        )
        return jsonify({'status': 'success', 'csrf_token': generate_csrf_token()})
    except Exception as e:
        return jsonify({'error': 'Speichern fehlgeschlagen'}), 500

@giveaway_bp.route('/giveaways/<item_id>', methods=['DELETE'])
@login_required
@api_role_required(['admin','dev','broadcaster','editor'])
def delete_giveaway_api(item_id):
    if not validate_csrf():
        return jsonify({'error': 'Invalid CSRF token'}), 403
    giveaways = get_giveaways()
    entry = find_item_by_id(giveaways, item_id)
    if delete_item_from_list(giveaways, item_id):
        if save_giveaways(giveaways):
            add_audit_log(
                username=session['user']['name'],
                user_id=session['user']['id'],
                success=True,
                reason="Giveaway-Code gelöscht",
                action_type="GIVEAWAY_DELETE",
                object_id=item_id,
                object_name=entry.get('code') if entry else 'Unbekannt',
                link_url="/giveaway",
                link_label=entry.get('code') if entry else 'Unbekannt'
            )
            return jsonify({'status': 'success', 'csrf_token': generate_csrf_token()})
        else:
            return jsonify({'error': 'Speichern fehlgeschlagen'}), 500
    else:
        return jsonify({'error': 'Giveaway nicht gefunden'}), 404

@giveaway_bp.route('/giveaways/<item_id>/code', methods=['GET'])
@login_required
@api_role_required(['admin','dev','broadcaster','editor'])
def get_giveaway_code(item_id):
    if not validate_csrf():
        return jsonify({'error': 'Invalid CSRF token'}), 403
    giveaways = get_giveaways()
    entry = find_item_by_id(giveaways, item_id)
    if not entry:
        return jsonify({'error': 'Giveaway nicht gefunden'}), 404
    add_audit_log(
        username=session['user']['name'],
        user_id=session['user']['id'],
        success=True,
        reason=f"Code abgerufen",
        action_type="GIVEAWAY_CODE_FETCH",
        object_id=item_id,
        object_name=entry.get('code', ''),
        link_url=f"/giveaway#highlight={item_id}",
        link_label="Code anzeigen"
    )
    return jsonify({
        'code': entry.get('code', ''),
        'pin': entry.get('pin', ''),
        'type': entry.get('type', ''),
        'csrf_token': generate_csrf_token()
    })