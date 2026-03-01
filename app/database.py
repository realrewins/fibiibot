"""
Datenbankoperationen
"""
import os
import json
from datetime import datetime
from app.config import DATA_FOLDER, DEFAULT_ROLE, MASTER_USER, ROLE_HIERARCHY

# Cache-Variablen
users_cache = None
users_cache_time = None
user_whitelist_cache = None
user_roles_cache = None

def load_json_file(filename):
    """Lädt eine JSON-Datei aus dem DATA_FOLDER"""
    filepath = os.path.join(DATA_FOLDER, filename)
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
            if isinstance(data, dict) and 'documents' in data:
                documents = data['documents']
                result = []
                for doc in documents:
                    try:
                        item = {}
                        item['id'] = doc.get('id', generate_id())
                        if 'fields' in doc:
                            for field_name, field_value in doc['fields'].items():
                                if 'stringValue' in field_value:
                                    item[field_name] = field_value['stringValue']
                                elif 'timestampValue' in field_value:
                                    item[field_name] = field_value['timestampValue']
                                elif 'booleanValue' in field_value:
                                    item[field_name] = field_value['booleanValue']
                                elif 'integerValue' in field_value:
                                    item[field_name] = int(field_value['integerValue'])
                                elif 'doubleValue' in field_value:
                                    item[field_name] = float(field_value['doubleValue'])
                                elif 'arrayValue' in field_value:
                                    if 'values' in field_value['arrayValue']:
                                        arr = []
                                        for v in field_value['arrayValue']['values']:
                                            if 'stringValue' in v:
                                                arr.append(v['stringValue'])
                                        item[field_name] = arr
                        result.append(item)
                    except:
                        continue
                return result
            else:
                return data if isinstance(data, list) else []
    except FileNotFoundError:
        return []
    except json.JSONDecodeError:
        return []

def save_json_file(filename, data):
    """Speichert Daten in einer JSON-Datei"""
    filepath = os.path.join(DATA_FOLDER, filename)
    try:
        if isinstance(data, list):
            documents = []
            for item in data:
                fields = {}
                for key, value in item.items():
                    if key == 'id':
                        continue
                    if isinstance(value, str):
                        fields[key] = {'stringValue': value}
                    elif isinstance(value, bool):
                        fields[key] = {'booleanValue': value}
                    elif isinstance(value, (int, float)):
                        fields[key] = {'integerValue': str(value)} if isinstance(value, int) else {'doubleValue': str(value)}
                    elif isinstance(value, list):
                        arr_values = []
                        for elem in value:
                            arr_values.append({'stringValue': str(elem)})
                        fields[key] = {'arrayValue': {'values': arr_values}}
                    else:
                        fields[key] = {'stringValue': str(value)}
                doc = {
                    'id': item.get('id', generate_id()),
                    'fields': fields
                }
                documents.append(doc)
            output = {'documents': documents}
        else:
            output = data
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"Fehler beim Speichern von {filename}: {e}")
        return False

def get_highest_role(roles):
    """Gibt die höchste Rolle aus einer Liste zurück"""
    if not roles:
        return DEFAULT_ROLE
    return min(roles, key=lambda r: ROLE_HIERARCHY.get(r, 99))

def get_users_cached(force_reload=False):
    """Gibt die gecachten Benutzer zurück"""
    global users_cache, users_cache_time, user_whitelist_cache, user_roles_cache
    
    if not force_reload and users_cache and users_cache_time:
        from datetime import datetime as dt
        if (dt.now() - users_cache_time).seconds < 60:
            return users_cache

    users_cache = load_json_file('users.json')
    users_cache_time = datetime.now()
    user_whitelist_cache = set()
    user_roles_cache = {}

    normalized_users = []
    for user in users_cache:
        if not isinstance(user, dict):
            continue
        uname = user.get('username') or user.get('slug') or user.get('name') or user.get('id')
        if not uname:
            continue
        uname_lower = str(uname).lower().strip()

        if 'roles' not in user:
            user['roles'] = [user.get('role', DEFAULT_ROLE)]
        if not user['roles']:
            user['roles'] = [DEFAULT_ROLE]

        user['username'] = uname_lower
        user_whitelist_cache.add(uname_lower)
        highest = get_highest_role(user['roles'])
        user_roles_cache[uname_lower] = highest
        normalized_users.append(user)

    master_exists = any(u.get('username', '').lower() == MASTER_USER.lower() for u in normalized_users)
    if not master_exists:
        master_user = {
            'id': MASTER_USER.lower(),
            'username': MASTER_USER.lower(),
            'roles': ['admin']
        }
        normalized_users.append(master_user)
        user_whitelist_cache.add(MASTER_USER.lower())
        user_roles_cache[MASTER_USER.lower()] = 'admin'
    else:
        for u in normalized_users:
            if u.get('username', '').lower() == MASTER_USER.lower():
                if 'admin' not in u.get('roles', []):
                    u['roles'] = list(set(u.get('roles', []) + ['admin']))
                break

    users_cache = normalized_users
    return users_cache

def check_user_whitelisted(username):
    """Prüft, ob ein Benutzer auf der Whitelist steht"""
    if not username or not isinstance(username, str):
        return False
    get_users_cached()
    return username.lower() in user_whitelist_cache

def get_user_role(username):
    """Gibt die Rolle eines Benutzers zurück"""
    if not username or not isinstance(username, str):
        return DEFAULT_ROLE
    get_users_cached()
    return user_roles_cache.get(username.lower(), DEFAULT_ROLE)

def save_users(data):
    """Speichert Benutzer und invalidiert den Cache"""
    global users_cache, users_cache_time, user_whitelist_cache, user_roles_cache
    users_cache = data
    users_cache_time = datetime.now()
    success = save_json_file('users.json', data)
    if success:
        get_users_cached(force_reload=True)
    return success

def find_item_by_id(data_list, item_id):
    """Findet ein Element in einer Liste nach ID"""
    for item in data_list:
        if item.get('id') == item_id:
            return item
    return None

def update_item_in_list(data_list, item_id, new_data):
    """Aktualisiert ein Element in einer Liste"""
    for i, item in enumerate(data_list):
        if item.get('id') == item_id:
            new_data['id'] = item_id
            data_list[i] = new_data
            return True
    return False

def delete_item_from_list(data_list, item_id):
    """Löscht ein Element aus einer Liste"""
    for i, item in enumerate(data_list):
        if item.get('id') == item_id:
            del data_list[i]
            return True
    return False

def generate_id():
    """Generiert eine eindeutige ID basierend auf dem Zeitstempel"""
    return datetime.now().strftime('%Y%m%d%H%M%S%f')

# Convenience-Funktionen
def get_blacklist():
    return load_json_file('blacklist.json')

def get_clips():
    return load_json_file('clips.json')

def get_giveaways():
    return load_json_file('giveaways.json')

def save_blacklist(data):
    return save_json_file('blacklist.json', data)

def save_clips(data):
    return save_json_file('clips.json', data)

def save_giveaways(data):
    return save_json_file('giveaways.json', data)