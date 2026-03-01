"""
Audit Log API Routes
"""
from flask import Blueprint, jsonify, request, session
from app.decorators import admin_required, login_required
from app.auth import validate_csrf, generate_csrf_token
from app.audit_logger import add_audit_log, get_audit_logs

audit_bp = Blueprint('audit', __name__, url_prefix='/api')

@audit_bp.route('/audit/logs', methods=['GET'])
@admin_required
def get_audit_logs_api():
    limit = request.args.get('limit', default=500, type=int)
    logs = get_audit_logs(limit=limit)
    return jsonify({
        'logs': logs,
        'csrf_token': generate_csrf_token()
    })

@audit_bp.route('/audit/log', methods=['POST'])
@login_required
def add_audit_log_api():
    if not validate_csrf():
        return jsonify({'error': 'Invalid CSRF token'}), 403
    data = request.json
    required = ['action_type', 'reason', 'object_name', 'link_url', 'link_label']
    if not all(k in data for k in required):
        return jsonify({'error': 'Missing fields'}), 400
    try:
        add_audit_log(
            username=session['user']['name'],
            user_id=session['user']['id'],
            success=True,
            reason=data['reason'],
            action_type=data['action_type'],
            object_id=data.get('object_id'),
            object_name=data['object_name'],
            link_url=data['link_url'],
            link_label=data['link_label']
        )
        return jsonify({'status': 'success', 'csrf_token': generate_csrf_token()})
    except Exception as e:
        print(f"[AuditLog] Fehler in API-Route: {e}")
        return jsonify({'error': 'Audit-Log konnte nicht gespeichert werden'}), 500