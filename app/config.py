"""
Konfiguration & Konstanten
"""
import os
import secrets
from datetime import timedelta

# Umgebungsvariablen laden
def load_env_manually():
    env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
    try:
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    os.environ[key.strip()] = value.strip()
    except FileNotFoundError:
        pass

load_env_manually()

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
VOD_FOLDER = os.path.join(BASE_DIR, 'vod')

# ========== BASE-KONFIGURATION ==========
BASE_URL = os.environ.get('BASE_URL', 'http://localhost:5000').rstrip('/')
SESSION_COOKIE_SECURE = BASE_URL.startswith('https://')
SESSION_COOKIE_DOMAIN = ('.' + BASE_URL.split('://')[1].split('/')[0]) if SESSION_COOKIE_SECURE else None

SECRET_KEY = os.environ.get('SECRET_KEY', secrets.token_hex(32))
PERMANENT_SESSION_LIFETIME = timedelta(days=1)

# ========== TWITCH-KONFIGURATION ==========
TWITCH_CLIENT_ID = os.environ.get('TWITCH_CLIENT_ID', '')
TWITCH_CLIENT_SECRET = os.environ.get('TWITCH_CLIENT_SECRET', '')
TWITCH_REDIRECT_URI = f"{BASE_URL}/auth/callback"

TWITCH_GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"
TWITCH_GQL_OAUTH_TOKEN = os.environ.get('TWITCH_GQL_OAUTH_TOKEN', '')
TWITCH_CHANNEL_LOGIN = "fibii"

# ========== USER-KONFIGURATION ==========
MASTER_USER = 'xqirby'
DEFAULT_ROLE = 'editor'

ROLE_HIERARCHY = {
    'admin': 1,
    'dev': 1,
    'broadcaster': 2,
    'editor': 3,
    'viewer': 4
}

# ========== PFADE & DATEIEN ==========
DATA_FOLDER = 'data'
VOD_FOLDER = 'vod'
CLIP_FOLDER = os.path.join(DATA_FOLDER, 'clips')

AUDIT_LOG_FILE = os.path.join(DATA_FOLDER, 'audit_logs.json')
NOTIFICATION_FILE = os.path.join(DATA_FOLDER, 'notification.json')
BUG_REPORT_FILE = os.path.join(DATA_FOLDER, 'bug_report.json')

# ========== DASHBOARD-API ==========
DASHBOARD_API_KEY = os.environ.get('DASHBOARD_API_KEY', '')
API_BASE_URL = "http://127.0.0.1:7777"