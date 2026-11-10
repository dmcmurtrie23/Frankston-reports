"""Drill matrix: what each training drill asks of players, from Catapult's drill splits.

Sessions split into periods (drills) in OpenField are pulled at 10Hz and each
player's time in each drill is summarised with the same definitions as the game
report (HSR > 19.8 km/h, sprint > 25.2 km/h, efforts held 1 s, accels ±3 m/s²).
Only the per-drill numbers are kept (data/catapult_api/drills.csv), not the 10Hz.

Drill names are typed by hand in OpenField, so the same drill turns up spelt
several ways. data/config/drill_names.csv maps each name to one drill; a blank
drill means "not a drill" (auto periods, rehab or modified groups) and it's left out.
New names not in the file are tidied automatically and added to it for checking.
"""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from typing import Callable, Optional
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from . import catapult_api
from .config import CATAPULT_API_DIR, CONFIG_DIR, TIMEZONE
from .names import canonical

DRILLS_FILE = CATAPULT_API_DIR / "drills.csv"
NAMES_FILE = CONFIG_DIR / "drill_names.csv"
FIELDS = "ts,cs,v,a,o,pl"
SEASON_FROM = date(2025, 11, 1)
MIN_SHARE = 0.5          # a player counts in a drill if they wore a unit for half of it or more
MIN_RUNS = 5            # drills run fewer times than this are left off the matrix
MIN_DRILL_S = 60         # periods under a minute are mis-clicks, not drills
PRESEASON_TO = date(2026, 2, 28)

# Not drills: OpenField's own periods, and groups rather than drills
NOT_DRILLS = re.compile(r"^(auto created period|period \d+|q\d|rehab.*|modified.*|reconditioning|walk throughs?|full training)$", re.I)
# Running blocks rather than skill drills: shown separately so they don't squash the drill map
RUNNING = re.compile(r"conditioning|shuttle|efforts|\bon\b.*\boff\b|@ ?mas|\basr\b|\b\d+ ?m\b|tempo|sprints?\b", re.I)
# Same drill, different spelling (after tidy(): lower case, "and" for &, straight quotes)
ALIASES = {
    "wu and kick": "Warm Up + Kick", "warm up and kick": "Warm Up + Kick", "warm up": "Warm Up + Kick",
    "burst and go": "Burst & Go", "mastery": "Mastery", "matty's mastery": "Mastery",
    "return serve drill": "Return Serve", "return serve": "Return Serve",
    "contest method drill": "Contest Method", "contest method": "Contest Method",
    "basketball drill": "Basketball", "bball drill": "Basketball",
    "groundball circuit": "Ground Ball Circuit", "ground ball circuit": "Ground Ball Circuit",
    "corridor grid game": "Corridor Grid", "corridor grid": "Corridor Grid",
    "energy rotation": "Energy Rotations", "energy rotations": "Energy Rotations",
    "lines": "Line Training", "line training": "Line Training", "flow": "Flow Drill", "flow drill": "Flow Drill",
    "pch": "Pressure Cooker Hands",
}


def tidy(name: str) -> str:
    n = str(name).replace("’", "'").replace("&", " and ").replace("+", " and ").lower()
    return " ".join(n.split())


def default_drill(raw: str) -> str:
    """Best guess at the drill for a raw OpenField name ('' = not a drill)."""
    t = tidy(raw)
    if NOT_DRILLS.match(t) or NOT_DRILLS.match(raw.strip()):
        return ""
    return ALIASES.get(t, " ".join(raw.split()))


def default_type(drill: str) -> str:
    return "Running" if drill and RUNNING.search(drill) else "Skills"


def names(raw_names) -> pd.DataFrame:
    """The name map (OpenField name → drill, type): saved choices first, new names guessed and saved for checking."""
    saved = (pd.read_csv(NAMES_FILE, dtype=str, keep_default_na=False) if NAMES_FILE.exists()
             else pd.DataFrame(columns=["openfield_name", "drill", "type"]))
    new = sorted(set(raw_names) - set(saved["openfield_name"]))
    if new:
        guess = [default_drill(n) for n in new]
        saved = pd.concat([saved, pd.DataFrame({"openfield_name": new, "drill": guess,
                                                "type": [default_type(g) if g else "" for g in guess]})],
                          ignore_index=True).sort_values(["type", "drill"])
        NAMES_FILE.parent.mkdir(parents=True, exist_ok=True)
        saved.to_csv(NAMES_FILE, index=False)
    return saved


def drill_sessions(tok: str, since: date = SEASON_FROM) -> list:
    """Training activities split into more than one period, oldest first."""
    acts = catapult_api._get(tok, "activities") or []
    out = [a for a in acts if datetime.fromtimestamp(a["start_time"]).date() >= since
           and not catapult_api.is_game(a) and "game" not in a["name"].lower() and (a.get("period_count") or 0) > 1]
    return sorted(out, key=lambda a: a["start_time"])


