"""
Routes Package
"""
from flask import Flask
from app.routes.main import main_bp
from app.routes.auth_routes import auth_bp
from app.routes.api_blacklist import blacklist_bp
from app.routes.api_clips import clips_bp
from app.routes.api_giveaway import giveaway_bp
from app.routes.api_bugs import bugs_bp
from app.routes.api_users import users_bp
from app.routes.api_twitch import twitch_bp
from app.routes.api_notifications import notifications_bp
from app.routes.api_audit import audit_bp
from app.routes.api_vod import vod_bp
from app.routes.api_debug import debug_bp
from app.routes.vod_public import vod_public_bp

def register_blueprints(app):
    """Registriert alle Blueprints"""
    app.register_blueprint(main_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(blacklist_bp)
    app.register_blueprint(clips_bp)
    app.register_blueprint(giveaway_bp)
    app.register_blueprint(bugs_bp)
    app.register_blueprint(users_bp)
    app.register_blueprint(twitch_bp)
    app.register_blueprint(notifications_bp)
    app.register_blueprint(audit_bp)
    app.register_blueprint(vod_bp)
    app.register_blueprint(debug_bp)
    app.register_blueprint(vod_public_bp)