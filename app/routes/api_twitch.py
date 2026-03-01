"""
Twitch API Routes
"""
from flask import Blueprint, jsonify, request
from app.decorators import login_required
from app.twitch_api import get_twitch_follow_date

twitch_bp = Blueprint('twitch', __name__, url_prefix='/api')

@twitch_bp.route('/twitch/follow-date', methods=['GET'])
@login_required
def twitch_follow_date():
    username = request.args.get('username')
    if not username:
        return jsonify({'error': 'Username fehlt'}), 400
    
    username = username.lower().strip()
    if username.startswith('@'):
        username = username[1:]
    
    date = get_twitch_follow_date(username)
    if date:
        return jsonify({'date': date})
    else:
        return jsonify({'date': None})