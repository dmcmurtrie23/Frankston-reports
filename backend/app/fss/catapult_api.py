"""Pull sessions straight from Catapult (OpenField Cloud API) so nobody has to export CSVs.

For each player in each session we download the 10Hz speed, acceleration and
odometer channels and keep a small summary row:
- peak speed, and the fastest speed held for 0.3 / 0.5 / 1.0 s (the 90% flag);
- load: distance, HSR, sprint, accels, decels, and metres above every 0.5 km/h
  from 20 to 35 km/h (so "above 80% of max" works for any max without re-downloading).
The raw 10Hz data isn't stored.

Run a pull by hand (or from a schedule):  .venv/bin/python -m fss.catapult_api
"""
from __future__ import annotations

import base64
from concurrent.futures import ThreadPoolExecutor
try:
    import fcntl   # macOS / Linux; not available on Windows
except ImportError:  # pragma: no cover
    fcntl = None
import gzip
import json
import re
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from typing import Callable, Optional
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from .config import (API_SYNC_EVERY_MINUTES, API_SYNC_FROM, CATAPULT_API_DIR, CATAPULT_REGION, HSR_KMH,
                     MIN_DWELL_SECONDS, NO_GPS_KMH, SECRETS, SPRINT_KMH, TIMEZONE)
from .game_report import ACCEL_MIN_S, ACCEL_MS2, BAND_MIN_S, MAX_STEP_M, _band, _runs
from .names import canonical

SPEED_FILE = CATAPULT_API_DIR / "speed.csv"
STATE_FILE = CATAPULT_API_DIR / "sync.json"
LOCK_FILE = CATAPULT_API_DIR / "sync.lock"  # held while a pull runs (app or background job)
DWELLS_MS = (300, 500, 1000)
SAMPLE_S = 0.1  # Vector S7 records at 10Hz
ABOVE_KMH = [round(20 + 0.5 * i, 1) for i in range(31)]   # 20.0 … 35.0 km/h
PEAKS = {"mpm": (30, 60, 180, 300), "hsr": (60, 300)}   # best m/min (and HSR m/min) over these seconds
PEAK_COLUMNS = [f"peak_{m}_{s}s" for m, secs in PEAKS.items() for s in secs]
LOAD_COLUMNS = (["distance_m", "hsr_m", "sprint_m", "accels", "decels"] + PEAK_COLUMNS
                + [f"above_{k:.1f}" for k in ABOVE_KMH])
COLUMNS = (["activity_id", "activity", "date", "start_time", "athlete_id", "player", "seconds",
            "peak_kmh"] + [f"top_{ms}ms_kmh" for ms in DWELLS_MS] + LOAD_COLUMNS + ["game", "stored_max_kmh", "modified_at"])
SCHEMA = 3       # bump when the summary changes: every session is pulled again once
SENSOR_FIELDS = "ts,cs,v,a,o"
PARALLEL = 6     # players downloaded at once


class CatapultError(Exception):
    pass


# ---------------------------------------------------------------- token

_TOKEN_OVERRIDE: Optional[str] = None
_REGION_OVERRIDE: Optional[str] = None


def use_token(tok: Optional[str], region: Optional[str] = None) -> None:
    """Frankston Reports passes the token typed into its sidebar (nothing is written to disk)."""
    global _TOKEN_OVERRIDE, _REGION_OVERRIDE
    tok = (tok or "").strip()
    if tok.lower().startswith("bearer "):
        tok = tok.split(" ", 1)[1].strip()
    _TOKEN_OVERRIDE = tok or None
    _REGION_OVERRIDE = region


def token() -> Optional[str]:
    """The token passed in by the app, else [catapult] token = "..." in sport_science_data/secrets.toml."""
    if _TOKEN_OVERRIDE:
        return _TOKEN_OVERRIDE
    if not SECRETS.exists():
        return None
    m = re.search(r'^\s*token\s*=\s*"([^"]+)"', SECRETS.read_text(encoding="utf-8"), flags=re.M)
    return m.group(1).strip() if m else None


