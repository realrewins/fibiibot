"""
Custom Decorators für Authentifizierung und Autorisierung
"""
from functools import wraps
from flask import session, redirect, url_for, jsonify, render_template

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user' not in session:
            return jsonify({'error': 'Not logged in'}), 401
        role = session['user']['role']
        if role not in ['admin', 'dev', 'broadcaster']:
            return jsonify({'error': 'Insufficient permissions'}), 403
        return f(*args, **kwargs)
    return decorated_function

def role_required(allowed_roles):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if 'user' not in session:
                return redirect(url_for('login'))
            if session['user']['role'] not in allowed_roles:
                return render_template('403.html'), 403
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def api_role_required(allowed_roles):
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if 'user' not in session:
                return jsonify({'error': 'Not logged in'}), 401
            if session['user']['role'] not in allowed_roles:
                return jsonify({'error': 'Insufficient permissions'}), 403
            return f(*args, **kwargs)
        return decorated_function
    return decorator