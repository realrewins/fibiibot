from functools import wraps
from flask import session, redirect, url_for, jsonify
from app.database import get_user_role

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user' not in session:
            return redirect(url_for('main.login'))
        return f(*args, **kwargs)
    return decorated_function

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user' not in session:
            return redirect(url_for('main.login'))
        role = session['user']['role']
        if role not in ['admin', 'dev', 'broadcaster']:
            return redirect(url_for('main.page_403'))
        return f(*args, **kwargs)
    return decorated_function

def role_required(allowed_roles):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if 'user' not in session:
                return redirect(url_for('main.login'))
            user_role = session['user'].get('role')
            if user_role not in allowed_roles:
                return redirect(url_for('main.page_403'))
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def api_role_required(allowed_roles):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if 'user' not in session:
                return jsonify({'error': 'Not logged in'}), 401
            user_role = session['user'].get('role')
            if user_role not in allowed_roles:
                return jsonify({'error': 'Insufficient permissions'}), 403
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def broadcaster_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user' not in session:
            return redirect(url_for('main.login'))
        role = session['user']['role']
        if role not in ['broadcaster', 'admin', 'dev']:
            return redirect(url_for('main.page_403'))
        return f(*args, **kwargs)
    return decorated_function