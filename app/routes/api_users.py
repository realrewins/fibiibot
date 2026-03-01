"""
User Management API Routes
"""
from flask import Blueprint, jsonify, request, session
from app.decorators import admin_required
from app.auth import validate_csrf, generate_csrf_token
from app.database import (
    get_users_cached, check_user_whitelisted, get_user_role, save_users, 
    generate_id, DEFAULT_ROLE, MASTER_USER
)
from app.audit_logger import add_audit_log
from app.models.token_manager import delete_tokens_for_user

users_bp = Blueprint('users', __name__, url_prefix='/api')

@users_bp.route('/users', methods=['GET'])
@admin_required
def get_users_api():
    users = get_users_cached(force_reload=True)
    return jsonify({'users': users, 'csrf_token': generate_csrf_token()})

@users_bp.route('/users', methods=['POST'])
@admin_required
def add_user_api():
    if not validate_csrf():
        return jsonify({'error': 'Invalid CSRF token'}), 403
    data = request.json
    username = data.get('username', '').lower().strip()
    role = data.get('role', 'editor')
    if not username:
        return jsonify({'error': 'Username fehlt'}), 400
    if role not in ['admin', 'dev', 'broadcaster', 'editor', 'viewer']:
        return jsonify({'error': 'Ungültige Rolle'}), 400
    users = get_users_cached(force_reload=True)
    if check_user_whitelisted(username):
        return jsonify({'error': 'User existiert bereits'}), 409
    new_user = {
        'id': username,
        'username': username,
        'display_name': username,
        'roles': [role],
    }
    users.append(new_user)
    if save_users(users):
        add_audit_log(
            username=session['user']['name'],
            user_id=session['user']['id'],
            success=True,
            reason=f"Benutzer {username} mit Rolle {role} hinzugefügt",
            action_type="USER_CREATE",
            object_id=new_user['id'],
            object_name=username,
            link_url=None,
            link_label="Rollen öffnen"
        )
        return jsonify({'id': new_user['id'], 'status': 'success', 'csrf_token': generate_csrf_token()})
    else:
        return jsonify({'error': 'Speichern fehlgeschlagen'}), 500

@users_bp.route('/users/<username>/roles', methods=['POST'])
@admin_required
def add_role_to_user(username):
    if not validate_csrf():
        return jsonify({'error': 'Invalid CSRF token'}), 403
    data = request.json
    role = data.get('role')
    if not role or role not in ['admin', 'dev', 'broadcaster', 'editor', 'viewer']:
        return jsonify({'error': 'Ungültige Rolle'}), 400
    users = get_users_cached(force_reload=True)
    target_user = None
    for user in users:
        if user.get('username', '').lower() == username.lower():
            target_user = user
            break
    if not target_user:
        return jsonify({'error': 'User nicht gefunden'}), 404
    if 'roles' not in target_user:
        target_user['roles'] = [target_user.get('role', DEFAULT_ROLE)]
    if role not in target_user['roles']:
        target_user['roles'].append(role)
    if save_users(users):
        add_audit_log(
            username=session['user']['name'],
            user_id=session['user']['id'],
            success=True,
            reason=f"Rolle {role} zu {username} hinzugefügt",
            action_type="ROLE_ADD",
            object_id=username,
            object_name=username,
            link_url=None,
            link_label="Rollen öffnen"
        )
        return jsonify({'status': 'success', 'csrf_token': generate_csrf_token()})
    else:
        return jsonify({'error': 'Speichern fehlgeschlagen'}), 500

@users_bp.route('/users/<username>/roles', methods=['DELETE'])
@admin_required
def remove_role_from_user(username):
    if not validate_csrf():
        return jsonify({'error': 'Invalid CSRF token'}), 403
    role = request.args.get('role')
    if not role or role not in ['admin', 'dev', 'broadcaster', 'editor', 'viewer']:
        return jsonify({'error': 'Ungültige Rolle'}), 400
    users = get_users_cached(force_reload=True)
    target_user = None
    for user in users:
        if user.get('username', '').lower() == username.lower():
            target_user = user
            break
    if not target_user:
        return jsonify({'error': 'User nicht gefunden'}), 404
    if username.lower() == MASTER_USER.lower() and role == 'admin':
        return jsonify({'error': 'Master-Rolle kann nicht entfernt werden'}), 403
    if 'roles' not in target_user:
        target_user['roles'] = [target_user.get('role', DEFAULT_ROLE)]
    if role in target_user['roles']:
        target_user['roles'].remove(role)
    if not target_user['roles']:
        target_user['roles'] = [DEFAULT_ROLE]
    if save_users(users):
        add_audit_log(
            username=session['user']['name'],
            user_id=session['user']['id'],
            success=True,
            reason=f"Rolle {role} von {username} entfernt",
            action_type="ROLE_REMOVE",
            object_id=username,
            object_name=username,
            link_url=None,
            link_label="Rollen öffnen"
        )
        return jsonify({'status': 'success', 'csrf_token': generate_csrf_token()})
    else:
        return jsonify({'error': 'Speichern fehlgeschlagen'}), 500

@users_bp.route('/users/<username>', methods=['DELETE'])
@admin_required
def delete_user_api(username):
    if not validate_csrf():
        return jsonify({'error': 'Invalid CSRF token'}), 403
    if username.lower() == MASTER_USER:
        return jsonify({'error': 'Master User kann nicht gelöscht werden'}), 403
    users = get_users_cached(force_reload=True)
    user_index = -1
    for i, user in enumerate(users):
        user_uname = user.get('username') or user.get('name') or user.get('slug') or user.get('id')
        if user_uname and str(user_uname).lower() == username.lower():
            user_index = i
            break
    if user_index == -1:
        return jsonify({'error': 'User nicht gefunden'}), 404
    del users[user_index]
    if save_users(users):
        delete_tokens_for_user(username)
        add_audit_log(
            username=session['user']['name'],
            user_id=session['user']['id'],
            success=True,
            reason=f"Benutzer {username} gelöscht",
            action_type="USER_DELETE",
            object_id=username,
            object_name=username,
            link_url=None,
            link_label="Rollen öffnen"
        )
        return jsonify({'status': 'success', 'csrf_token': generate_csrf_token()})
    else:
        return jsonify({'error': 'Speichern fehlgeschlagen'}), 500