def token_expiry(tok: Optional[str] = None) -> Optional[date]:
    """When the token stops working (read from the token itself, nothing is sent anywhere)."""
    tok = tok or token()
    try:
        payload = tok.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        return datetime.fromtimestamp(claims["exp"], ZoneInfo(TIMEZONE)).date()
    except Exception:
        return None


# ---------------------------------------------------------------- API calls

def _get(tok: str, endpoint: str, retries: int = 3):
    url = f"https://connect-{_REGION_OVERRIDE or CATAPULT_REGION}.catapultsports.com/api/v6/{endpoint}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {tok}", "Accept": "application/json",
                                               "Accept-Encoding": "gzip"})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                body = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    body = gzip.decompress(body)
                return json.loads(body or b"null")
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise CatapultError("Catapult rejected the token. It may have expired or been revoked.") from e
            if e.code == 404:
                return None
            err = f"Catapult returned error {e.code}"
        except (urllib.error.URLError, TimeoutError) as e:
            err = f"Couldn't reach Catapult ({e})"
        time.sleep(2 * (attempt + 1))
    raise CatapultError(err)


# ---------------------------------------------------------------- 10Hz summary

def top_speeds(ts, cs, v) -> dict:
    """Peak speed and the fastest speed held for each dwell, in km/h.

    "Held for 0.5 s" = the best 5 consecutive samples, scored by the slowest of
    the 5. Windows never span a gap in the recording.
    """
    t = np.asarray(ts, float) + np.asarray(cs, float) / 100
    v = np.asarray(v, float) * 3.6
    out = {"seconds": round(len(v) * SAMPLE_S), "peak_kmh": float(np.nanmax(v)) if len(v) else None}
    breaks = np.flatnonzero(np.diff(t) > SAMPLE_S * 1.5) + 1
    segments = np.split(v, breaks)
    for ms in DWELLS_MS:
        n = int(round(ms / 1000 / SAMPLE_S))
        best = [np.lib.stride_tricks.sliding_window_view(s, n).min(axis=1).max() for s in segments if len(s) >= n]
        out[f"top_{ms}ms_kmh"] = round(float(max(best)), 2) if best else None
    out["peak_kmh"] = None if out["peak_kmh"] is None else round(out["peak_kmh"], 2)
    return out


def load_summary(ts, cs, v, a, o) -> dict:
    """Session load from 10Hz: same definitions as the game report (calibrated to OpenField)."""
    t = np.asarray(ts, float) + np.asarray(cs, float) / 100
    kmh = np.asarray(v, float) * 3.6
    step = np.asarray(v, float) * SAMPLE_S
    contiguous = np.concatenate([[False], np.diff(t) < SAMPLE_S * 1.5])
    d_o = np.concatenate([[0.0], np.diff(np.asarray(o, float))])
    acc = np.asarray(a, float)
    out = {"distance_m": round(float(d_o[contiguous & (d_o >= 0) & (d_o <= MAX_STEP_M)].sum()), 1),
           "hsr_m": round(float((step * _band(kmh, HSR_KMH)).sum()), 1),
           "sprint_m": round(float((step * _band(kmh, SPRINT_KMH)).sum()), 1),
           "accels": _runs(acc >= ACCEL_MS2, int(ACCEL_MIN_S / SAMPLE_S)),
           "decels": _runs(acc <= -ACCEL_MS2, int(ACCEL_MIN_S / SAMPLE_S))}
    for k in ABOVE_KMH:
        out[f"above_{k:.1f}"] = round(float((step * _band(kmh, k)).sum()), 1)
    # peak windows over the whole recording (for games this includes the bench, which can't create a peak)
    hsr = step * _band(kmh, HSR_KMH)
    for metric, secs in PEAKS.items():
        series = step if metric == "mpm" else hsr
        c = np.concatenate([[0.0], np.cumsum(series)])
        for sec in secs:
            n = int(sec / SAMPLE_S)
            out[f"peak_{metric}_{sec}s"] = round(float((c[n:] - c[:-n]).max() * 60 / sec), 1) if len(series) >= n else None
    return out


def is_game(activity: dict) -> bool:
    """Tagged MD in OpenField, or named like a round, final or practice match."""
    tags = {t.get("name") if isinstance(t, dict) else t for t in activity.get("tags") or []}
    if activity["name"].strip().lower() == "not playing":
        return False
    return "MD" in tags or bool(re.search(r"\b(rd|round|wildcard|final)\b|\bvs\b", activity["name"], flags=re.I))


