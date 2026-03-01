"""
Notifications API Routes
"""
from flask import Blueprint, jsonify, request, session
from app.decorators import login_required, api_role_required
from app.auth import validate_csrf, generate_csrf_token
from app.notifications import send_notification, get_notifications_for_user, mark_notifications_read

notifications_bp = Blueprint('notifications', __name__, url_prefix='/api')

@notifications_bp.route('/notifications/send', methods=['POST'])
@login_required
@api_role_required(['admin','dev'])
def send_notification_api():
    if not validate_csrf():
        return jsonify({'error': 'Invalid CSRF token'}), 403

    data = request.json
    recipients_type = data.get('recipients_type')
    recipients = data.get('recipients')
    message = data.get('message', '').strip()
    sender_type = data.get('sender', 'user')

    if not message:
        return jsonify({'error': 'Nachricht darf nicht leer sein'}), 400

    result, status = send_notification(recipients_type, recipients, message, sender_type, session['user'])
    return jsonify(result), status

@notifications_bp.route('/notifications', methods=['GET'])
@login_required
def get_notifications():
    username = session['user']['name']
    user_role = session['user']['role']
    notifications = get_notifications_for_user(username, user_role)
    return jsonify({'notifications': notifications, 'csrf_token': generate_csrf_token()})

@notifications_bp.route('/notifications/read', methods=['POST'])
@login_required
def mark_notifications_read_api():
    if not validate_csrf():
        return jsonify({'error': 'Invalid CSRF token'}), 403
    username = session['user']['name']
    user_role = session['user']['role']
    mark_notifications_read(username, user_role)
    return jsonify({'status': 'success', 'csrf_token': generate_csrf_token()})