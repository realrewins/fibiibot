"""
OAuth & Login Routes
"""
import secrets
import requests
from flask import Blueprint, session, jsonify, request
from app.config import TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, BASE_URL
from app.auth import generate_csrf_token, validate_csrf, process_twitch_login, create_login_response
from app.decorators import login_required
from app.audit_logger import add_audit_log
from app.models.token_manager import delete_token
from app.database import get_user_role

auth_bp = Blueprint('auth', __name__)  # Kein url_prefix!

@auth_bp.route('/auth/immediate')
def auth_immediate():
    code = request.args.get('code')
    state = request.args.get('state')
    if not code or not state or state != session.get('oauth_state'):
        return jsonify({'error': 'Invalid request'}), 400
    try:
        token_params = {
            'client_id': TWITCH_CLIENT_ID,
            'client_secret': TWITCH_CLIENT_SECRET,
            'code': code,
            'grant_type': 'authorization_code',
            'redirect_uri': f"{BASE_URL}/auth/callback"
        }
        token_res = requests.post('https://id.twitch.tv/oauth2/token', data=token_params, timeout=5)
        if token_res.status_code != 200:
            return jsonify({'error': 'Token exchange failed'}), 401
        access_token = token_res.json().get('access_token')
        
        result, status = process_twitch_login(access_token)
        if status != 200:
            return jsonify(result), status
        
        csrf_token = generate_csrf_token()
        session.pop('oauth_state', None)
        return create_login_response(result['user'], csrf_token)
    except Exception as e:
        print(f"Exception in auth_immediate: {e}")
        return jsonify({'error': str(e)}), 500

@auth_bp.route('/api/login', methods=['POST'])
def api_login():
    data = request.json
    if data.get('check'):
        if 'user' in session:
            actual_role = get_user_role(session['user']['name'])
            if session['user']['role'] != actual_role:
                session['user']['role'] = actual_role
            return jsonify({
                'access': True,
                'user': session['user'],
                'csrf_token': generate_csrf_token()
            })
        return jsonify({'access': False}), 401
    code = data.get('code')
    state = data.get('state')
    if not code or not state:
        return jsonify({'error': 'Missing data'}), 400
    if state != session.get('oauth_state'):
        return jsonify({'error': 'Invalid state session'}), 403
    try:
        token_params = {
            'client_id': TWITCH_CLIENT_ID,
            'client_secret': TWITCH_CLIENT_SECRET,
            'code': code,
            'grant_type': 'authorization_code',
            'redirect_uri': f"{BASE_URL}/auth/callback"
        }
        token_res = requests.post('https://id.twitch.tv/oauth2/token', data=token_params, timeout=5)
        if token_res.status_code != 200:
            return jsonify({'error': 'Token exchange failed'}), 401
        access_token = token_res.json().get('access_token')
        
        result, status = process_twitch_login(access_token)
        if status != 200:
            return jsonify(result), status
        
        csrf_token = generate_csrf_token()
        session.pop('oauth_state', None)
        return create_login_response(result['user'], csrf_token)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@auth_bp.route('/api/logout', methods=['POST'])
@login_required
def api_logout():
    if not validate_csrf():
        return jsonify({'error': 'Invalid CSRF token'}), 403
    token = request.cookies.get('auth_token')
    if token:
        delete_token(token)
    if 'user' in session:
        add_audit_log(
            username=session['user']['name'],
            user_id=session['user']['id'],
            success=True,
            reason="Logout successful",
            action_type="LOGOUT",
            object_name=session['user']['name'],
            link_url=f"https://www.twitch.tv/{session['user']['name']}",
            link_label="Twitch Profile"
        )
    session.clear()
    from flask import make_response
    from app.config import SESSION_COOKIE_DOMAIN
    resp = jsonify({'status': 'success'})
    resp.delete_cookie('auth_token', domain=SESSION_COOKIE_DOMAIN)
    return resp

@auth_bp.route('/api/auth/url')
def api_get_auth_url():
    state = secrets.token_urlsafe(16)
    session['oauth_state'] = state
    scope = 'user:read:email user:read:subscriptions'
    url = f"https://id.twitch.tv/oauth2/authorize?client_id={TWITCH_CLIENT_ID}&redirect_uri={BASE_URL}/auth/callback&response_type=code&scope={scope}&state={state}"
    return jsonify({'url': url, 'state': state})