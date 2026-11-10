"""Drill Matrix — ported from the Frankston Sport Science app (fss/drills.py, page "Drill Matrix").

Different from the Drill Report tabs: those show one session (or week) at a time from
Catapult's /stats period numbers. The Drill Matrix is a season-long library of drills:
each drill (OpenField names merged) is summarised per minute by its median player across
every time it was run, compared with game demands, and sorted into a physical-demand
category and the training day it suits. Built from 10Hz per drill period, using the same
definitions as the game report (HSR > 19.8 km/h, sprint > 25.2 km/h, accels ±3 m/s²).
"""
from __future__ import annotations

import threading

import numpy as np
import pandas as pd

from . import game_summaries, this_week
from .fss import catapult_api, drills

_JOB = {"running": False, "message": "", "error": None, "done": 0, "total": 0}


def status() -> dict:
    n = int(pd.read_csv(drills.DRILLS_FILE, usecols=["activity_id"])["activity_id"].nunique()) \
        if drills.DRILLS_FILE.exists() else 0
    return {**_JOB, "sessions": n}


def start(token: str, region: str) -> dict:
    if _JOB["running"]:
        return status()
    catapult_api.use_token(token, this_week.REGION_CODES.get(region, "au"))
    _JOB.update(running=True, message="Finding sessions split into drills…", error=None, done=0, total=0)

    def run():
        try:
            def prog(i, total, name):
                _JOB.update(done=i, total=total, message=f"{name} ({i + 1} of {total})")
            drills.sync(prog)
        except Exception as e:  # noqa: BLE001
            _JOB["error"] = str(e)
        _JOB.update(running=False, message="")

    threading.Thread(target=run, daemon=True).start()
    return status()


def _game_reference() -> dict | None:
    """Average game per on-field minute (from games worked out on Player Profile) + 10Hz peak windows."""
    g = game_summaries.load_players()
    if g.empty:
        return None
    g = g.rename(columns={"m_per_min": "m_per_min"})
    g["accel_decel"] = g["accels"] + g["decels"]
    return drills.game_reference(g, catapult_api.load_speed())


def build(phase: str = "All", kind: str = "Skills") -> dict:
    out = {"status": status(), "names": [], "empty": True}
    if drills.DRILLS_FILE.exists():
        out["names"] = pd.read_csv(drills.NAMES_FILE, dtype=str, keep_default_na=False).to_dict(orient="records") \
            if drills.NAMES_FILE.exists() else []
    maxes = None
    if not catapult_api.load_speed().empty:
        _, _, maxes, _, _ = this_week._load()
    d_all = drills.load(maxes)
    if d_all.empty:
        return this_week._clean(out)
    if drills.NAMES_FILE.exists():
        out["names"] = pd.read_csv(drills.NAMES_FILE, dtype=str, keep_default_na=False).to_dict(orient="records")
    d = d_all if phase == "All" else d_all[d_all["phase"] == phase]
    d = d if kind == "All" else d[d["type"] == kind]
    out["empty"] = False
    out["min_runs"] = drills.MIN_RUNS
    if d.empty:
        out["matrix"] = []
        return this_week._clean(out)
    mtx = drills.matrix(d)
    mtx = mtx[mtx["runs"] >= drills.MIN_RUNS]
    d = d[d["drill"].isin(mtx["drill"])]
    ref = _game_reference()
    out["reference"] = None
    if ref:
        g_avg = {k: v[0] for k, v in ref.items()}
        mtx = drills.categorise(mtx, g_avg)
        order = list(drills.CATEGORIES)
        mtx = mtx.assign(_o=mtx["category"].map(order.index)).sort_values(["_o", "distance_m_per_min"],
                                                                         ascending=[True, False]).drop(columns="_o")
        out["reference"] = {"avg": g_avg, "peak5": {k: v[1] for k, v in ref.items()}}
        out["cutoffs"] = {"hsr_m_per_min": drills.SPEED_SHARE * g_avg["hsr_m_per_min"],
                          "accel_decel_per_min": drills.ACCEL_SHARE * g_avg["accel_decel_per_min"]}
    else:
        mtx = mtx.assign(category="Low load", fits="")
    out["categories"] = {k: {"colour": c, "fits": f} for k, (c, f) in drills.CATEGORIES.items()}
    out["shares"] = {"speed": drills.SPEED_SHARE, "accel": drills.ACCEL_SHARE}
    out["sessions"] = int(d["activity_id"].nunique())
    out["matrix"] = mtx.replace({np.nan: None}).to_dict(orient="records")
    out["runs"] = {name: drills.runs(d, name).replace({np.nan: None}).to_dict(orient="records")
                   for name in mtx["drill"]}
    out["totals"] = {c: {"label": l, "unit": u} for c, (l, u) in drills.TOTALS.items()}
    out["rates"] = {c: {"label": l, "unit": u} for c, (l, u) in drills.RATES.items()}
    return this_week._clean(out)


def save_names(rows: list) -> dict:
    df = pd.DataFrame(rows, columns=["openfield_name", "drill", "type"]).fillna("")
    drills.NAMES_FILE.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(drills.NAMES_FILE, index=False)
    return {"saved": len(df)}
