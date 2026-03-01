import os
import time
import json
import subprocess
import shutil
from datetime import datetime, timezone

VOD_DIR = "/srv/fibiibot/vod"
LOG_FILE = "/srv/fibiibot/status.log"
LIVE_FILE = "/srv/fibiibot/live_status.txt"
SYSTEMCTL_PATH = shutil.which("systemctl") or "/bin/systemctl"

def log_status(msg):
    with open(LOG_FILE, "a") as f:
        f.write(f"[{datetime.now().strftime('%d.%m.%Y %H:%M:%S')}] {msg}\n")

def is_service_active(service_name):
    try:
        result = subprocess.run([SYSTEMCTL_PATH, "is-active", service_name + ".service"], capture_output=True, text=True)
        return result.stdout.strip() == "active"
    except: return False

def format_to_timestamp(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    return f"{h:02d}:{m:02d}:{s:02d}"

def get_last_segment_number(stream_id):
    stream_dir = os.path.join(VOD_DIR, stream_id, "video")
    max_num = -1
    if not os.path.exists(stream_dir): return -1
    for f in os.listdir(stream_dir):
        if f.startswith("segment_") and f.endswith(".ts"):
            try:
                num = int(f[len("segment_"):-3])
                if num > max_num: max_num = num
            except: continue
    return max_num

def get_latest_active_stream():
    if not os.path.exists(VOD_DIR): return None
    dirs = [d for d in os.listdir(VOD_DIR) if os.path.isdir(os.path.join(VOD_DIR, d))]
    if not dirs: return None
    dirs.sort(key=lambda x: os.path.getmtime(os.path.join(VOD_DIR, x)), reverse=True)
    for d in dirs:
        meta_path = os.path.join(VOD_DIR, d, 'meta.json')
        if os.path.exists(meta_path):
            try:
                with open(meta_path, 'r', encoding="utf-8") as f: meta = json.load(f)
                if 'ended_at' not in meta: return meta
            except: pass
    return None

def monitor():
    service_names = ["recfibiibot", "webfibiibot", "apifibiibot"]
    services = {}
    for srv in service_names:
        active = is_service_active(srv)
        services[srv] = {"running": active, "down_since": 0}

    while True:
        live_output = [f"Letzter Check: {datetime.now().strftime('%H:%M:%S')}"]
        for srv in service_names:
            active = is_service_active(srv)
            was_running = services[srv]["running"]
            live_output.append(f"{'🟢' if active else '🔴'} {srv}")

            if not active and was_running:
                services[srv]["down_since"] = time.time()
                services[srv]["running"] = False
                log_status(f"Service {srv} ausgefallen.")

            elif active and not was_running:
                downtime_start = services[srv]["down_since"]
                services[srv]["running"] = True
                if srv == "recfibiibot" and downtime_start > 0:
                    meta = get_latest_active_stream()
                    if meta:
                        stream_id = meta['id']
                        stream_dir = os.path.join(VOD_DIR, stream_id, "video")
                        outage_point = (get_last_segment_number(stream_id) + 1) * 10
                        downtime_duration = time.time() - downtime_start
                        meta_path = os.path.join(VOD_DIR, stream_id, "meta.json")
                        with open(meta_path, "r", encoding="utf-8") as f: m_data = json.load(f)
                        if "outages" not in m_data: m_data["outages"] = []
                        m_data["outages"].append({
                            "time": outage_point,
                            "duration": int(downtime_duration),
                            "readable_time": format_to_timestamp(outage_point)
                        })
                        with open(meta_path, "w", encoding="utf-8") as f: json.dump(m_data, f, ensure_ascii=False, indent=2)
                services[srv]["down_since"] = 0
        with open(LIVE_FILE, "w") as f: f.write("\n".join(live_output) + "\n")
        time.sleep(1)

if __name__ == "__main__":
    monitor()