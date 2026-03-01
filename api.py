import os
import json
import asyncio
import requests
from datetime import datetime
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

CHANNEL = "fibii"
DATA_DIR = "data/apidata"
API_KEY = os.getenv("DASHBOARD_API_KEY")

os.makedirs(DATA_DIR, exist_ok=True)

def init_json_file(filename, initial_data):
    path = os.path.join(DATA_DIR, filename)
    if not os.path.exists(path):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(initial_data, f, indent=2)

init_json_file("follower.json", [])
init_json_file("live.json", [])
init_json_file("stream_id.json", [])
init_json_file("followers_gained.json", {})
init_json_file("views.json", {})
init_json_file("avg-viewer.json", {})
init_json_file("uptime.json", {})
init_json_file("watched.json", {})

TWITCH_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"
GQL_URL = "https://gql.twitch.tv/gql"

FOLLOWER_QUERY = """
query FollowCount_Query($login: String!) {
  user(login: $login) {
    followers {
      totalCount
    }
  }
}
"""

STREAM_QUERY = """
query StreamInfo_Query($login: String!) {
  user(login: $login) {
    stream {
      id
      viewersCount
    }
  }
}
"""

app = FastAPI()

allow_origins = [
    "https://fibiibot.com",
    "https://www.fibiibot.com"
]

