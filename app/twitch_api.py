"""
Twitch API Integration
"""
import requests
import time
import threading
import concurrent.futures
import json
import re
from datetime import datetime, timedelta
from app.config import TWITCH_CLIENT_ID, TWITCH_CHANNEL_LOGIN, TWITCH_GQL_CLIENT_ID, TWITCH_GQL_OAUTH_TOKEN
from app.database import get_clips, save_clips

twitch_access_token = None
token_expiry = None
token_lock = threading.Lock()

broadcaster_id_cache = None
broadcaster_id_lock = threading.Lock()

def get_twitch_access_token():
    """Holt und cached den Twitch API Token"""
    global twitch_access_token, token_expiry
    with token_lock:
        if twitch_access_token and token_expiry and datetime.now() < token_expiry:
            return twitch_access_token
        try:
            from app.config import TWITCH_CLIENT_SECRET
            token_data = {
                'client_id': TWITCH_CLIENT_ID,
                'client_secret': TWITCH_CLIENT_SECRET,
                'grant_type': 'client_credentials'
            }
            token_response = requests.post('https://id.twitch.tv/oauth2/token', data=token_data, timeout=5)
            if token_response.status_code == 200:
                token_json = token_response.json()
                twitch_access_token = token_json['access_token']
                expires_in = token_json.get('expires_in', 3600)
                token_expiry = datetime.now() + timedelta(seconds=expires_in - 300)
                return twitch_access_token
        except:
            pass
        return None

