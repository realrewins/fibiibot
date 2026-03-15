"""
Flask-Anwendung Initialisierung
"""
import os
import json
import threading
from datetime import datetime, timedelta
from flask import Flask, render_template, request, session, redirect, url_for
from werkzeug.middleware.proxy_fix import ProxyFix

from app.config import (
    BASE_URL, SESSION_COOKIE_DOMAIN, SESSION_COOKIE_SECURE, SECRET_KEY,
    PERMANENT_SESSION_LIFETIME, DATA_FOLDER, VOD_FOLDER, CLIP_FOLDER,
    AUDIT_LOG_FILE, NOTIFICATION_FILE, BUG_REPORT_FILE, DEFAULT_ROLE, MASTER_USER
)
from app.decorators import login_required
from app.auth import generate_csrf_token
from app.database import get_user_role, get_users_cached
from app.models.token_manager import validate_token, cleanup_expired
from app.routes import register_blueprints
from app.twitch_api import update_clip_views

# ========== Flask-App Setup ==========
# Wichtig: template_folder und static_folder müssen auf die Root-Ordner zeigen
app = Flask(
    __name__,
    template_folder=os.path.join(os.path.dirname(__file__), '..', 'templates'),
    static_folder=os.path.join(os.path.dirname(__file__), '..', 'static')
)
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)
app.secret_key = SECRET_KEY
app.permanent_session_lifetime = PERMANENT_SESSION_LIFETIME
app.config['SESSION_COOKIE_DOMAIN'] = SESSION_COOKIE_DOMAIN
app.config['SESSION_COOKIE_SECURE'] = SESSION_COOKIE_SECURE
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

# ========== Middleware ==========
@app.before_request
def restore_user_from_token():
    """Stellt den Benutzer aus dem Auth-Token wieder her"""
    if 'user' in session:
        created = session.get('_created')
        if created:
            age = datetime.now() - datetime.fromisoformat(created)
            if age > timedelta(days=1):
                session.clear()
                return redirect(url_for('main.login'))
        current_role = session['user'].get('role')
        actual_role = get_user_role(session['user']['name'])
        if current_role != actual_role:
            session['user']['role'] = actual_role
        return

    token = request.cookies.get('auth_token')
    if token:
        username = validate_token(token)
        if username:
            role = get_user_role(username)
            session.permanent = True
            session['user'] = {
                'name': username,
                'role': role,
                'avatar': None,
                'id': None
            }
            session['_created'] = datetime.now().isoformat()

@app.after_request
def add_security_headers(response):
    """Fügt Sicherheits-Header hinzu"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response

@app.after_request
def remove_server_header(response):
    response.headers.pop('Server', None)
    return response

@app.after_request
def add_csp_header(response):
    response.headers['Content-Security-Policy'] = (
        "frame-src 'self' https://player.twitch.tv https://twitch.tv https://clips.twitch.tv;"
    )
    return response

# ========== Error Handler ==========
@app.errorhandler(404)
def not_found(error):
    from flask import jsonify
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    from flask import jsonify
    return jsonify({'error': 'Internal server error'}), 500

# ========== Database Initialization ==========
def init_database():
    """Initialisiert die Datenbank und Dateien"""
    os.makedirs(DATA_FOLDER, exist_ok=True)
    os.makedirs(VOD_FOLDER, exist_ok=True)
    os.makedirs(CLIP_FOLDER, exist_ok=True)
    
    files_to_check = [
        ('blacklist.json', []),
        ('clips.json', []),
        ('giveaways.json', []),
        ('users.json', {'documents': []}),
        ('notification.json', []),
        ('bug_report.json', []),
    ]
    for filename, default_data in files_to_check:
        filepath = os.path.join(DATA_FOLDER, filename)
        if not os.path.exists(filepath) or os.path.getsize(filepath) == 0:
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(default_data, f, ensure_ascii=False, indent=2)

    # Migration für alte Notifications
    notif_path = os.path.join(DATA_FOLDER, 'notification.json')
    try:
        with open(notif_path, 'r', encoding='utf-8') as f:
            old_notifs = json.load(f)
        if isinstance(old_notifs, list) and len(old_notifs) > 0 and 'target_user' in old_notifs[0]:
            new_notifs = []
            for n in old_notifs:
                new_n = {
                    'timestamp': n['timestamp'],
                    'from_user': n['from_user'],
                    'message': n['message'],
                    'type': n.get('type', 'system'),
                    'target_users': [n['target_user']],
                    'target_roles': [],
                    'read_by': {n['target_user']: n.get('read', False)}
                }
                if 'bug_id' in n:
                    new_n['bug_id'] = n['bug_id']
                new_notifs.append(new_n)
            with open(notif_path, 'w', encoding='utf-8') as f:
                json.dump(new_notifs, f, ensure_ascii=False, indent=2)
            print("Alte notifications konvertiert.")
    except Exception as e:
        print(f"Keine Konvertierung nötig oder Fehler: {e}")

    # Migration für Bug-Reports (FIX: kein KeyError wenn username fehlt)
    bug_path = os.path.join(DATA_FOLDER, 'bug_report.json')
    try:
        with open(bug_path, 'r', encoding='utf-8') as f:
            reports = json.load(f)
        changed = False
        for r in reports:
            if isinstance(r, dict) and 'username' in r:
                if 'display_name' not in r:
                    r['display_name'] = r.get('username', '')
                    changed = True
        if changed:
            with open(bug_path, 'w', encoding='utf-8') as f:
                json.dump(reports, f, ensure_ascii=False, indent=2)
    except FileNotFoundError:
        pass

    # Migration für Users
    from app.database import load_json_file, save_json_file
    users = load_json_file('users.json')
    changed = False
    for user in users:
        if 'role' in user and 'roles' not in user:
            user['roles'] = [user['role']]
            changed = True
        if 'roles' not in user:
            user['roles'] = [DEFAULT_ROLE]
            changed = True
        if not user['roles']:
            user['roles'] = [DEFAULT_ROLE]
            changed = True
        if 'display_name' not in user:
            user['display_name'] = user['username']
            changed = True
        if user.get('username', '').lower() == MASTER_USER.lower() and 'admin' not in user['roles']:
            user['roles'].append('admin')
            changed = True
    if changed:
        save_json_file('users.json', users)

    get_users_cached(force_reload=True)

    token_file = os.path.join(DATA_FOLDER, 'active_tokens.json')
    if not os.path.exists(token_file):
        with open(token_file, 'w') as f:
            json.dump({}, f)

    audit_path = os.path.join(DATA_FOLDER, 'audit_logs.json')
    if not os.path.exists(audit_path):
        with open(audit_path, 'w', encoding='utf-8') as f:
            json.dump([], f)

# ========== Register Blueprints ==========
register_blueprints(app)

# ========== Start Background Tasks ==========
def start_background_tasks():
    """Startet Background Tasks"""
    update_thread = threading.Thread(target=update_clip_views, daemon=True)
    update_thread.start()
    
    cleanup_thread = threading.Thread(target=cleanup_expired, daemon=True)
    cleanup_thread.start()
    
    print("Background Tasks gestartet")

if __name__ == '__main__':
    init_database()
    start_background_tasks()
    app.run(debug=False, host='0.0.0.0', port=5000, threaded=True)