if os.getenv("DEV_MODE", "false").lower() == "true":
    allow_origins.append("http://localhost:5000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def read_json(filename):
    path = os.path.join(DATA_DIR, filename)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def write_json(filename, data):
    path = os.path.join(DATA_DIR, filename)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

def sort_dict_by_timestamp(data, timestamp_key):
    if not isinstance(data, dict):
        return data
    sorted_items = sorted(
        data.items(),
        key=lambda item: item[1].get(timestamp_key, ""),
        reverse=True
    )
    return dict(sorted_items)

def fetch_followers(username):
    headers = {
        "Client-ID": TWITCH_CLIENT_ID,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
        "Cache-Control": "no-cache"
    }
    payload = {
        "query": FOLLOWER_QUERY,
        "variables": {"login": username.lower()}
    }
    try:
        resp = requests.post(GQL_URL, json=payload, headers=headers, timeout=10)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Fehler: {str(e)}")
    if "errors" in data:
        raise HTTPException(status_code=400, detail=data["errors"][0]["message"])
    user_data = data.get("data", {}).get("user")
    if not user_data:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")
    return user_data["followers"]["totalCount"]

def fetch_stream_info(username):
    headers = {
        "Client-ID": TWITCH_CLIENT_ID,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
        "Cache-Control": "no-cache"
    }
    payload = {
        "query": STREAM_QUERY,
        "variables": {"login": username.lower()}
    }
    try:
        resp = requests.post(GQL_URL, json=payload, headers=headers, timeout=10)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Fehler: {str(e)}")
    if "errors" in data:
        raise HTTPException(status_code=400, detail=data["errors"][0]["message"])
    user_data = data.get("data", {}).get("user")
    if not user_data:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")
    stream = user_data.get("stream")
    if stream:
        return {"id": stream.get("id"), "viewers": stream.get("viewersCount")}
    return None

async def collect_follower():
    try:
        followers = fetch_followers(CHANNEL)
    except:
        return
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    history = read_json("follower.json")
    if not isinstance(history, list):
        history = []
    history.append({"timestamp": timestamp, "followers": followers})
    write_json("follower.json", history)

async def track_live_status():
    last_status = None
    gained_data = read_json("followers_gained.json")
    if not isinstance(gained_data, dict):
        gained_data = {}
    for stream_id, entry in list(gained_data.items()):
        if "updates" in entry and entry["updates"]:
            last_update = entry["updates"][-1]
            gained_data[stream_id] = {
                "start_followers": entry["start_followers"],
                "timestamp": last_update["timestamp"],
                "gained": last_update["gained"]
            }
        elif "updates" in entry and not entry["updates"]:
            gained_data[stream_id] = {
                "start_followers": entry["start_followers"],
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "gained": 0
            }
    gained_data = sort_dict_by_timestamp(gained_data, "timestamp")
    write_json("followers_gained.json", gained_data)

    views_data = read_json("views.json")
    if not isinstance(views_data, dict):
        views_data = {}
    avg_data = read_json("avg-viewer.json")
    if not isinstance(avg_data, dict):
        avg_data = {}
    uptime_data = read_json("uptime.json")
    if not isinstance(uptime_data, dict):
        uptime_data = {}
    for entry in uptime_data.values():
        if "first_seen" not in entry:
            entry["first_seen"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        entry.pop("last_updated", None)
    uptime_data = sort_dict_by_timestamp(uptime_data, "first_seen")
    write_json("uptime.json", uptime_data)

    watched_data = read_json("watched.json")
    if not isinstance(watched_data, dict):
        watched_data = {}
    watched_data = sort_dict_by_timestamp(watched_data, "timestamp")
    write_json("watched.json", watched_data)

    avg_data = sort_dict_by_timestamp(avg_data, "timestamp")
    write_json("avg-viewer.json", avg_data)

    while True:
        try:
            stream_info = fetch_stream_info(CHANNEL)
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            current_time = datetime.now()
            current_live = stream_info is not None
            current_stream_id = stream_info["id"] if current_live else None
            current_viewers = stream_info["viewers"] if current_live else None

            live_history = read_json("live.json")
            if not isinstance(live_history, list):
                live_history = []
            if last_status is None:
                if live_history:
                    last_status = live_history[-1]["live"]
                else:
                    last_status = current_live
                    live_history.append({"timestamp": timestamp, "live": current_live, "stream_id": current_stream_id})
                    write_json("live.json", live_history)
            elif current_live != last_status:
                live_history.append({"timestamp": timestamp, "live": current_live, "stream_id": current_stream_id})
                write_json("live.json", live_history)
                last_status = current_live

            if current_live:
                if current_stream_id not in uptime_data:
                    uptime_data[current_stream_id] = {"first_seen": timestamp, "uptime_seconds": 0}
                else:
                    first_seen = datetime.strptime(uptime_data[current_stream_id]["first_seen"], "%Y-%m-%d %H:%M:%S")
                    uptime_data[current_stream_id]["uptime_seconds"] = int((current_time - first_seen).total_seconds())
                uptime_data = sort_dict_by_timestamp(uptime_data, "first_seen")
                write_json("uptime.json", uptime_data)

                if current_stream_id not in views_data:
                    views_data[current_stream_id] = []
                views_data[current_stream_id].append({"timestamp": timestamp, "viewers": current_viewers})
                write_json("views.json", views_data)

                viewers_list = views_data[current_stream_id]
                total_minutes = 0.0
                for i in range(1, len(viewers_list)):
                    prev = viewers_list[i-1]
                    curr = viewers_list[i]
                    prev_time = datetime.strptime(prev["timestamp"], "%Y-%m-%d %H:%M:%S")
                    curr_time = datetime.strptime(curr["timestamp"], "%Y-%m-%d %H:%M:%S")
                    delta = (curr_time - prev_time).total_seconds() / 60.0
                    total_minutes += prev["viewers"] * delta
                if current_stream_id not in watched_data:
                    watched_data[current_stream_id] = {"timestamp": uptime_data[current_stream_id]["first_seen"], "watch_minutes": round(total_minutes)}
                else:
                    watched_data[current_stream_id]["watch_minutes"] = round(total_minutes)
                watched_data = sort_dict_by_timestamp(watched_data, "timestamp")
                write_json("watched.json", watched_data)

                avg = sum(e["viewers"] for e in viewers_list) / len(viewers_list)
                if current_stream_id not in avg_data:
                    avg_data[current_stream_id] = {"timestamp": uptime_data[current_stream_id]["first_seen"], "average": round(avg)}
                else:
                    avg_data[current_stream_id]["average"] = round(avg)
                avg_data = sort_dict_by_timestamp(avg_data, "timestamp")
                write_json("avg-viewer.json", avg_data)

                try:
                    current_followers = fetch_followers(CHANNEL)
                    if current_stream_id not in gained_data:
                        gained_data[current_stream_id] = {
                            "start_followers": current_followers,
                            "timestamp": uptime_data[current_stream_id]["first_seen"],
                            "gained": 0
                        }
                    else:
                        gained = current_followers - gained_data[current_stream_id]["start_followers"]
                        if gained != gained_data[current_stream_id]["gained"]:
                            gained_data[current_stream_id]["gained"] = gained
                except:
                    pass
                gained_data = sort_dict_by_timestamp(gained_data, "timestamp")
                write_json("followers_gained.json", gained_data)

        except Exception:
            pass
        await asyncio.sleep(5)

async def track_stream_id():
    last_stream_id = None
    while True:
        try:
            stream_info = fetch_stream_info(CHANNEL)
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            current_id = stream_info["id"] if stream_info else None
            history = read_json("stream_id.json")
            if not isinstance(history, list):
                history = []
            if current_id != last_stream_id:
                history.append({"timestamp": timestamp, "stream_id": current_id})
                write_json("stream_id.json", history)
                last_stream_id = current_id
        except:
            pass
        await asyncio.sleep(60)

async def background_collector():
    await collect_follower()
    while True:
        await asyncio.sleep(3600)
        await collect_follower()

async def update_dashboard():
    while True:
        try:
            old_entries = {}
            try:
                with open("statistics/dashboard.json", "r", encoding="utf-8") as f:
                    for e in json.load(f):
                        if "id" in e:
                            old_entries[e["id"]] = e
            except:
                old_entries = {}

            avg_data = read_json("avg-viewer.json")
            followers_data = read_json("followers_gained.json")
            uptime_data = read_json("uptime.json")
            watched_data = read_json("watched.json")

            all_ids = set(avg_data.keys()) | set(followers_data.keys()) | set(uptime_data.keys()) | set(watched_data.keys())
            new_entries = {}

            for stream_id in all_ids:
                avg_entry = avg_data.get(stream_id, {})
                followers_entry = followers_data.get(stream_id, {})
                uptime_entry = uptime_data.get(stream_id, {})
                watched_entry = watched_data.get(stream_id, {})

                viewers = avg_entry.get("average")
                followers = followers_entry.get("gained", 0)
                uptime = uptime_entry.get("uptime_seconds")
                watched = watched_entry.get("watch_minutes")
                timestamp = uptime_entry.get("first_seen")

                if None not in (viewers, uptime, watched, timestamp):
                    if ' ' in timestamp:
                        timestamp_iso = timestamp.replace(' ', 'T') + 'Z'
                    else:
                        timestamp_iso = timestamp

                    entry = {
                        "id": stream_id,
                        "timestamp": timestamp_iso,
                        "watched": watched,
                        "viewers": viewers,
                        "followers": followers,
                        "uptime": uptime
                    }
                    new_entries[stream_id] = entry

            combined = {**old_entries, **new_entries}
            dashboard_entries = list(combined.values())
            dashboard_entries.sort(key=lambda e: e["timestamp"], reverse=True)

            dashboard_path = os.path.join("statistics", "dashboard.json")
            os.makedirs(os.path.dirname(dashboard_path), exist_ok=True)
            with open(dashboard_path, "w", encoding="utf-8") as f:
                json.dump(dashboard_entries, f, indent=2)
        except Exception:
            pass

        await asyncio.sleep(5)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(background_collector())
    asyncio.create_task(track_live_status())
    asyncio.create_task(track_stream_id())
    asyncio.create_task(update_dashboard())

@app.get(f"/v1/{CHANNEL}/follows")
async def channel_follows():
    followers = fetch_followers(CHANNEL)
    return JSONResponse(content={"followers": followers})

@app.get(f"/v1/{CHANNEL}/live")
async def channel_live():
    stream_info = fetch_stream_info(CHANNEL)
    return JSONResponse(content={"live": stream_info is not None})

@app.get(f"/v1/{CHANNEL}/id")
async def channel_id():
    stream_info = fetch_stream_info(CHANNEL)
    sid = stream_info["id"] if stream_info else None
    return JSONResponse(content={"stream_id": sid})

@app.get(f"/v1/{CHANNEL}/current_viewers")
async def current_viewers():
    stream_info = fetch_stream_info(CHANNEL)
    if not stream_info:
        raise HTTPException(status_code=404, detail="Stream nicht live")
    return JSONResponse(content={"viewers": stream_info["viewers"]})

@app.get(f"/v1/stream/{{stream_id}}/{CHANNEL}/gained")
async def stream_gained(stream_id: str):
    gained_data = read_json("followers_gained.json")
    if stream_id not in gained_data:
        raise HTTPException(status_code=404, detail="Stream-ID nicht gefunden")
    return JSONResponse(content=gained_data[stream_id])

@app.get(f"/v1/stream/{{stream_id}}/{CHANNEL}/views")
async def stream_views(stream_id: str):
    views_data = read_json("views.json")
    if stream_id not in views_data:
        raise HTTPException(status_code=404, detail="Keine View-Daten")
    return JSONResponse(content=views_data[stream_id])

@app.get(f"/v1/stream/{{stream_id}}/{CHANNEL}/avg-viewer")
async def stream_avg_viewer(stream_id: str):
    avg_data = read_json("avg-viewer.json")
    if stream_id not in avg_data:
        raise HTTPException(status_code=404, detail="Kein Durchschnitt")
    return JSONResponse(content=avg_data[stream_id])

@app.get(f"/v1/stream/{{stream_id}}/{CHANNEL}/uptime")
async def stream_uptime(stream_id: str):
    uptime_data = read_json("uptime.json")
    if stream_id not in uptime_data:
        raise HTTPException(status_code=404, detail="Keine Uptime-Daten")
    return JSONResponse(content=uptime_data[stream_id])

@app.get(f"/v1/stream/{{stream_id}}/{CHANNEL}/watch")
async def stream_watch(stream_id: str):
    watched_data = read_json("watched.json")
    if stream_id not in watched_data:
        raise HTTPException(status_code=404, detail="Keine Watchtime-Daten")
    return JSONResponse(content=watched_data[stream_id])

@app.get("/v1/streamer/220716126/fibii/dashboard/stats")
async def get_dashboard_stats(request: Request):
    api_key = request.headers.get("X-API-Key")
    if not api_key or api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        with open("statistics/dashboard.json", "r", encoding="utf-8") as f:
            data = json.load(f)
        return JSONResponse(content={"streams": data})
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="dashboard.json nicht gefunden")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=7777)