"""
Debug & Health Check Routes
"""
from flask import Blueprint, jsonify, session
from datetime import datetime
from app.decorators import login_required, admin_required
from app.database import get_users_cached, get_user_role, check_user_whitelisted
from app.config import ROLE_HIERARCHY

debug_bp = Blueprint('debug', __name__, url_prefix='/api')

@debug_bp.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'online',
        'login_enabled': True,
        'timestamp': datetime.now().isoformat()
    })

@debug_bp.route('/debug/me', methods=['GET'])
@login_required
def debug_me():
    username = session['user']['name']
    users = get_users_cached(force_reload=True)
    user_data = None
    for u in users:
        if u.get('username', '').lower() == username.lower():
            user_data = u
            break
    return jsonify({
        'session': session['user'],
        'cached_role': get_user_role(username),
        'user_data': user_data,
        'whitelisted': check_user_whitelisted(username),
        'role_hierarchy': ROLE_HIERARCHY
    })

@debug_bp.route('/dashboard/stats', methods=['GET'])
@login_required
def get_stream_stats():
    from app.config import DASHBOARD_API_KEY, API_BASE_URL
    import requests
    
    if not DASHBOARD_API_KEY:
        return jsonify({"error": "API-Key nicht konfiguriert"}), 500
    try:
        url = f"{API_BASE_URL}/v1/streamer/220716126/fibii/dashboard/stats"
        headers = {"X-API-Key": DASHBOARD_API_KEY}
        response = requests.get(url, headers=headers, timeout=5)
        if response.status_code == 200:
            return jsonify(response.json())
        else:
            return jsonify({"error": f"API-Fehler: {response.status_code}", "details": response.text}), response.status_code
    except Exception as e:
        return jsonify({"error": f"API nicht erreichbar: {str(e)}"}), 503