def above(row, kmh: float) -> float:
    """Metres above any speed (efforts ≥1 s), interpolated from the stored 0.5 km/h steps."""
    if kmh <= ABOVE_KMH[0]:
        return row[f"above_{ABOVE_KMH[0]:.1f}"]
    if kmh >= ABOVE_KMH[-1]:
        return row[f"above_{ABOVE_KMH[-1]:.1f}"]
    lo = ABOVE_KMH[int((kmh - ABOVE_KMH[0]) // 0.5)]
    hi = round(lo + 0.5, 1)
    f = (kmh - lo) / 0.5
    return row[f"above_{lo:.1f}"] * (1 - f) + row[f"above_{hi:.1f}"] * f


def _label(name: str, day: date) -> str:
    """OpenField auto-names training 'Activity 202681374746': show it as 'Training Thu 13 Aug'."""
    if re.fullmatch(r"Activity \d+", name.strip()):
        return f"Training {day:%a %d %b}"
    return name.strip()


def pull_activity(tok: str, activity: dict, progress: Optional[Callable] = None) -> list:
    """One summary row per player who wore a unit in this activity (players downloaded in parallel)."""
    start = datetime.fromtimestamp(activity["start_time"], timezone.utc).astimezone(ZoneInfo(TIMEZONE))
    athletes = _get(tok, f"activities/{activity['id']}/athletes") or []

    def one(a):
        data = _get(tok, f"activities/{activity['id']}/athletes/{a['id']}/sensor?parameters={SENSOR_FIELDS}")
        samples = (data or [{}])[0].get("data") or []
        if not samples:
            return None
        frame = pd.DataFrame(samples)
        stored = a.get("velocity_max")
        return {
            "activity_id": activity["id"], "activity": _label(activity["name"], start.date()),
            "date": start.date().isoformat(), "start_time": start.strftime("%H:%M:%S"),
            "athlete_id": a["id"], "player": canonical(f"{a['first_name']} {a['last_name']}"),
            **top_speeds(frame["ts"], frame["cs"], frame["v"]),
            **load_summary(frame["ts"], frame["cs"], frame["v"], frame["a"], frame["o"]),
            "game": is_game(activity),
            "stored_max_kmh": round(stored * 3.6, 2) if stored else None,
            "modified_at": activity.get("modified_at"),
        }

    rows = []
    with ThreadPoolExecutor(max_workers=PARALLEL) as pool:
        for i, row in enumerate(pool.map(one, athletes)):
            if progress:
                progress(i, len(athletes))
            if row:
                rows.append(row)
    return rows


# ---------------------------------------------------------------- sync

def _state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return {}


def _save_state(state: dict) -> None:
    CATAPULT_API_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=1))


def load_speed() -> pd.DataFrame:
    if not SPEED_FILE.exists():
        return pd.DataFrame(columns=COLUMNS)
    df = pd.read_csv(SPEED_FILE)
    df["date"] = pd.to_datetime(df["date"]).dt.date
    return df


def sync(since: date = API_SYNC_FROM, progress: Optional[Callable] = None) -> dict:
    """Download any session that's new or changed since the last pull.

    Saves after each session, so an interrupted pull picks up where it stopped.
    Only one pull runs at a time: if the app or the background job is already
    pulling, this returns straight away with busy=True.
    Returns {"new": [...activity labels], "error": message or None, "busy": bool}.
    """
    if not token():
        return {"new": [], "error": None, "busy": False}
    CATAPULT_API_DIR.mkdir(parents=True, exist_ok=True)
    with open(LOCK_FILE, "w") as lock:
        try:
            if fcntl:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)  # released automatically if the process dies
        except BlockingIOError:
            return {"new": [], "error": None, "busy": True}
        return _sync(since, progress)


