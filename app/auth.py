"""
Authentifizierung & OAuth
"""
import secrets
import requests
import hmac
from flask import session, jsonify, make_response, request, url_for
from datetime import datetime
from app.config import TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, SESSION_COOKIE_SECURE, SESSION_COOKIE_DOMAIN, BASE_URL
from app.database import get_users_cached, check_user_whitelisted, get_user_role, save_users
from app.twitch_api import get_broadcaster_id, is_user_subscribed
from app.audit_logger import add_audit_log
from app.models.token_manager import create_token, delete_token

def get_twitch_redirect_uri():
    """Gibt die Redirect-URI für Twitch zurück"""
    return f"{BASE_URL}/auth/callback"

def generate_csrf_token():
    """Generiert einen CSRF-Token"""
    if 'csrf_token' not in session:
        session['csrf_token'] = secrets.token_hex(32)
    return session['csrf_token']

def validate_csrf():
    """Validiert einen CSRF-Token"""
    from flask import request
    if request.method in ['POST', 'PUT', 'DELETE', 'PATCH']:
        token = request.headers.get('X-CSRF-Token') or (request.json.get('csrf_token') if request.is_json else request.form.get('csrf_token'))
        if not token or not hmac.compare_digest(token, session.get('csrf_token', '')):
            return False
    return True

def process_twitch_login(access_token):
    """Verarbeitet einen Twitch-Login"""
    try:
        headers = {'Authorization': f'Bearer {access_token}', 'Client-Id': TWITCH_CLIENT_ID}
        response = requests.get('https://api.twitch.tv/helix/users', headers=headers, timeout=5)
        if response.status_code != 200:
            return {'error': 'Invalid user request'}, 401
        
        user_data = response.json()['data'][0]
        username = user_data['login'].lower()
        display_name = user_data['display_name']
        user_id = user_data['id']

        broadcaster_id = get_broadcaster_id()
        is_sub = False
        if broadcaster_id:
            is_sub = is_user_subscribed(broadcaster_id, user_id)

        get_users_cached(force_reload=True)
        is_whitelisted = check_user_whitelisted(username)

        if not is_whitelisted:
            if not is_sub:
                add_audit_log(username=username, user_id=user_id, success=False, 
                            reason="Nicht subskribiert und nicht whitelisted", action_type="LOGIN_FAILED")
                return {'error': 'Du bist kein Abonnent von fibii und daher nicht zugelassen.'}, 403

            users = get_users_cached(force_reload=True)
            new_user = {
                'id': username,
                'username': username,
                'display_name': display_name,
                'roles': ['viewer']
            }
            users.append(new_user)
            save_success = save_users(users)
            if not save_success:
                return {'error': 'Fehler beim Speichern des Benutzers'}, 500
            user_role = 'viewer'
            add_audit_log(username=username, user_id=user_id, success=True, 
                        reason="Neuer Subscriber als viewer angelegt", action_type="USER_CREATE")
        else:
            users = get_users_cached(force_reload=True)
            for u in users:
                if u.get('username') == username:
                    if u.get('display_name') != display_name:
                        u['display_name'] = display_name
                        save_users(users)
                    break
            user_role = get_user_role(username)

        session.permanent = True
        session['user'] = {
            'name': username,
            'display_name': display_name,
            'role': user_role,
            'avatar': user_data['profile_image_url'],
            'id': user_id
        }
        session['_created'] = datetime.now().isoformat()
        add_audit_log(username=username, user_id=user_id, success=True, 
                    reason="Login successful", action_type="LOGIN_SUCCESS")

        return {
            'user': session['user'],
            'access': True
        }, 200
    except Exception as e:
        print(f"Exception in process_twitch_login: {e}")
        return {'error': str(e)}, 500

def create_login_response(user_data, csrf_token):
    """Erstellt eine Login-Response mit Cookie"""
    token, expires = create_token(user_data['name'])
    resp = make_response(jsonify({
        'access': True,
        'user': user_data,
        'redirect': url_for('index'),
        'csrf_token': csrf_token
    }))
    resp.set_cookie(
        'auth_token',
        value=token,
        expires=datetime.fromisoformat(expires),
        secure=SESSION_COOKIE_SECURE,
        httponly=True,
        samesite='Strict',
        domain=SESSION_COOKIE_DOMAIN
    )
    return resp