"""
Bug Report API Routes
"""
import os
import json
import threading
from flask import Blueprint, jsonify, request, session
from datetime import datetime, timezone
from app.decorators import login_required, api_role_required
from app.auth import validate_csrf, generate_csrf_token
from app.audit_logger import add_audit_log
from app.config import BUG_REPORT_FILE

bugs_bp = Blueprint('bugs', __name__, url_prefix='/api')
bug_lock = threading.Lock()

@bugs_bp.route('/bugreports', methods=['GET'])
@login_required
def get_bug_reports():
    try:
        with bug_lock:
            try:
                with open(BUG_REPORT_FILE, 'r', encoding='utf-8') as f:
                    reports = json.load(f)
            except (FileNotFoundError, json.JSONDecodeError):
                reports = []
        
        user_role = session['user']['role']
        username = session['user']['name']

        if user_role in ['admin', 'dev', 'broadcaster']:
            filtered = reports
        else:
            filtered = [r for r in reports if r.get('username') == username]

        return jsonify({'reports': filtered, 'csrf_token': generate_csrf_token()})
    except Exception as e:
        print(f"[BugReports] Fehler: {e}")
        return jsonify({'error': 'Fehler beim Laden der Bug-Reports'}), 500

@bugs_bp.route('/bugreport', methods=['POST'])
@login_required
def bug_report():
    if not validate_csrf():
        return jsonify({'error': 'Invalid CSRF token'}), 403
    data = request.json
    subject = data.get('subject', '').strip()
    description = data.get('description', '').strip()
    if not subject or not description:
        return jsonify({'error': 'Betreff und Beschreibung dürfen nicht leer sein'}), 400
    report_id = session['user']['name'] + '_' + datetime.now().strftime('%Y%m%d%H%M%S%f')
    report = {
        'id': report_id,
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'username': session['user']['name'],
        'display_name': session['user']['display_name'],
        'user_id': session['user']['id'],
        'subject': subject,
        'description': description,
        'status': 'open'
    }
    try:
        with bug_lock:
            try:
                with open(BUG_REPORT_FILE, 'r', encoding='utf-8') as f:
                    reports = json.load(f)
            except (FileNotFoundError, json.JSONDecodeError):
                reports = []
            reports.append(report)
            if len(reports) > 1000:
                reports = reports[-1000:]
            with open(BUG_REPORT_FILE, 'w', encoding='utf-8') as f:
                json.dump(reports, f, ensure_ascii=False, indent=2)
        add_audit_log(
            username=session['user']['name'],
            user_id=session['user']['id'],
            success=True,
            reason=f"Bugreport gesendet: {subject}",
            action_type="BUG_REPORT",
            object_id=report_id,
            object_name=subject,
            link_url=f"/bugs#highlight={report_id}",
            link_label="Report öffnen"
        )
        return jsonify({'status': 'success', 'csrf_token': generate_csrf_token()})
    except Exception as e:
        print(f"[BugReport] Fehler beim Speichern: {e}")
        return jsonify({'error': 'Fehler beim Speichern des Bugreports'}), 500

@bugs_bp.route('/bugreport/<report_id>', methods=['PUT'])
@login_required
@api_role_required(['admin','dev','broadcaster'])
def update_bug_report(report_id):
    if not validate_csrf():
        return jsonify({'error': 'Invalid CSRF token'}), 403
    data = request.json
    status = data.get('status')
    if status not in ['open', 'closed']:
        return jsonify({'error': 'Invalid status'}), 400
    with bug_lock:
        try:
            with open(BUG_REPORT_FILE, 'r', encoding='utf-8') as f:
                reports = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            reports = []
        report = None
        for r in reports:
            if r.get('id') == report_id:
                report = r
                break
        if not report:
            return jsonify({'error': 'Report not found'}), 404
        report['status'] = status
        with open(BUG_REPORT_FILE, 'w', encoding='utf-8') as f:
            json.dump(reports, f, ensure_ascii=False, indent=2)
    add_audit_log(
        username=session['user']['name'],
        user_id=session['user']['id'],
        success=True,
        reason=f"Bug-Report {report['subject']} auf {status} gesetzt",
        action_type="BUG_UPDATE",
        object_id=report_id,
        object_name=report['subject'],
        link_url=f"/bugs#highlight={report_id}",
        link_label="Report öffnen"
    )
    return jsonify({'status': 'success', 'csrf_token': generate_csrf_token()})

@bugs_bp.route('/bugreply', methods=['POST'])
@login_required
@api_role_required(['admin','dev','broadcaster'])
def send_bug_reply():
    if not validate_csrf():
        return jsonify({'error': 'Invalid CSRF token'}), 403
    data = request.json
    target_user = data.get('target_user')
    message = data.get('message')
    bug_id = data.get('bug_id')
    if not target_user or not message or not bug_id:
        return jsonify({'error': 'Missing fields'}), 400
    reply = {
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'from_user': session['user']['name'],
        'target_user': target_user,
        'bug_id': bug_id,
        'message': message,
        'read': False
    }
    with bug_lock:
        try:
            with open(BUG_REPORT_FILE, 'r', encoding='utf-8') as f:
                replies = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            replies = []
        replies.append(reply)
        with open(BUG_REPORT_FILE, 'w', encoding='utf-8') as f:
            json.dump(replies, f, ensure_ascii=False, indent=2)
        try:
            with open(BUG_REPORT_FILE, 'r', encoding='utf-8') as f:
                reports = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            reports = []
    report = next((r for r in reports if r.get('id') == bug_id), None)
    subject = report['subject'] if report else bug_id
    add_audit_log(
        username=session['user']['name'],
        user_id=session['user']['id'],
        success=True,
        reason=f"Reply an {target_user} zu Bug {subject} gesendet",
        action_type="BUG_REPLY",
        object_id=bug_id,
        object_name=subject,
        link_url=None,
        link_label=None
    )
    return jsonify({'status': 'success', 'csrf_token': generate_csrf_token()})