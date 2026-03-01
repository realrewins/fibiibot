import os
import re
import asyncio
import json
import sys
import socket
import atexit
from pathlib import Path
import aiohttp
from dotenv import load_dotenv
from twitchio.ext import commands

LOCK_PORT = 7778
lock_socket = None

def acquire_port_lock():
    global lock_socket
    try:
        lock_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        lock_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        lock_socket.bind(("127.0.0.1", LOCK_PORT))
        lock_socket.listen(1)
        return True
    except OSError as e:
        print(f"FEHLER: Port {LOCK_PORT} ist bereits belegt: {e}")
        return False

def release_port_lock():
    global lock_socket
    if lock_socket:
        lock_socket.close()
        lock_socket = None

if not acquire_port_lock():
    print("Es läuft möglicherweise bereits eine Bot-Instanz oder ein anderer Dienst auf Port 7778.")
    sys.exit(1)

atexit.register(release_port_lock)

env_path = Path(__file__).parent / '.env'
load_dotenv(dotenv_path=env_path, override=True)

required_vars = ['BOT_OAUTH_TOKEN', 'BOT_CLIENT_ID']
missing = [var for var in required_vars if not os.getenv(var)]
if missing:
    print("Fehler: Folgende Umgebungsvariablen fehlen in der .env-Datei:", missing)
    sys.exit(1)

DATA_DIR = Path(__file__).parent / 'data' / 'botdata'
DATA_DIR.mkdir(parents=True, exist_ok=True)
USER_DATA_FILE = Path(__file__).parent / 'data' / 'users.json'

