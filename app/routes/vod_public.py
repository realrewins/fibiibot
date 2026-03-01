"""
Public VOD file serving (non-/api) to match frontend paths like /vod/<id>/video/playlist.m3u8
"""
from flask import Blueprint, send_from_directory
from app.decorators import login_required
from app.config import VOD_FOLDER

vod_public_bp = Blueprint('vod_public', __name__)

@vod_public_bp.route('/vod/<path:filename>')
@login_required
def serve_vod_public(filename):
    return send_from_directory(VOD_FOLDER, filename)