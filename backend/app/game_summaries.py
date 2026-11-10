"""Per-player game numbers from the full 10Hz (on-field time only), for Player Profile.

The 10Hz summaries pulled for This Week cover the whole recording (warm-up and breaks),
so minutes and m/min from them are meaningless for games. This downloads each game's full
10Hz once (same cache as Game Report), splits it into quarters with on-field time estimated,
and keeps one row per player per game plus one per player per quarter:

  sport_science_data/catapult_api/game_players.csv
  sport_science_data/catapult_api/game_quarters.csv
"""
from __future__ import annotations

import threading

import numpy as np
import pandas as pd

from . import game_report_page, this_week
from .fss import catapult_api, game_report, tenhz
from .fss.config import CATAPULT_API_DIR, HSR_KMH, SPRINT_KMH

PLAYERS_FILE = CATAPULT_API_DIR / "game_players.csv"
QUARTERS_FILE = CATAPULT_API_DIR / "game_quarters.csv"
SCHEMA = 1
_JOB = {"running": False, "message": "", "error": None, "done": 0, "total": 0}


def load_players() -> pd.DataFrame:
    if not PLAYERS_FILE.exists():
        return pd.DataFrame()
    df = pd.read_csv(PLAYERS_FILE)
    df["date"] = pd.to_datetime(df["date"]).dt.date
    df["activity_id"] = df["activity_id"].astype(str)
    return df


def load_quarters() -> pd.DataFrame:
    if not QUARTERS_FILE.exists():
        return pd.DataFrame()
    df = pd.read_csv(QUARTERS_FILE)
    df["activity_id"] = df["activity_id"].astype(str)
    return df


def _quarter_rows(d: pd.DataFrame) -> list:
    rows = []
    hz = game_report.HZ
    for (player, q), g in d[d["on_field"]].groupby(["player", "quarter"]):
        kmh, step = g["v"].to_numpy() * 3.6, g["v"].to_numpy() / hz
        minutes = len(g) / hz / 60
        dist = float(step.sum())
        rows.append({"player": player, "quarter": int(q), "minutes": minutes, "distance_m": dist,
                     "m_per_min": dist / minutes if minutes else np.nan,
                     "hsr_m": float((step * game_report._band(kmh, HSR_KMH)).sum()),
                     "sprint_m": float((step * game_report._band(kmh, SPRINT_KMH)).sum())})
    return rows


def summarise(activity_id: str, maxes: dict) -> tuple:
    act = tenhz.activity(activity_id)
    periods = sorted(act["period_list"], key=lambda p: p["start_time"])
    d = game_report.label_quarters(tenhz.load(activity_id), periods)
    p = game_report.player_rows(d, maxes)
    date = pd.Timestamp(act["start_time"], unit="s", tz="UTC").tz_convert("Australia/Melbourne").date()
    base = {"activity_id": activity_id, "activity": (act.get("name") or "").strip(), "date": date}
    players = [{**base, "player": r["player"], "minutes": r["minutes"], "distance_m": r["distance_m"],
                "m_per_min": r["m_per_min"], "hsr_m": r["hsr_m"], "hsr_m_per_min": r["hsr_m_per_min"],
                "sprint_m": r["sprint_m"], "sprint_efforts": r["sprint_efforts"], "accels": r["accels"],
                "decels": r["decels"], "player_load": r["player_load"], "peak_kmh": r["max_kmh"]}
               for _, r in p.iterrows()]
    quarters = [{**base, **r} for r in _quarter_rows(d)]
    return players, quarters


def status() -> dict:
    done = set(load_players()["activity_id"]) if PLAYERS_FILE.exists() else set()
    return {**_JOB, "games_with_10hz": len(done)}


def start(token: str, region: str) -> dict:
    if _JOB["running"]:
        return status()
    catapult_api.use_token(token, this_week.REGION_CODES.get(region, "au"))
    _JOB.update(running=True, message="Finding games…", error=None, done=0, total=0)

    def run():
        try:
            games = tenhz.games()
            have = set(load_players()["activity_id"]) if PLAYERS_FILE.exists() else set()
            todo = [g for g in games if g["id"] not in have]
            _JOB["total"] = len(todo)
            mx = game_report_page._maxes()
            for i, g in enumerate(todo):
                label = f"{g['name']} ({i + 1} of {len(todo)})"
                if not tenhz.is_cached(g["id"]):
                    tenhz.activity(g["id"])
                    tenhz.load(g["id"], progress=lambda k, n, label=label: _JOB.__setitem__(
                        "message", f"Downloading {label} · player {k + 1} of {n}"))
                _JOB["message"] = f"Working out {label}"
                players, quarters = summarise(g["id"], mx)
                old_p, old_q = load_players(), load_quarters()
                if len(old_p):
                    old_p = old_p[old_p["activity_id"] != g["id"]]
                if len(old_q):
                    old_q = old_q[old_q["activity_id"] != g["id"]]
                pd.concat([old_p, pd.DataFrame(players)], ignore_index=True).to_csv(PLAYERS_FILE, index=False)
                pd.concat([old_q, pd.DataFrame(quarters)], ignore_index=True).to_csv(QUARTERS_FILE, index=False)
                _JOB["done"] = i + 1
        except Exception as e:  # noqa: BLE001
            _JOB["error"] = str(e)
        _JOB.update(running=False, message="")

    threading.Thread(target=run, daemon=True).start()
    return status()