class Bot(commands.Bot):
    def __init__(self):
        self.channels_file = DATA_DIR / 'channels.json'
        self.extra_channels = self.load_channels()
        token = os.getenv('BOT_OAUTH_TOKEN').replace('oauth:', '')
        super().__init__(
            token=token,
            prefix='!',
            initial_channels=self.extra_channels
        )
        self.seven_tv_token = os.getenv('BOT_SEVEN_TV_TOKEN')
        self.client_id = os.getenv('BOT_CLIENT_ID')
        self.session = None
        self.graphql_url = "https://api.7tv.app/v4/gql"
        self.user_roles = {}

    def load_channels(self):
        if self.channels_file.exists():
            try:
                with open(self.channels_file, 'r') as f:
                    data = json.load(f)
                    return data.get('channels', [])
            except Exception as e:
                print(f"Fehler beim Laden der Channels: {e}")
                return []
        return []

    def save_channels(self):
        try:
            with open(self.channels_file, 'w') as f:
                json.dump({'channels': self.extra_channels}, f, indent=2)
        except Exception as e:
            print(f"Fehler beim Speichern der Channels: {e}")

    def load_users(self):
        roles = {}
        if USER_DATA_FILE.exists():
            try:
                with open(USER_DATA_FILE, 'r') as f:
                    data = json.load(f)
                    for doc in data.get('documents', []):
                        username = doc.get('id', '').lower()
                        role_list = []
                        fields = doc.get('fields', {})
                        roles_field = fields.get('roles', {})
                        array_value = roles_field.get('arrayValue', {})
                        values = array_value.get('values', [])
                        for v in values:
                            role = v.get('stringValue')
                            if role:
                                role_list.append(role.lower())
                        if username and role_list:
                            if 'admin' in role_list:
                                roles[username] = 'admin'
                            elif 'dev' in role_list:
                                roles[username] = 'dev'
                            elif 'editor' in role_list:
                                roles[username] = 'editor'
            except Exception as e:
                print(f"Fehler beim Laden der users.json: {e}")
        else:
            print(f"users.json nicht gefunden unter {USER_DATA_FILE}")
        return roles

    def get_user_role(self, username):
        self.user_roles = self.load_users()
        return self.user_roles.get(username.lower())

    async def _send_irc(self, command: str):
        if hasattr(self._connection, 'send_raw'):
            await self._connection.send_raw(command)
            return
        if hasattr(self._connection, 'send'):
            await self._connection.send(command)
            return
        if hasattr(self._connection, '_ws') and hasattr(self._connection._ws, 'send'):
            await self._connection._ws.send(command)
            return
        for attr in ['_socket', '_writer', '_transport']:
            if hasattr(self._connection, attr):
                obj = getattr(self._connection, attr)
                if hasattr(obj, 'send'):
                    await obj.send(command)
                    return
                elif hasattr(obj, 'write'):
                    obj.write(command.encode())
                    if hasattr(obj, 'drain'):
                        await obj.drain()
                    return
        raise Exception("Keine Methode zum Senden von IRC-Befehlen gefunden.")

    async def send_join_message(self, channel_name: str, display_name: str):
        """Sendet eine Willkommensnachricht in den neu gejointen Channel."""
        try:
            await asyncio.sleep(1)
            channel = self.get_channel(channel_name)
            if channel:
                await channel.send(
                    f"FibiiBot ist erfolgreich dem Channel {display_name} beigetreten. PogChamp"
                )
                print(f"Join-Nachricht an {channel_name} gesendet.")
            else:
                await asyncio.sleep(2)
                channel = self.get_channel(channel_name)
                if channel:
                    await channel.send(
                        f"Bin erfolgreich dem Channel {display_name} beigetreten. PogChamp"
                    )
                    print(f"Join-Nachricht an {channel_name} (2. Versuch) gesendet.")
                else:
                    print(f"Konnte Channel {channel_name} nach Join nicht finden.")
        except Exception as e:
            print(f"Fehler in send_join_message für {channel_name}: {e}")

    async def event_ready(self):
        if self.session is None:
            self.session = aiohttp.ClientSession()
        print(f'Bot bereit: {self.nick}')
        if self.seven_tv_token:
            print("7TV-Token geladen – Bot kann Emotes, Sets und Editoren verwalten.")
        else:
            print("7TV-Token fehlt – Emotes können nicht verwaltet werden.")

    async def close(self):
        if self.session:
            await self.session.close()
        await super().close()

    async def event_message(self, message):
        if message.author is None:
            return
        if message.author.name.lower() == self.nick.lower():
            return
        await self.handle_commands(message)

    async def _graphql(self, query: str, variables: dict = None) -> dict:
        if self.session is None:
            self.session = aiohttp.ClientSession()
        headers = {
            "Authorization": f"Bearer {self.seven_tv_token}",
            "Content-Type": "application/json"
        }
        payload = {"query": query}
        if variables:
            payload["variables"] = variables
        async with self.session.post(self.graphql_url, headers=headers, json=payload) as resp:
            if resp.status != 200:
                text = await resp.text()
                raise Exception(f"GraphQL HTTP {resp.status}: {text}")
            data = await resp.json()
            if data.get("errors"):
                raise Exception(f"GraphQL Fehler: {data['errors']}")
            return data["data"]

    async def get_twitch_user_id(self, login):
        if self.session is None:
            self.session = aiohttp.ClientSession()
        url = f"https://api.twitch.tv/helix/users?login={login}"
        token = os.getenv('BOT_OAUTH_TOKEN').replace('oauth:', '')
        headers = {
            "Client-ID": self.client_id,
            "Authorization": f"Bearer {token}"
        }
        async with self.session.get(url, headers=headers) as resp:
            if resp.status == 200:
                data = await resp.json()
                users = data.get('data', [])
                return users[0]['id'] if users else None
            else:
                error_text = await resp.text()
                print(f"Fehler beim Abrufen der User-ID: {resp.status} - {error_text}")
                return None

    async def get_seven_tv_user_by_twitch_id(self, twitch_id):
        if self.session is None:
            self.session = aiohttp.ClientSession()
        url = f"https://7tv.io/v3/users/twitch/{twitch_id}"
        async with self.session.get(url) as resp:
            if resp.status == 200:
                return await resp.json()
            return None

    async def get_editor_permissions(self, channel_seven_id: str, caller_seven_id: str):
        query = """
        query GetEditorPermissions($userId: Id!) {
            users {
                user(id: $userId) {
                    editors {
                        editorId
                        permissions {
                            superAdmin
                            emoteSet {
                                admin
                                manage
                                create
                            }
                            emote {
                                admin
                                manage
                                create
                                transfer
                            }
                            user {
                                admin
                            }
                        }
                    }
                }
            }
        }
        """
        variables = {"userId": channel_seven_id}
        try:
            data = await self._graphql(query, variables)
            editors = data.get("users", {}).get("user", {}).get("editors", [])
            for editor in editors:
                if editor.get("editorId") == caller_seven_id:
                    return editor.get("permissions")
        except Exception as e:
            print(f"Fehler beim Abrufen der Editor-Permissions: {e}")
        return None

    async def get_seven_tv_emote(self, emote_id):
        if self.session is None:
            self.session = aiohttp.ClientSession()
        url = f"https://7tv.io/v3/emotes/{emote_id}"
        async with self.session.get(url) as resp:
            if resp.status == 200:
                return await resp.json()
            return None

    async def get_emote_set_by_id_rest(self, set_id: str):
        if self.session is None:
            self.session = aiohttp.ClientSession()
        url = f"https://7tv.io/v3/emote-sets/{set_id}"
        async with self.session.get(url) as resp:
            if resp.status == 200:
                return await resp.json()
            return None

    async def search_emote_by_name(self, name: str):
        query = """
        query SearchEmotes($query: String!, $sort: Sort!, $page: Int, $perPage: Int) {
            emotes {
                search(query: $query, sort: $sort, page: $page, perPage: $perPage) {
                    items {
                        id
                        defaultName
                    }
                    totalCount
                }
            }
        }
        """
        variables = {
            "query": name,
            "sort": {"sortBy": "TOP_ALL_TIME", "order": "DESCENDING"},
            "page": 1,
            "perPage": 1
        }
        try:
            data = await self._graphql(query, variables)
            items = data.get("emotes", {}).get("search", {}).get("items", [])
            if items:
                return {"id": items[0]["id"], "name": items[0].get("defaultName", name)}
        except Exception as e:
            print(f"Fehler bei der Emote-Suche: {e}")
        return None

    async def get_emote_id_by_name_in_set(self, set_id: str, name: str):
        query = """
        query GetEmoteSet($id: Id!) {
            emoteSets {
                emoteSet(id: $id) {
                    id
                    name
                    emotes(page: 1, perPage: 100) {
                        items {
                            id
                            alias
                            emote {
                                id
                                defaultName
                            }
                        }
                    }
                }
            }
        }
        """
        variables = {"id": set_id}
        try:
            data = await self._graphql(query, variables)
            emote_set = data.get("emoteSets", {}).get("emoteSet")
            if not emote_set:
                return None
            items = emote_set.get("emotes", {}).get("items", [])
            for item in items:
                if item.get("alias", "").lower() == name.lower():
                    return item.get("id")
                if item.get("emote", {}).get("defaultName", "").lower() == name.lower():
                    return item.get("id")
        except Exception as e:
            print(f"Fehler beim Abrufen des Sets: {e}")
        return None

    async def add_emote_to_set(self, set_id: str, emote_id: str, alias: str = None):
        query = """
        mutation AddEmoteToSet($setId: Id!, $emote: EmoteSetEmoteId!) {
            emoteSets {
                emoteSet(id: $setId) {
                    addEmote(id: $emote) {
                        id
                    }
                }
            }
        }
        """
        variables = {"setId": set_id, "emote": {"emoteId": emote_id}}
        if alias:
            variables["emote"]["alias"] = alias
        await self._graphql(query, variables)
        return True

    async def remove_emote_from_set(self, set_id: str, emote_id: str, alias: str = None):
        query = """
        mutation RemoveEmoteFromSet($setId: Id!, $emote: EmoteSetEmoteId!) {
            emoteSets {
                emoteSet(id: $setId) {
                    removeEmote(id: $emote) {
                        id
                    }
                }
            }
        }
        """
        variables = {"setId": set_id, "emote": {"emoteId": emote_id}}
        if alias:
            variables["emote"]["alias"] = alias
        await self._graphql(query, variables)
        return True

    async def create_emote_set(self, owner_id: str, name: str):
        query = """
        mutation CreateEmoteSet($name: String!, $tags: [String!]!, $ownerId: Id!) {
            emoteSets {
                create(name: $name, tags: $tags, ownerId: $ownerId) {
                    id
                    name
                }
            }
        }
        """
        variables = {"name": name, "tags": [], "ownerId": owner_id}
        data = await self._graphql(query, variables)
        return data.get("emoteSets", {}).get("create")

    async def delete_emote_set(self, set_id: str):
        query = """
        mutation DeleteEmoteSet($id: Id!) {
            emoteSets {
                emoteSet(id: $id) {
                    delete
                }
            }
        }
        """
        variables = {"id": set_id}
        data = await self._graphql(query, variables)
        return data.get("emoteSets", {}).get("emoteSet", {}).get("delete")

    async def rename_emote_set(self, set_id: str, new_name: str):
        query = """
        mutation RenameEmoteSet($id: Id!, $name: String!) {
            emoteSets {
                emoteSet(id: $id) {
                    name(name: $name) {
                        id
                        name
                    }
                }
            }
        }
        """
        variables = {"id": set_id, "name": new_name}
        data = await self._graphql(query, variables)
        return data.get("emoteSets", {}).get("emoteSet", {}).get("name")

    async def activate_emote_set(self, user_id: str, set_id: str):
        query = """
        mutation ActivateEmoteSet($userId: Id!, $setId: Id!) {
            users {
                user(id: $userId) {
                    activeEmoteSet(emoteSetId: $setId) {
                        id
                        style {
                            activeEmoteSetId
                        }
                    }
                }
            }
        }
        """
        variables = {"userId": user_id, "setId": set_id}
        data = await self._graphql(query, variables)
        user_data = data.get("users", {}).get("user")
        return user_data

    async def invite_editor(self, owner_id: str, editor_id: str, is_superadmin: bool = False):
        if is_superadmin:
            permissions = {
                "superAdmin": True,
                "emoteSet": {"admin": False, "manage": False, "create": False},
                "emote": {"admin": False, "manage": False, "create": False, "transfer": False},
                "user": {
                    "admin": False,
                    "manageBilling": False,
                    "manageProfile": False,
                    "manageEditors": False,
                    "managePersonalEmoteSet": False
                }
            }
        else:
            permissions = {
                "superAdmin": False,
                "emoteSet": {"admin": False, "manage": True, "create": True},
                "emote": {"admin": False, "manage": True, "create": True, "transfer": False},
                "user": {
                    "admin": False,
                    "manageBilling": False,
                    "manageProfile": False,
                    "manageEditors": False,
                    "managePersonalEmoteSet": False
                }
            }
        query = """
        mutation InviteEditor($userId: Id!, $editorId: Id!, $permissions: UserEditorPermissionsInput!) {
            userEditors {
                create(userId: $userId, editorId: $editorId, permissions: $permissions) {
                    userId
                    editorId
                    state
                }
            }
        }
        """
        variables = {
            "userId": owner_id,
            "editorId": editor_id,
            "permissions": permissions
        }
        data = await self._graphql(query, variables)
        return data.get("userEditors", {}).get("create")

    async def remove_editor(self, owner_id: str, editor_id: str):
        query_del = """
        mutation DeleteEditor($userId: Id!, $editorId: Id!) {
            userEditors {
                editor(userId: $userId, editorId: $editorId) {
                    delete
                }
            }
        }
        """
        vars_del = {"userId": owner_id, "editorId": editor_id}
        data_del = await self._graphql(query_del, vars_del)
        return data_del.get("userEditors", {}).get("editor", {}).get("delete")

    async def get_all_user_sets(self, user_id: str):
        query_user = """
        query GetUser($id: Id!) {
            users {
                user(id: $id) {
                    editableEmoteSetIds
                }
            }
        }
        """
        data = await self._graphql(query_user, {"id": user_id})
        user_data = data.get("users", {}).get("user")
        if not user_data:
            return []
        set_ids = user_data.get("editableEmoteSetIds", [])
        if not set_ids:
            return []
        sets = []
        for set_id in set_ids:
            set_data = await self.get_emote_set_by_id_rest(set_id)
            if set_data:
                sets.append(set_data)
        return sets

    async def find_emote_set_by_name(self, user_id: str, name: str):
        sets = await self.get_all_user_sets(user_id)
        for s in sets:
            if s.get("name", "").lower() == name.lower():
                return {"id": s["id"], "name": s["name"]}
        return None

    async def _remove_all_from_sets(self, user_id: str, emote_identifier: str, ctx: commands.Context):
        link_match = re.search(r"7tv\.app/emotes/([a-zA-Z0-9]+)", emote_identifier)
        if link_match:
            emote_id = link_match.group(1)
            emote_data = await self.get_seven_tv_emote(emote_id)
            if not emote_data:
                await ctx.send(f"@{ctx.author.display_name} | Emote mit ID {emote_id} nicht gefunden.")
                return
            emote_name = emote_data.get('name', 'Unbekannt')
        else:
            name = emote_identifier.strip()
            emote_data = await self.search_emote_by_name(name)
            if not emote_data:
                await ctx.send(f"@{ctx.author.display_name} | Kein Emote mit dem Namen {name} gefunden.")
                return
            emote_id = emote_data['id']
            emote_name = emote_data.get('name', name)
        all_sets = await self.get_all_user_sets(user_id)
        if not all_sets:
            await ctx.send(f"@{ctx.author.display_name} | Du hast keine Sets.")
            return
        removed_count = 0
        failed_sets = []
        for set_data in all_sets:
            set_id = set_data["id"]
            set_name = set_data.get("name", set_id)
            emotes_in_set = set_data.get("emotes", [])
            if any(e.get("id") == emote_id for e in emotes_in_set):
                try:
                    await self.remove_emote_from_set(set_id, emote_id)
                    removed_count += 1
                except Exception as e:
                    failed_sets.append(f"{set_name} ({e})")
            await asyncio.sleep(0.2)
        if removed_count == 0:
            await ctx.send(f"@{ctx.author.display_name} | Emote {emote_name} war in keinem deiner Sets enthalten.")
        else:
            msg = f"@{ctx.author.display_name} | Emote {emote_name} aus {removed_count} von {len(all_sets)} Sets entfernt."
            if failed_sets:
                msg += f" Fehlgeschlagen bei: {', '.join(failed_sets)}"
            await ctx.send(msg)

    async def _add_to_all_sets(self, user_id: str, emote_identifier: str, ctx: commands.Context):
        link_match = re.search(r"7tv\.app/emotes/([a-zA-Z0-9]+)", emote_identifier)
        if link_match:
            emote_id = link_match.group(1)
            emote_data = await self.get_seven_tv_emote(emote_id)
            if not emote_data:
                await ctx.send(f"@{ctx.author.display_name} | Emote mit ID {emote_id} nicht gefunden.")
                return
            emote_name = emote_data.get('name', 'Unbekannt')
        else:
            name = emote_identifier.strip()
            emote_data = await self.search_emote_by_name(name)
            if not emote_data:
                await ctx.send(f"@{ctx.author.display_name} | Kein Emote mit dem Namen {name} gefunden.")
                return
            emote_id = emote_data['id']
            emote_name = emote_data.get('name', name)
        all_sets = await self.get_all_user_sets(user_id)
        if not all_sets:
            await ctx.send(f"@{ctx.author.display_name} | Du hast keine Sets.")
            return
        added_count = 0
        skipped_count = 0
        failed_sets = []
        for set_data in all_sets:
            set_id = set_data["id"]
            set_name = set_data.get("name", set_id)
            emotes_in_set = set_data.get("emotes", [])
            if any(e.get("id") == emote_id for e in emotes_in_set):
                skipped_count += 1
            else:
                try:
                    await self.add_emote_to_set(set_id, emote_id)
                    added_count += 1
                except Exception as e:
                    failed_sets.append(f"{set_name} ({e})")
            await asyncio.sleep(0.2)
        if added_count == 0 and skipped_count == 0:
            await ctx.send(f"@{ctx.author.display_name} | Keine Änderungen – Emote {emote_name} war bereits in allen Sets?")
        else:
            msg = f"@{ctx.author.display_name} | Emote {emote_name} zu {added_count} Sets hinzugefügt, in {skipped_count} Sets bereits vorhanden."
            if failed_sets:
                msg += f" Fehlgeschlagen bei: {', '.join(failed_sets)}"
            await ctx.send(msg)

    @commands.command(name='7tv')
    async def seven_tv_command(self, ctx: commands.Context, *args):
        if not args:
            await ctx.send(f"@{ctx.author.display_name} | Wenn ihr coole Emotes wie POGGIES noch nicht seht könnt ihr euch über diesen Link das 7tv Plugin kostenfrei zu eurem Browser hinzufügen: https://chrome.google.com/webstore/detail/7tv/ammjkodgmmoknidbanneddgankgfejfh/related")
            return

        if not self.seven_tv_token:
            await ctx.send(f"@{ctx.author.display_name} | 7TV-Token fehlt in der .env.")
            return

        twitch_id_channel = await self.get_twitch_user_id(ctx.channel.name)
        if not twitch_id_channel:
            await ctx.send(f"@{ctx.author.display_name} | Konnte Twitch-User-ID für diesen Channel nicht ermitteln.")
            return

        twitch_id_caller = await self.get_twitch_user_id(ctx.author.name)
        if not twitch_id_caller:
            await ctx.send(f"@{ctx.author.display_name} | Konnte deine Twitch-User-ID nicht ermitteln.")
            return

        seven_channel = await self.get_seven_tv_user_by_twitch_id(twitch_id_channel)
        if not seven_channel:
            await ctx.send(f"@{ctx.author.display_name} | Der Kanal {ctx.channel.name} hat keinen 7TV-Account verknüpft.")
            return
        channel_seven_id = seven_channel.get('user', {}).get('id') or seven_channel.get('id')

        seven_caller = await self.get_seven_tv_user_by_twitch_id(twitch_id_caller)
        is_broadcaster = ctx.author.name.lower() == ctx.channel.name.lower()

        if not seven_caller:
            if is_broadcaster:
                caller_seven_id = channel_seven_id
            else:
                await ctx.send(f"@{ctx.author.display_name} | Du hast keinen 7TV-Account verknüpft.")
                return
        else:
            caller_seven_id = seven_caller.get('user', {}).get('id') or seven_caller.get('id')

        editor_perms = await self.get_editor_permissions(channel_seven_id, caller_seven_id)

        if is_broadcaster:
            editor_perms = {
                "superAdmin": True,
                "emoteSet": {"admin": True, "manage": True, "create": True},
                "emote": {"admin": True, "manage": True, "create": True, "transfer": True},
                "user": {"admin": True}
            }

        streamer_seven_id = channel_seven_id
        active_set_id = None
        active_set_name = None
        if 'emote_set' in seven_channel and seven_channel['emote_set']:
            active_set_id = seven_channel['emote_set'].get('id')
            active_set_name = seven_channel['emote_set'].get('name')

        if args[0].lower() in ("editor", "superadmin"):

            if len(args) < 3:
                await ctx.send(f"@{ctx.author.display_name} | Verwendung: !7tv {args[0].lower()} add <user>  oder  !7tv {args[0].lower()} remove|rmv|revoke <user>")
                return
            subcmd = args[1].lower()
            target_input = args[2].lower()

            target_twitch_id = await self.get_twitch_user_id(target_input)
            if not target_twitch_id:
                await ctx.send(f"@{ctx.author.display_name} | Twitch-User {target_input} nicht gefunden.")
                return
            target_seven = await self.get_seven_tv_user_by_twitch_id(target_twitch_id)
            if not target_seven:
                await ctx.send(f"@{ctx.author.display_name} | Der Twitch-User {target_input} hat keinen 7TV-Account verknüpft.")
                return
            target_seven_id = target_seven.get('user', {}).get('id') or target_seven.get('id')

            try:
                if args[0].lower() == "editor":
                    is_super = False
                else:
                    is_super = True

                if subcmd == "add":
                    result = await self.invite_editor(streamer_seven_id, target_seven_id, is_super)
                    if result:
                        await ctx.send(f"@{ctx.author.display_name} | Editor {target_input} wurde eingeladen (Status: {result.get('state')}).")
                    else:
                        await ctx.send(f"@{ctx.author.display_name} | Fehler beim Einladen des Editors.")
                elif subcmd in ("remove", "rmv", "revoke"):
                    success = await self.remove_editor(streamer_seven_id, target_seven_id)
                    if success:
                        await ctx.send(f"@{ctx.author.display_name} | Editor {target_input} wurde entfernt.")
                    else:
                        await ctx.send(f"@{ctx.author.display_name} | Fehler beim Entfernen des Editors (existiert die Beziehung?).")
                else:
                    await ctx.send(f"@{ctx.author.display_name} | Unbekannter Unterbefehl. Verwende add, remove, rmv oder revoke.")
            except Exception as e:
                await ctx.send(f"@{ctx.author.display_name} | Fehler: {e}")
            return

        if args[0].lower() == "set":
            emote_set_perms = editor_perms.get('emoteSet', {})

            if len(args) < 2:
                await ctx.send(f"@{ctx.author.display_name} | Verwendung: !7tv set create <name> | !7tv set delete <name|id> | !7tv set rename <name|id> <newname> | !7tv set activate <name|id>")
                return

            subcmd = args[1].lower()
            try:
                if subcmd == "create":
                    if len(args) < 3:
                        await ctx.send(f"@{ctx.author.display_name} | Verwendung: !7tv set create <name>")
                        return
                    name = " ".join(args[2:])
                    result = await self.create_emote_set(streamer_seven_id, name)
                    if result:
                        await ctx.send(f"@{ctx.author.display_name} | Emoteset '{name}' mit ID {result['id']} erstellt!")
                    else:
                        await ctx.send(f"@{ctx.author.display_name} | Fehler beim Erstellen des Sets.")

                elif subcmd == "delete":
                    if len(args) < 3:
                        await ctx.send(f"@{ctx.author.display_name} | Verwendung: !7tv set delete <name|id>")
                        return
                    identifier = " ".join(args[2:])
                    if re.match(r"^[a-zA-Z0-9]{26}$", identifier):
                        set_id = identifier
                        set_name = identifier
                    else:
                        found = await self.find_emote_set_by_name(streamer_seven_id, identifier)
                        if not found:
                            await ctx.send(f"@{ctx.author.display_name} | Kein Set mit Namen '{identifier}' gefunden.")
                            return
                        set_id = found["id"]
                        set_name = found["name"]
                    try:
                        success = await self.delete_emote_set(set_id)
                        if success:
                            await ctx.send(f"@{ctx.author.display_name} | Set '{set_name}' wurde gelöscht.")
                        else:
                            await ctx.send(f"@{ctx.author.display_name} | Fehler beim Löschen des Sets.")
                    except Exception as e:
                        await ctx.send(f"@{ctx.author.display_name} | Fehler beim Löschen: {e}")

                elif subcmd == "rename":
                    if len(args) < 4:
                        await ctx.send(f"@{ctx.author.display_name} | Verwendung: !7tv set rename <name|id> <newname>")
                        return
                    identifier = args[2]
                    new_name = " ".join(args[3:])
                    if re.match(r"^[a-zA-Z0-9]{26}$", identifier):
                        set_id = identifier
                        set_name = identifier
                    else:
                        found = await self.find_emote_set_by_name(streamer_seven_id, identifier)
                        if not found:
                            await ctx.send(f"@{ctx.author.display_name} | Kein Set mit Namen '{identifier}' gefunden.")
                            return
                        set_id = found["id"]
                        set_name = found["name"]
                    try:
                        result = await self.rename_emote_set(set_id, new_name)
                        if result:
                            await ctx.send(f"@{ctx.author.display_name} | Set '{set_name}' wurde in '{new_name}' umbenannt.")
                        else:
                            await ctx.send(f"@{ctx.author.display_name} | Fehler beim Umbenennen.")
                    except Exception as e:
                        await ctx.send(f"@{ctx.author.display_name} | Fehler beim Umbenennen: {e}")

                elif subcmd == "activate":
                    if len(args) < 3:
                        await ctx.send(f"@{ctx.author.display_name} | Verwendung: !7tv set activate <name|id>")
                        return
                    identifier = " ".join(args[2:])
                    if re.match(r"^[a-zA-Z0-9]{26}$", identifier):
                        set_id = identifier
                        set_display = identifier
                    else:
                        found = await self.find_emote_set_by_name(streamer_seven_id, identifier)
                        if not found:
                            await ctx.send(f"@{ctx.author.display_name} | Kein Set mit Namen '{identifier}' gefunden.")
                            return
                        set_id = found["id"]
                        set_display = found["name"]
                    try:
                        result = await self.activate_emote_set(streamer_seven_id, set_id)
                        if result:
                            await ctx.send(f"@{ctx.author.display_name} | Set '{set_display}' wurde als aktives Set gesetzt.")
                        else:
                            await ctx.send(f"@{ctx.author.display_name} | Fehler beim Aktivieren des Sets.")
                    except Exception as e:
                        await ctx.send(f"@{ctx.author.display_name} | Fehler beim Aktivieren: {e}")

                else:
                    await ctx.send(f"@{ctx.author.display_name} | Unbekannter set-Befehl. Verwende create, delete, rename, activate.")

            except Exception as e:
                await ctx.send(f"@{ctx.author.display_name} | Fehler: {e}")
            return

        if args[0].lower() == "removeall":
            emote_set_perms = editor_perms.get('emoteSet', {})
            if len(args) < 2:
                await ctx.send(f"@{ctx.author.display_name} | Verwendung: !7tv removeall <link|name>")
                return
            emote_identifier = " ".join(args[1:])
            await self._remove_all_from_sets(streamer_seven_id, emote_identifier, ctx)
            return

        action = args[0].lower()
        if action not in ("add", "remove", "rmv"):
            await ctx.send(f"@{ctx.author.display_name} | Unbekannte Aktion. Verwende add, remove/rmv, removeall, set, editor oder superadmin.")
            return

        emote_set_perms = editor_perms.get('emoteSet', {})

        if len(args) < 2:
            await ctx.send(f"@{ctx.author.display_name} | Verwendung: !7tv {action} <link|name> [setname]")
            return

        emote_identifier = args[1]
        set_name = None
        if len(args) >= 3:
            set_name = " ".join(args[2:])

        if set_name and set_name.upper() == "ALL":
            if action == "add":
                await self._add_to_all_sets(streamer_seven_id, emote_identifier, ctx)
            elif action in ("remove", "rmv"):
                await self._remove_all_from_sets(streamer_seven_id, emote_identifier, ctx)
            return

        target_set_id = None
        target_set_display = None
        if set_name:
            if re.match(r"^[a-zA-Z0-9]{26}$", set_name):
                target_set_id = set_name
                set_info = await self.get_emote_set_by_id_rest(set_name)
                target_set_display = set_info.get('name', set_name) if set_info else set_name
            else:
                found_set = await self.find_emote_set_by_name(streamer_seven_id, set_name)
                if not found_set:
                    await ctx.send(f"@{ctx.author.display_name} | Kein Set mit Namen {set_name} gefunden.")
                    return
                target_set_id = found_set["id"]
                target_set_display = found_set["name"]
        else:
            if not active_set_id:
                await ctx.send(f"@{ctx.author.display_name} | Du hast kein aktives 7TV-Emoteset. Bitte gib ein Set an oder aktiviere zuerst eines.")
                return
            target_set_id = active_set_id
            target_set_display = active_set_name if active_set_name else active_set_id

        link_match = re.search(r"7tv\.app/emotes/([a-zA-Z0-9]+)", emote_identifier)
        if link_match:
            emote_id = link_match.group(1)
            emote_data = await self.get_seven_tv_emote(emote_id)
            if not emote_data:
                await ctx.send(f"@{ctx.author.display_name} | Emote mit ID {emote_id} nicht gefunden.")
                return
            emote_name = emote_data.get('name', 'Unbekannt')
            try:
                if action == "add":
                    await self.add_emote_to_set(target_set_id, emote_id)
                    await ctx.send(f"@{ctx.author.display_name} | Emote {emote_name} zum Set {target_set_display} hinzugefügt.")
                else:
                    await self.remove_emote_from_set(target_set_id, emote_id)
                    await ctx.send(f"@{ctx.author.display_name} | Emote {emote_name} aus Set {target_set_display} entfernt.")
            except Exception as e:
                await ctx.send(f"@{ctx.author.display_name} | Fehler: {e}")
        else:
            name = emote_identifier.strip()
            if action == "add":
                emote_data = await self.search_emote_by_name(name)
                if not emote_data:
                    await ctx.send(f"@{ctx.author.display_name} | Kein Emote mit dem Namen {name} gefunden.")
                    return
                emote_id = emote_data['id']
                emote_name = emote_data.get('name', name)
                try:
                    await self.add_emote_to_set(target_set_id, emote_id)
                    await ctx.send(f"@{ctx.author.display_name} | Emote {emote_name} (populärste) zum Set {target_set_display} hinzugefügt.")
                except Exception as e:
                    await ctx.send(f"@{ctx.author.display_name} | Fehler beim Hinzufügen: {e}")
            else:
                emote_id = await self.get_emote_id_by_name_in_set(target_set_id, name)
                if not emote_id:
                    await ctx.send(f"@{ctx.author.display_name} | Kein Emote mit dem Namen {name} im Set {target_set_display} gefunden.")
                    return
                try:
                    await self.remove_emote_from_set(target_set_id, emote_id)
                    await ctx.send(f"@{ctx.author.display_name} | Emote {name} aus Set {target_set_display} entfernt.")
                except Exception as e:
                    await ctx.send(f"@{ctx.author.display_name} | Fehler beim Entfernen: {e}")

    @commands.command(name='bot')
    async def bot_command(self, ctx: commands.Context, *args):
        user_role = self.get_user_role(ctx.author.name.lower())
        if user_role not in ('admin', 'broadcaster'):
            await ctx.send(f"@{ctx.author.display_name} | Du hast keine Berechtigung für Bot-Verwaltung.")
            return
        if not args:
            await ctx.send(f"@{ctx.author.display_name} | Verwendung: !bot join <channel>, !bot leave <channel>, !bot list")
            return
        subcmd = args[0].lower()
        if subcmd == "join":
            if len(args) < 2:
                await ctx.send(f"@{ctx.author.display_name} | Verwendung: !bot join <channel>")
                return
            channel = args[1].lower().lstrip('#')
            if channel in self.extra_channels:
                await ctx.send(f"@{ctx.author.display_name} | Bot ist bereits in {channel}.")
                return
            try:
                await self._send_irc(f"JOIN #{channel}")
                self.extra_channels.append(channel)
                self.save_channels()
                asyncio.create_task(self.send_join_message(channel, args[1]))
                await ctx.send(f"@{ctx.author.display_name} | Bin nun erfolgreich dem Channel {channel} beigetreten! PogChamp")
            except Exception as e:
                await ctx.send(f"@{ctx.author.display_name} | Fehler beim Joinen: {e}")
        elif subcmd == "leave":
            if len(args) < 2:
                await ctx.send(f"@{ctx.author.display_name} | Verwendung: !bot leave <channel>")
                return
            channel = args[1].lower().lstrip('#')
            if channel not in self.extra_channels:
                await ctx.send(f"@{ctx.author.display_name} | Bot ist nicht in {channel}.")
                return
            try:
                await self._send_irc(f"PART #{channel}")
                self.extra_channels.remove(channel)
                self.save_channels()
                await ctx.send(f"@{ctx.author.display_name} | Verlasse ich halt den {channel} Chat. Du Pisser WutFace")
            except Exception as e:
                await ctx.send(f"@{ctx.author.display_name} | Fehler beim Verlassen: {e}")
        elif subcmd == "list":
            channels = self.extra_channels
            if channels:
                await ctx.send(f"@{ctx.author.display_name} | Bot ist aktiv in: {', '.join(channels)}")
            else:
                await ctx.send(f"@{ctx.author.display_name} | Bot ist in keinem Channel.")
        else:
            await ctx.send(f"@{ctx.author.display_name} | Unbekannter Unterbefehl. Verwende join, leave, list.")

    async def _manage_role(self, action: str, role: str, target_login: str, ctx: commands.Context):
        user_role = self.get_user_role(ctx.author.name.lower())
        if user_role != 'admin':
            await ctx.send(f"@{ctx.author.display_name} | Du hast keine Berechtigung für diesen Befehl (nur Admins).")
            return False
        target_id = await self.get_twitch_user_id(target_login)
        if not target_id:
            await ctx.send(f"@{ctx.author.display_name} | Twitch-User {target_login} nicht gefunden.")
            return False
        broadcaster_id = await self.get_twitch_user_id(ctx.channel.name)
        if not broadcaster_id:
            await ctx.send(f"@{ctx.author.display_name} | Konnte Broadcaster-ID für diesen Channel nicht ermitteln.")
            return False
        if role == 'mod':
            url = f"https://api.twitch.tv/helix/moderation/moderators"
            params = {"broadcaster_id": broadcaster_id, "user_id": target_id}
            method = "POST" if action == "add" else "DELETE"
        elif role == 'vip':
            url = f"https://api.twitch.tv/helix/channels/vips"
            params = {"broadcaster_id": broadcaster_id, "user_id": target_id}
            method = "POST" if action == "add" else "DELETE"
        else:
            return False
        headers = {
            "Client-ID": self.client_id,
            "Authorization": f"Bearer {os.getenv('BOT_OAUTH_TOKEN').replace('oauth:', '')}"
        }
        try:
            if method == "POST":
                async with self.session.post(url, headers=headers, params=params) as resp:
                    if resp.status == 204:
                        await ctx.send(f"@{ctx.author.display_name} | {target_login} wurde als {'Moderator' if role=='mod' else 'VIP'} hinzugefügt.")
                        return True
                    else:
                        error_text = await resp.text()
                        await ctx.send(f"@{ctx.author.display_name} | Fehler beim Hinzufügen: {resp.status} - {error_text}")
                        return False
            else:
                async with self.session.delete(url, headers=headers, params=params) as resp:
                    if resp.status == 204:
                        await ctx.send(f"@{ctx.author.display_name} | {target_login} wurde als {'Moderator' if role=='mod' else 'VIP'} entfernt.")
                        return True
                    else:
                        error_text = await resp.text()
                        await ctx.send(f"@{ctx.author.display_name} | Fehler beim Entfernen: {resp.status} - {error_text}")
                        return False
        except Exception as e:
            await ctx.send(f"@{ctx.author.display_name} | Fehler bei der API-Anfrage: {e}")
            return False

    @commands.command(name='mod')
    async def mod_command(self, ctx: commands.Context, *args):
        if not args:
            await ctx.send(f"@{ctx.author.display_name} | Verwendung: !mod add <user> oder !mod remove <user>")
            return
        subcmd = args[0].lower()
        if subcmd == "add":
            if len(args) < 2:
                await ctx.send(f"@{ctx.author.display_name} | Verwendung: !mod add <user>")
                return
            await self._manage_role('add', 'mod', args[1], ctx)
        elif subcmd == "remove":
            if len(args) < 2:
                await ctx.send(f"@{ctx.author.display_name} | Verwendung: !mod remove <user>")
                return
            await self._manage_role('remove', 'mod', args[1], ctx)
        else:
            await ctx.send(f"@{ctx.author.display_name} | Unbekannter Unterbefehl. Verwende add oder remove.")

    @commands.command(name='vip')
    async def vip_command(self, ctx: commands.Context, *args):
        if not args:
            await ctx.send(f"@{ctx.author.display_name} | Verwendung: !vip add <user> oder !vip remove <user>")
            return
        subcmd = args[0].lower()
        if subcmd == "add":
            if len(args) < 2:
                await ctx.send(f"@{ctx.author.display_name} | Verwendung: !vip add <user>")
                return
            await self._manage_role('add', 'vip', args[1], ctx)
        elif subcmd == "remove":
            if len(args) < 2:
                await ctx.send(f"@{ctx.author.display_name} | Verwendung: !vip remove <user>")
                return
            await self._manage_role('remove', 'vip', args[1], ctx)
        else:
            await ctx.send(f"@{ctx.author.display_name} | Unbekannter Unterbefehl. Verwende add oder remove.")

    @commands.command(name='filesay')
    async def filesay_command(self, ctx: commands.Context):
        user_role = self.get_user_role(ctx.author.name.lower())
        if user_role not in ('admin', 'dev', 'editor'):
            await ctx.send(f"@{ctx.author.display_name} | Du hast keine Berechtigung für diesen Befehl.")
            return
        file_path = DATA_DIR / 'say.txt'
        if not file_path.exists():
            await ctx.send(f"@{ctx.author.display_name} | Die Datei say.txt existiert nicht im Datenverzeichnis.")
            return
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                lines = [line.rstrip('\n') for line in f if line.strip() != '']
        except Exception as e:
            await ctx.send(f"@{ctx.author.display_name} | Fehler beim Lesen der Datei: {e}")
            return
        if not lines:
            await ctx.send(f"@{ctx.author.display_name} | Die Datei ist leer.")
            return
        for line in lines:
            await ctx.send(line)
            await asyncio.sleep(0.5)

    @commands.command(name='isbanned')
    async def isbanned_command(self, ctx: commands.Context, user: str = None):
        user_role = self.get_user_role(ctx.author.name.lower())
        if user_role not in ('admin', 'dev', 'editor'):
            await ctx.send(f"@{ctx.author.display_name} | Du hast keine Berechtigung für diesen Befehl.")
            return
        if not user:
            await ctx.send(f"@{ctx.author.display_name} | Verwendung: !isbanned <username>")
            return
        user_id = await self.get_twitch_user_id(user)
        if user_id:
            await ctx.send(f"@{ctx.author.display_name} | Der User {user} existiert (ID: {user_id}). Er ist nicht global gebannt.")
        else:
            await ctx.send(f"@{ctx.author.display_name} | Der User {user} wurde nicht gefunden. Möglicherweise ist er global gebannt oder der Account existiert nicht mehr.")

    @commands.command(name='spam')
    async def spam_command(self, ctx: commands.Context, count: str = None, *, message: str = None):
        user_role = self.get_user_role(ctx.author.name.lower())
        if user_role not in ('admin', 'dev', 'editor'):
            await ctx.send(f"@{ctx.author.display_name} | Du hast keine Berechtigung für diesen Befehl.")
            return
        if not count or not message:
            await ctx.send(f"@{ctx.author.display_name} | Verwendung: !spam <anzahl> <nachricht> (maximal 10)")
            return
        try:
            num = int(count)
        except ValueError:
            await ctx.send(f"@{ctx.author.display_name} | Die Anzahl muss eine Zahl sein.")
            return
        if num < 1 or num > 10:
            await ctx.send(f"@{ctx.author.display_name} | Bitte eine Anzahl zwischen 1 und 10 wählen.")
            return
        if len(message) > 500:
            await ctx.send(f"@{ctx.author.display_name} | Die Nachricht ist zu lang (maximal 500 Zeichen).")
            return
        for i in range(num):
            await ctx.send(message)
            await asyncio.sleep(0.3)

if __name__ == "__main__":
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    bot = Bot()
    bot.run()