def _sync(since: date, progress: Optional[Callable]) -> dict:
    tok = token()
    state = _state()
    result = {"new": [], "error": None, "busy": False}
    try:
        activities = _get(tok, "activities") or []
        cutoff = datetime(since.year, since.month, since.day, tzinfo=ZoneInfo(TIMEZONE)).timestamp()
        done = state.get("done", {}) if state.get("schema") == SCHEMA else {}  # new summary: pull everything again
        state["schema"] = SCHEMA
        todo = sorted((a for a in activities if a["start_time"] >= cutoff
                       and done.get(a["id"]) != a.get("modified_at")), key=lambda a: a["start_time"])
        for n, act in enumerate(todo):
            step = (lambda i, total, n=n, act=act:
                    progress(f"{act['name']} ({n + 1} of {len(todo)}), player {i + 1} of {total}")) if progress else None
            rows = pull_activity(tok, act, step)
            speed = load_speed()
            speed = speed[speed["activity_id"] != act["id"]].reindex(columns=COLUMNS)
            speed = pd.concat([speed, pd.DataFrame(rows, columns=COLUMNS)], ignore_index=True)
            CATAPULT_API_DIR.mkdir(parents=True, exist_ok=True)
            speed.sort_values(["date", "start_time", "player"]).to_csv(SPEED_FILE, index=False)
            done[act["id"]] = act.get("modified_at")
            state["done"] = done
            _save_state(state)
            if rows:
                result["new"].append(rows[0]["activity"])
    except CatapultError as e:
        result["error"] = str(e)
    state["last_check"] = time.time()
    state["last_error"] = result["error"]
    _save_state(state)
    return result


def sync_due(minutes: int = API_SYNC_EVERY_MINUTES) -> bool:
    return token() is not None and time.time() - _state().get("last_check", 0) > minutes * 60


def last_check() -> Optional[datetime]:
    ts = _state().get("last_check")
    return datetime.fromtimestamp(ts, ZoneInfo(TIMEZONE)) if ts else None


def last_error() -> Optional[str]:
    return _state().get("last_error")


# ---------------------------------------------------------------- for the speed flag

def speed_sessions(speed: Optional[pd.DataFrame] = None, dwell_s: float = MIN_DWELL_SECONDS) -> pd.DataFrame:
    """API sessions shaped like catapult.sessions(), using the dwell-checked top speed.

    max_velocity_kmh is the fastest speed held for at least `dwell_s`, so a
    0.2 s blip can't count as a 90% exposure (or a new top speed).
    """
    speed = load_speed() if speed is None else speed
    speed = speed[speed["peak_kmh"] >= NO_GPS_KMH]  # no GPS speed = no data, not "didn't hit 90%"
    col = f"top_{int(round(dwell_s * 1000))}ms_kmh"
    if col not in COLUMNS:
        raise ValueError(f"MIN_DWELL_SECONDS must be one of {[ms / 1000 for ms in DWELLS_MS]}")
    if speed.empty:
        return pd.DataFrame(columns=["player", "date", "start_time", "activity", "source_file", "period",
                                     "duration_s", "max_velocity_kmh", "peak_kmh", "openfield_max_kmh", "dwell_checked"])
    return pd.DataFrame({
        "player": speed["player"], "date": speed["date"], "start_time": speed["start_time"],
        "activity": speed["activity"], "source_file": "catapult:" + speed["activity_id"].astype(str),
        "period": "Session", "duration_s": speed["seconds"],
        "max_velocity_kmh": speed[col], "peak_kmh": speed["peak_kmh"],
        "openfield_max_kmh": speed["stored_max_kmh"], "dwell_checked": True,
    })


def no_gps(speed: Optional[pd.DataFrame] = None) -> pd.DataFrame:
    """Units worn but with no usable speed (no GPS lock, indoors, left in a bag)."""
    speed = load_speed() if speed is None else speed
    return speed[speed["peak_kmh"].fillna(0) < NO_GPS_KMH]


if __name__ == "__main__":
    out = sync(progress=lambda msg: print("  " + msg, end="\r", flush=True))
    print()
    if out["busy"]:
        print("Another pull is already running (the app or the background job). Try again in a minute.")
    if out["error"]:
        print("Error:", out["error"])
    print(f"Pulled {len(out['new'])} session(s)" + (": " + ", ".join(out["new"]) if out["new"] else "."))
    print(f"Token expires {token_expiry():%d %b %Y}" if token_expiry() else "No token found.")
