"""Game Report — ported from the Frankston Sport Science app (fss/game_report.py, page "Game Report").

Full 10Hz traces for one game (downloaded once, cached in sport_science_data/catapult_api/10hz/),
split into quarters with on-field time estimated, then:
- per player: distance, m/min, HSR, sprint, top speed, accels/decels, Player Load,
  zones relative to their own max (>80% / >90%) and peak 30 s – 5 min windows;
- per quarter team totals; and the single best window of the game per metric.
"""
from __future__ import annotations

import threading
from datetime import date

import numpy as np
import pandas as pd

from . import this_week
from .fss import catapult_api, game_report, tenhz
from .fss.config import HSR_KMH, SPRINT_KMH

_JOBS: dict = {}          # activity_id -> {"running", "message", "error"}
_CACHE: dict = {}         # (activity_id, maxes key) -> built report
_LOCK = threading.Lock()


def games(token: str, region: str) -> list:
    catapult_api.use_token(token, this_week.REGION_CODES.get(region, "au"))
    out = tenhz.games()
    return this_week._clean([{**g, "cached": tenhz.is_cached(g["id"]), "start": g["start"].isoformat()} for g in out])


def start_download(token: str, region: str, activity_id: str) -> dict:
    with _LOCK:
        job = _JOBS.get(activity_id)
        if tenhz.is_cached(activity_id) or (job and job["running"]):
            return status(activity_id)
        catapult_api.use_token(token, this_week.REGION_CODES.get(region, "au"))
        _JOBS[activity_id] = {"running": True, "message": "Starting…", "error": None}

    def run():
        job = _JOBS[activity_id]
        try:
            tenhz.activity(activity_id)            # saves the quarters next to the trace
            tenhz.load(activity_id, progress=lambda i, n: job.__setitem__("message", f"player {i + 1} of {n}"))
        except Exception as e:  # noqa: BLE001
            job["error"] = str(e)
        job["running"] = False

    threading.Thread(target=run, daemon=True).start()
    return status(activity_id)


def status(activity_id: str) -> dict:
    job = _JOBS.get(activity_id) or {}
    return {"cached": tenhz.is_cached(activity_id), "running": bool(job.get("running")),
            "message": job.get("message", ""), "error": job.get("error")}


def _maxes() -> dict:
    """Tested maxes (not provisional), same as Speed Exposure uses."""
    try:
        _, _, maxes, _, _ = this_week._load()
    except Exception:  # noqa: BLE001 - no pulled data yet
        return {}
    usable = maxes[~maxes["provisional"]].dropna(subset=["max_kmh"])
    return dict(zip(usable["player"], usable["max_kmh"].astype(float)))


def build(activity_id: str) -> dict:
    if not tenhz.is_cached(activity_id):
        return {"cached": False}
    mx = _maxes()
    key = (activity_id, tuple(sorted(mx.items())))
    if key in _CACHE:
        return _CACHE[key]

    act = tenhz.activity(activity_id)
    periods = sorted(act["period_list"], key=lambda p: p["start_time"])
    d = game_report.label_quarters(tenhz.load(activity_id), periods)
    p = game_report.player_rows(d, mx)
    q = game_report.quarter_rows(d, mx)
    peaks = game_report.game_peaks(d, mx)
    starts = {n: per["start_time"] for n, per in enumerate(periods, start=1)}

    def clock(r):
        if not r["player"] or pd.isna(r["quarter"]):
            return None
        secs = int(r["start_t"] - starts[int(r["quarter"])])
        return f"Q{int(r['quarter'])} {secs // 60}:{secs % 60:02d}"

    peaks["when"] = peaks.apply(clock, axis=1)
    has_max = p["player_max_kmh"].notna()
    out = this_week._clean({
        "cached": True,
        "id": activity_id,
        "name": (act.get("name") or "").strip(),
        "date": pd.Timestamp(act["start_time"], unit="s", tz="UTC").tz_convert("Australia/Melbourne").date(),
        "players": p.replace({np.nan: None}).to_dict(orient="records"),
        "quarters": [{"quarter": int(i), **{k: v for k, v in r.items()}} for i, r in q.iterrows()],
        "peaks": peaks[["window", "metric", "key", "value", "player", "quarter", "when"]].replace({np.nan: None}).to_dict(orient="records"),
        "team": {
            "distance_m": p["distance_m"].sum(), "hsr_m": p["hsr_m"].sum(), "sprint_m": p["sprint_m"].sum(),
            "z80_m": p["z80_m"].sum(), "z90_m": p["z90_m"].sum(),
            "z80_players": int((p["z80_m"] > 0).sum()), "z90_players": int((p["z90_m"] > 0).sum()),
            "reached_90": int((p["efforts_90"] > 0).sum()), "with_max": int(has_max.sum()),
        },
        "no_max": p.loc[~has_max, "player"].tolist(),
        "peak_windows": list(game_report.PEAK_WINDOWS),
        "peak_metrics": game_report.PEAK_METRICS,
        "rules": {"hsr_kmh": HSR_KMH, "sprint_kmh": SPRINT_KMH, "band_min_s": game_report.BAND_MIN_S,
                  "effort_min_s": game_report.EFFORT_MIN_S},
    })
    _CACHE.clear()               # keep one built report in memory
    _CACHE[key] = out
    return out
