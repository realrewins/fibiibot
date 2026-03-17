from flask import Blueprint, render_template, session, redirect, url_for, send_file, jsonify
from app.decorators import login_required, role_required
from app.auth import generate_csrf_token
import os

main_bp = Blueprint('main', __name__)

@main_bp.route('/')
def index():
    if 'user' not in session:
        return redirect(url_for('main.login'))
    csrf_token = generate_csrf_token()
    return render_template('dashboard.html', csrf_token=csrf_token, user=session['user'], current_page='dashboard')

@main_bp.route('/login')
def login():
    if 'user' in session:
        return redirect(url_for('main.index'))
    return render_template('login.html')

@main_bp.route('/auth/callback')
def auth_callback():
    return render_template('callback.html')

@main_bp.route('/guide')
@login_required
@role_required(['admin','dev','broadcaster','editor'])
def guide():
    return render_template('guide.html', csrf_token=generate_csrf_token(), user=session['user'], current_page='guide')

@main_bp.route('/clips')
@login_required
@role_required(['admin','dev','broadcaster','editor'])
def clips():
    return render_template('clips.html', csrf_token=generate_csrf_token(), user=session['user'], current_page='clips')

@main_bp.route('/suggestions')
@login_required
@role_required(['admin','dev','broadcaster','editor'])
def suggestions():
    return render_template('suggestions.html', csrf_token=generate_csrf_token(), user=session['user'], current_page='suggestions')

@main_bp.route('/giveaway')
@login_required
@role_required(['admin','dev','broadcaster','editor'])
def giveaway():
    return render_template('giveaway.html', csrf_token=generate_csrf_token(), user=session['user'], current_page='giveaway')

@main_bp.route('/bugs')
@login_required
@role_required(['admin','dev','broadcaster'])
def bugs_page():
    return render_template('bugs.html', csrf_token=generate_csrf_token(), user=session['user'], current_page='bugs')

@main_bp.route('/settings')
@login_required
def settings_page():
    return render_template('settings.html', csrf_token=generate_csrf_token(), user=session['user'], current_page='settings')

@main_bp.route('/bot')
@login_required
@role_required(['admin','dev','broadcaster','editor'])
def bot_page():
    return render_template('bot.html', csrf_token=generate_csrf_token(), user=session['user'], current_page='bot')

@main_bp.route('/vod')
@login_required
def vod_page():
    return render_template('vod.html', csrf_token=generate_csrf_token(), user=session['user'], current_page='vod')

@main_bp.route('/vod/clips/<clip_id>')
def view_clip(clip_id):
    try:
        return render_template('vodclip.html', clip_id=clip_id)
    except Exception:
        return "Template vodclip.html nicht gefunden.", 500

@main_bp.route('/403')
@login_required
def 403_page():
    return render_template('403.html', csrf_token=generate_csrf_token(), user=session['user'], current_page='403')

@main_bp.route('/download/<filename>')
@login_required
def download_file(filename):
    try:
        allowed_files = ['session__settings']
        
        if filename not in allowed_files:
            return jsonify({'error': 'File not allowed'}), 403
        
        file_path = os.path.join(os.path.dirname(__file__), '..', '..', 'static', 'downloads', filename)
        file_path = os.path.abspath(file_path)
        
        if not os.path.exists(file_path):
            return jsonify({'error': 'File not found'}), 404
        
        return send_file(file_path, as_attachment=True, download_name=filename)
    except Exception as e:
        return jsonify({'error': str(e)}), 500