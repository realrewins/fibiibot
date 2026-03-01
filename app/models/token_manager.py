"""
Token-Manager für Auth-Tokens
"""
import os
import json
import secrets
import threading
from datetime import datetime, timedelta

TOKEN_FILE = os.path.join('data', 'active_tokens.json')
token_lock = threading.Lock()

def create_token(username):
    """Erstellt einen neuen Auth-Token"""
    token = secrets.token_urlsafe(32)
    expires = datetime.now() + timedelta(days=7)
    expires_str = expires.isoformat()
    
    with token_lock:
        try:
            with open(TOKEN_FILE, 'r') as f:
                tokens = json.load(f)
        except:
            tokens = {}
        
        tokens[token] = {
            'username': username,
            'expires': expires_str
        }
        
        with open(TOKEN_FILE, 'w') as f:
            json.dump(tokens, f, indent=2)
    
    return token, expires_str

def validate_token(token):
    """Validiert einen Token und gibt den Benutzernamen zurück"""
    with token_lock:
        try:
            with open(TOKEN_FILE, 'r') as f:
                tokens = json.load(f)
        except:
            return None
        
        if token in tokens:
            data = tokens[token]
            expires = datetime.fromisoformat(data['expires'])
            if datetime.now() < expires:
                return data['username']
            else:
                del tokens[token]
                with open(TOKEN_FILE, 'w') as f:
                    json.dump(tokens, f, indent=2)
                return None
    return None

def delete_token(token):
    """Löscht einen Token"""
    with token_lock:
        try:
            with open(TOKEN_FILE, 'r') as f:
                tokens = json.load(f)
        except:
            return
        
        if token in tokens:
            del tokens[token]
            with open(TOKEN_FILE, 'w') as f:
                json.dump(tokens, f, indent=2)

def delete_tokens_for_user(username):
    """Löscht alle Tokens eines Benutzers"""
    with token_lock:
        try:
            with open(TOKEN_FILE, 'r') as f:
                tokens = json.load(f)
        except:
            return
        
        tokens_to_delete = [t for t, data in tokens.items() if data.get('username') == username]
        for t in tokens_to_delete:
            del tokens[t]
        
        with open(TOKEN_FILE, 'w') as f:
            json.dump(tokens, f, indent=2)

def cleanup_expired():
    """Entfernt abgelaufene Tokens (Background-Task)"""
    import time
    while True:
        time.sleep(3600)  # Alle 1 Stunde
        with token_lock:
            try:
                with open(TOKEN_FILE, 'r') as f:
                    tokens = json.load(f)
            except:
                continue
            
            now = datetime.now()
            expired = [t for t, data in tokens.items() if datetime.fromisoformat(data['expires']) < now]
            
            for t in expired:
                del tokens[t]
            
            if expired:
                with open(TOKEN_FILE, 'w') as f:
                    json.dump(tokens, f, indent=2)