def get_broadcaster_id():
    """Holt die Broadcaster-ID"""
    global broadcaster_id_cache
    with broadcaster_id_lock:
        if broadcaster_id_cache:
            return broadcaster_id_cache
        access_token = get_twitch_access_token()
        if not access_token:
            return None
        headers = {
            'Client-ID': TWITCH_CLIENT_ID,
            'Authorization': f'Bearer {access_token}'
        }
        try:
            resp = requests.get(f'https://api.twitch.tv/helix/users?login={TWITCH_CHANNEL_LOGIN}', headers=headers, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                if data['data']:
                    broadcaster_id_cache = data['data'][0]['id']
                    return broadcaster_id_cache
        except Exception as e:
            print(f"Fehler beim Abrufen der Broadcaster-ID: {e}")
        return None

def is_user_subscribed(broadcaster_id, user_id):
    """Prüft, ob ein Benutzer abonniert ist"""
    app_token = get_twitch_access_token()
    if not app_token:
        return False
    headers = {
        'Client-ID': TWITCH_CLIENT_ID,
        'Authorization': f'Bearer {app_token}'
    }
    url = f'https://api.twitch.tv/helix/subscriptions/user?broadcaster_id={broadcaster_id}&user_id={user_id}'
    try:
        resp = requests.get(url, headers=headers, timeout=5)
        return resp.status_code == 200
    except Exception as e:
        print(f"Fehler bei Sub-Prüfung: {e}")
        return False

def fetch_clip_views(slug, access_token):
    """Holt die View-Count für einen Clip"""
    try:
        headers = {
            'Client-ID': TWITCH_CLIENT_ID,
            'Authorization': f'Bearer {access_token}'
        }
        response = requests.get(f'https://api.twitch.tv/helix/clips?id={slug}', headers=headers, timeout=1.5)
        if response.status_code == 200:
            data = response.json()
            if data.get('data') and len(data['data']) > 0:
                return data['data'][0].get('view_count', 0)
    except:
        pass
    return None

def update_clip_views():
    """Background Task: Aktualisiert die View-Counts der Clips"""
    while True:
        try:
            clips = get_clips()
            access_token = get_twitch_access_token()
            if not access_token:
                time.sleep(300)
                continue
            updated = False
            with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
                future_to_clip = {}
                for clip in clips:
                    slug = clip.get('slug')
                    if not slug:
                        continue
                    future = executor.submit(fetch_clip_views, slug, access_token)
                    future_to_clip[future] = (clip, slug)
                for future in concurrent.futures.as_completed(future_to_clip):
                    clip, slug = future_to_clip[future]
                    try:
                        new_views = future.result(timeout=1.5)
                        if new_views is not None and isinstance(clip.get('views'), int):
                            if new_views != clip['views']:
                                clip['views'] = new_views
                                updated = True
                    except:
                        continue
            if updated:
                save_clips(clips)
        except:
            pass
        time.sleep(300)

def get_twitch_integrity_token():
    """Holt einen Integrity-Token von Twitch"""
    try:
        headers = {"Client-ID": TWITCH_GQL_CLIENT_ID}
        response = requests.post("https://gql.twitch.tv/integrity", headers=headers, timeout=5)
        if response.status_code == 200:
            return response.json().get("token")
    except:
        pass
    return None

def get_twitch_channel_id(login):
    """Holt die Channel-ID für einen Login"""
    try:
        integrity = get_twitch_integrity_token()
        if not integrity:
            return None
        headers = {
            "Client-ID": TWITCH_GQL_CLIENT_ID,
            "Authorization": f"OAuth {TWITCH_GQL_OAUTH_TOKEN}",
            "Client-Integrity": integrity,
            "Content-Type": "application/json"
        }
        query = {"query": f'{{user(login:"{login}"){{id}}}}'}
        response = requests.post("https://gql.twitch.tv/gql", json=query, headers=headers, timeout=5)
        if response.status_code == 200:
            return response.json().get("data", {}).get("user", {}).get("id")
    except:
        pass
    return None

def get_twitch_follow_date(target_username):
    """Holt das Folge-Datum eines Benutzers"""
    try:
        channel_id = get_twitch_channel_id(TWITCH_CHANNEL_LOGIN)
        if not channel_id:
            return None
        integrity = get_twitch_integrity_token()
        if not integrity:
            return None
        variables = {
            "channelID": channel_id,
            "channelIDStr": channel_id,
            "channelLogin": TWITCH_CHANNEL_LOGIN,
            "targetLogin": target_username,
            "isViewerBadgeCollectionEnabled": True
        }
        body = [{
            "operationName": "ViewerCard",
            "variables": variables,
            "extensions": {
                "persistedQuery": {
                    "version": 1,
                    "sha256Hash": "c02d0aa3e6fdaad9a668f354236e0ded00e338cb742da33bb166e0f34ebf3c3b"
                }
            }
        }]
        headers = {
            "Client-ID": TWITCH_GQL_CLIENT_ID,
            "Authorization": f"OAuth {TWITCH_GQL_OAUTH_TOKEN}",
            "Client-Integrity": integrity,
            "Content-Type": "text/plain;charset=UTF-8"
        }
        response = requests.post("https://gql.twitch.tv/gql", json=body, headers=headers, timeout=5)
        if response.status_code == 200:
            result = response.json()
            if isinstance(result, list) and len(result) > 0:
                data = result[0].get("data", {})
                followed_at = None
                if "targetUser" in data and data["targetUser"]:
                    follow = data["targetUser"].get("follow")
                    if follow:
                        followed_at = follow.get("followedAt")
                if not followed_at and "user" in data and data["user"]:
                    follow = data["user"].get("follow")
                    if follow:
                        followed_at = follow.get("followedAt")
                if not followed_at and "user" in data and data["user"] and "self" in data["user"]:
                    follow = data["user"]["self"].get("follow")
                    if follow:
                        followed_at = follow.get("followedAt")
                if not followed_at:
                    json_str = json.dumps(data)
                    match = re.search(r'"followedAt"\s*:\s*"([^"]+)"', json_str)
                    if match:
                        followed_at = match.group(1)
                if followed_at:
                    dt = datetime.fromisoformat(followed_at.replace("Z", "+00:00"))
                    return dt.strftime("%d.%m.%Y")
    except:
        pass
    return None