def _player_rows(frame: pd.DataFrame, periods: list, base: dict) -> list:
    t = frame["ts"] + frame["cs"] / 100
    rows = []
    for p in periods:
        length = p["end_time"] - p["start_time"]
        d = frame[(t >= p["start_time"]) & (t < p["end_time"])]
        if length < MIN_DRILL_S or len(d) * catapult_api.SAMPLE_S < MIN_SHARE * length:
            continue
        pl = d["pl"].diff().where(d["ts"].diff().abs() <= 1).clip(lower=0).sum() if "pl" in d else np.nan
        rows.append({**base, "period": p["name"].strip(), "period_start": p["start_time"], "drill_seconds": round(length),
                     **catapult_api.top_speeds(d["ts"], d["cs"], d["v"]),
                     **catapult_api.load_summary(d["ts"], d["cs"], d["v"], d["a"], d["o"]),
                     "player_load": pl})
    return rows


def pull_session(tok: str, activity: dict) -> list:
    """Per player, per drill rows for one session."""
    start = datetime.fromtimestamp(activity["start_time"], timezone.utc).astimezone(ZoneInfo(TIMEZONE))
    periods = catapult_api._get(tok, f"activities/{activity['id']}/periods") or []
    athletes = catapult_api._get(tok, f"activities/{activity['id']}/athletes") or []

    def one(a):
        data = catapult_api._get(tok, f"activities/{activity['id']}/athletes/{a['id']}/sensor?parameters={FIELDS}")
        samples = (data or [{}])[0].get("data") or []
        if not samples:
            return []
        base = {"activity_id": activity["id"], "activity": catapult_api._label(activity["name"], start.date()),
                "date": start.date().isoformat(), "player": canonical(f"{a['first_name']} {a['last_name']}")}
        return _player_rows(pd.DataFrame(samples), periods, base)

    with ThreadPoolExecutor(max_workers=catapult_api.PARALLEL) as pool:
        return [r for rows in pool.map(one, athletes) for r in rows]


def sync(progress: Optional[Callable] = None) -> int:
    """Pull any drill-split sessions not yet in drills.csv. Returns how many sessions were added."""
    tok = catapult_api.token()
    have = set(pd.read_csv(DRILLS_FILE, usecols=["activity_id"])["activity_id"]) if DRILLS_FILE.exists() else set()
    todo = [a for a in drill_sessions(tok) if a["id"] not in have]
    for i, a in enumerate(todo):
        if progress:
            progress(i, len(todo), a["name"])
        rows = pull_session(tok, a)
        DRILLS_FILE.parent.mkdir(parents=True, exist_ok=True)
        if rows:
            pd.DataFrame(rows).to_csv(DRILLS_FILE, mode="a", header=not DRILLS_FILE.exists(), index=False)
    return len(todo)


def load(maxes: Optional[pd.DataFrame] = None) -> pd.DataFrame:
    """Per player, per drill rows with the drill name merged and per-minute rates added."""
    if not DRILLS_FILE.exists():
        return pd.DataFrame()
    d = pd.read_csv(DRILLS_FILE)
    d["date"] = pd.to_datetime(d["date"]).dt.date
    nm = names(d["period"].unique()).set_index("openfield_name")
    d["drill"] = d["period"].map(nm["drill"]).fillna("")
    d["type"] = d["period"].map(nm["type"]).fillna("Skills").replace("", "Skills")
    d = d[d["drill"] != ""].copy()
    d["phase"] = np.where(d["date"] <= PRESEASON_TO, "Pre-season", "In-season")
    d["minutes"] = d["seconds"] / 60
    d["accel_decel"] = d["accels"] + d["decels"]
    if maxes is not None and len(maxes):
        mx = maxes[~maxes["provisional"]].set_index("player")["max_kmh"]
        d["max_kmh"] = d["player"].map(mx)
        d["z80_m"] = [catapult_api.above(r, 0.8 * x) if pd.notna(x) else np.nan
                      for r, x in zip(d.to_dict("records"), d["max_kmh"])]
        d["pct_max"] = d["top_500ms_kmh"] / d["max_kmh"]
    for c in ("distance_m", "hsr_m", "sprint_m", "accel_decel", "z80_m", "player_load"):
        if c in d:
            d[f"{c}_per_min"] = d[c] / d["minutes"]
    return d


# What the matrix shows: column → (label, unit)
RATES = {"distance_m_per_min": ("m/min", "m/min"), "hsr_m_per_min": ("HSR m/min", "m/min"),
         "sprint_m_per_min": ("Sprint m/min", "m/min"), "z80_m_per_min": (">80% max m/min", "m/min"),
         "accel_decel_per_min": ("Accels + decels a min", "/min"), "player_load_per_min": ("Load a min", "/min")}
