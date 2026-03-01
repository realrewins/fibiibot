"""
Seiten-Routen (Hauptseiten)
"""
from flask import Blueprint, render_template, session, redirect, url_for
from app.decorators import login_required, role_required
from app.auth import generate_csrf_token

main_bp = Blueprint('main', __name__)

@main_bp.route('/')
def index():
    if 'user' not in session:
        return redirect(url_for('auth.login'))
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