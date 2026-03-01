"""
Benachrichtigungssystem
"""
import os
import json
import threading
from datetime import datetime, timezone
from app.config import NOTIFICATION_FILE
from app.audit_logger import add_audit_log
from app.database import get_users_cached

notification_lock = threading.Lock()

def send_notification(recipients_type, recipients, message, sender='user', session_user=None):
    """Sendet eine Benachrichtigung"""
    if sender == 'user':
        from_user = session_user['name'] if session_user else 'Unknown'
    elif sender == 'admin':
        if session_user and session_user.get('role') not in ['admin', 'dev']:
            return {'error': 'Nicht berechtigt als Admin zu senden'}, 403
        from_user = 'Admin'
    elif sender == 'server':
        from_user = 'Server'
    else:
        return {'error': 'Ungültiger Absender'}, 400

    target_users = []
    target_roles = []

    if recipients_type == 'all':
        users = get_users_cached()
        target_users = [u.get('username') for u in users if u.get('username')]
    elif recipients_type == 'roles':
        target_roles = recipients
        if not target_roles:
            return {'error': 'Keine Rollen angegeben'}, 400
        valid_roles = ['admin', 'dev', 'broadcaster', 'editor', 'viewer']
        for r in target_roles:
            if r not in valid_roles:
                return {'error': f'Ungültige Rolle: {r}'}, 400
    elif recipients_type == 'users':
        target_users = recipients
        if not target_users:
            return {'error': 'Keine Benutzer angegeben'}, 400
    else:
        return {'error': 'Ungültiger Empfängertyp'}, 400

    new_notif = {
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'from_user': from_user,
        'message': message,
        'type': 'system',
        'target_users': target_users,
        'target_roles': target_roles,
        'read_by': {}
    }

    with notification_lock:
        try:
            with open(NOTIFICATION_FILE, 'r', encoding='utf-8') as f:
                existing = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            existing = []
        existing.append(new_notif)
        if len(existing) > 5000:
            existing = existing[-5000:]
        with open(NOTIFICATION_FILE, 'w', encoding='utf-8') as f:
            json.dump(existing, f, ensure_ascii=False, indent=2)

    if session_user:
        add_audit_log(
            username=session_user['name'],
            user_id=session_user['id'],
            success=True,
            reason=f"Systemnachricht gesendet (target_roles={target_roles}, target_users={len(target_users)})",
            action_type="NOTIFICATION_SEND"
        )

    return {
        'status': 'success',
        'sent_to': len(target_users) if target_users else f"{len(target_roles)} Rolle(n)"
    }, 200

def get_notifications_for_user(username, user_role):
    """Gibt Benachrichtigungen für einen Benutzer zurück"""
    with notification_lock:
        try:
            with open(NOTIFICATION_FILE, 'r', encoding='utf-8') as f:
                notifications = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            notifications = []

    user_notifications = []
    for notif in notifications:
        include = False
        if notif.get('target_users') and username in notif['target_users']:
            include = True
        elif notif.get('target_roles') and user_role in notif['target_roles']:
            include = True
        elif not notif.get('target_users') and not notif.get('target_roles'):
            include = True

        if include:
            read = notif.get('read_by', {}).get(username, False)
            notif_copy = notif.copy()
            notif_copy['read'] = read
            notif_copy.pop('read_by', None)
            notif_copy.pop('target_users', None)
            notif_copy.pop('target_roles', None)
            user_notifications.append(notif_copy)

    user_notifications.sort(key=lambda x: x['timestamp'], reverse=True)
    return user_notifications

def mark_notifications_read(username, user_role):
    """Markiert Benachrichtigungen als gelesen"""
    with notification_lock:
        try:
            with open(NOTIFICATION_FILE, 'r', encoding='utf-8') as f:
                notifications = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            notifications = []
        
        changed = False
        for n in notifications:
            include = False
            if n.get('target_users') and username in n['target_users']:
                include = True
            elif n.get('target_roles') and user_role in n['target_roles']:
                include = True
            elif not n.get('target_users') and not n.get('target_roles'):
                include = True

            if include:
                if 'read_by' not in n:
                    n['read_by'] = {}
                if not n['read_by'].get(username, False):
                    n['read_by'][username] = True
                    changed = True
        
        if changed:
            with open(NOTIFICATION_FILE, 'w', encoding='utf-8') as f:
                json.dump(notifications, f, ensure_ascii=False, indent=2)