TOTALS = {"minutes": ("Length", "min"), "distance_m": ("Distance", "m"), "hsr_m": ("HSR", "m"),
          "sprint_m": ("Sprint", "m"), "z80_m": (">80% max", "m"), "accel_decel": ("Accels + decels", ""),
          "player_load": ("Player Load", "")}


def matrix(d: pd.DataFrame) -> pd.DataFrame:
    """One row per drill: times run, players, and the median player's numbers per run (rates and totals).

    Each run is first summarised by its median player, then runs are averaged, so a drill
    run once with 40 players doesn't outweigh one run ten times with 20.
    """
    cols = [c for c in {**RATES, **TOTALS} if c in d] + (["pct_max"] if "pct_max" in d else [])
    if "type" not in d:
        d = d.assign(type="Skills")
    runs = d.groupby(["drill", "activity_id"]).agg(**{c: (c, "median") for c in cols}, type=("type", "first"),
                                                     players=("player", "nunique"), date=("date", "first"))
    out = runs.groupby("drill").agg(**{c: (c, "mean") for c in cols}, type=("type", "first"), players=("players", "mean"),
                                    runs=("date", "size"), first=("date", "min"), last=("date", "max"))
    return out.reset_index().sort_values("distance_m_per_min", ascending=False)


def runs(d: pd.DataFrame, drill: str) -> pd.DataFrame:
    """Every time one drill was run: date, session and the median player's numbers."""
    x = d[d["drill"] == drill]
    cols = [c for c in {**RATES, **TOTALS} if c in x] + (["pct_max"] if "pct_max" in x else [])
    return (x.groupby(["date", "activity", "activity_id"]).agg(**{c: (c, "median") for c in cols},
                                                                players=("player", "nunique"))
            .reset_index().sort_values("date"))


if __name__ == "__main__":
    n = sync(lambda i, total, name: print(f"{i + 1}/{total} {name}", flush=True))
    print(f"Done: {n} sessions added to {DRILLS_FILE}")


def game_reference(game_rows: pd.DataFrame, speed: pd.DataFrame) -> dict:
    """Squad game demands per minute: average game (OpenField on-field time) and peak windows (10Hz).

    {rate column: (average game, peak 5 min, peak 1 min)}; peaks only where Catapult has them.
    """
    g = game_rows[game_rows["minutes"] > 0]
    avg = {"distance_m_per_min": g["m_per_min"].mean(),
           "hsr_m_per_min": (g["hsr_m"] / g["minutes"]).mean(),
           "sprint_m_per_min": (g["sprint_m"] / g["minutes"]).mean(),
           "accel_decel_per_min": (g["accel_decel"] / g["minutes"]).mean()}
    games = speed[speed["game"] == True] if "game" in speed else speed.iloc[0:0]
    peak = {"distance_m_per_min": ("peak_mpm_300s", "peak_mpm_60s"), "hsr_m_per_min": ("peak_hsr_300s", "peak_hsr_60s")}
    out = {}
    for k, a in avg.items():
        p5, p1 = peak.get(k, (None, None))
        out[k] = (a, games[p5].median() if p5 and len(games) else np.nan, games[p1].median() if p1 and len(games) else np.nan)
    return out


# Physical demand categories, set against the average game so they don't shift when filters change.
# Tuesday and Saturday are the big days (volume and high-speed running); Thursday is less volume
# and high-speed running, more accel/decel loading.
SPEED_SHARE = 0.45    # HSR m/min at 45%+ of the average game = a high-speed drill
ACCEL_SHARE = 0.75    # accels + decels a minute at 75%+ of the average game = an accel/decel drill
CATEGORIES = {        # name: (colour, training day it fits)
    "High speed": ("#d71920", "Tue / Sat"),
    "High speed + accel/decel": ("#ff8a80", "Tue / Sat"),
    "Accel/decel": ("#f2b33d", "Thu"),
    "Low load": ("#8a8a90", "Any day"),
}


def categorise(mtx: pd.DataFrame, game: dict) -> pd.DataFrame:
    """Adds category and the training day it fits. game: average game rates {rate column: value}."""
    out = mtx.copy()
    speed = out["hsr_m_per_min"] >= SPEED_SHARE * game["hsr_m_per_min"]
    accel = out["accel_decel_per_min"] >= ACCEL_SHARE * game["accel_decel_per_min"]
    out["category"] = np.select([speed & accel, speed, accel],
                                ["High speed + accel/decel", "High speed", "Accel/decel"], default="Low load")
    out["fits"] = out["category"].map(lambda c: CATEGORIES[c][1])
    return out
