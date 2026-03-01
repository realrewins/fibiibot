"""
Audit-Logging System
"""
import os
import json
import threading
from datetime import datetime, timezone

AUDIT_LOG_FILE = os.path.join('data', 'audit_logs.json')
audit_lock = threading.Lock()

def add_audit_log(username, user_id=None, success=True, reason="", action_type=None, 
                  object_id=None, object_name=None, link_url=None, link_label=None):
    """Fügt einen Audit-Log-Eintrag hinzu"""
    try:
        from flask import session
        if user_id is None:
            user_id = session.get('user', {}).get('id', None)
        if username is None:
            username = session.get('user', {}).get('name', 'unknown')
    except:
        pass

    log_entry = {
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'username': username,
        'user_id': user_id,
        'success': success,
        'reason': reason,
        'action_type': action_type,
        'object_id': object_id,
        'object_name': object_name,
        'link_url': link_url,
        'link_label': link_label
    }

    try:
        with audit_lock:
            try:
                with open(AUDIT_LOG_FILE, 'r', encoding='utf-8') as f:
                    logs = json.load(f)
            except (FileNotFoundError, json.JSONDecodeError):
                logs = []
            
            logs.append(log_entry)
            if len(logs) > 10000:
                logs = logs[-10000:]
            
            with open(AUDIT_LOG_FILE, 'w', encoding='utf-8') as f:
                json.dump(logs, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[AuditLog] Fehler beim Schreiben: {e}")

def get_audit_logs(limit=1000):
    """Ruft die letzten Audit-Logs ab"""
    try:
        with audit_lock:
            try:
                with open(AUDIT_LOG_FILE, 'r', encoding='utf-8') as f:
                    logs = json.load(f)
            except (FileNotFoundError, json.JSONDecodeError):
                logs = []
        logs.sort(key=lambda x: x['timestamp'], reverse=True)
        return logs[:limit]
    except Exception as e:
        print(f"[AuditLog] Fehler beim Lesen: {e}")
        return []