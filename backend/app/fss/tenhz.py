"""Full 10Hz traces for one activity, pulled from the Catapult API and cached locally.

Frankston Reports port: cached as gzipped pickles (no pyarrow needed), and the
activity's periods are saved next to the trace so a report can be rebuilt offline.

Used for game reports (zones relative to each player's max, peak windows). One
parquet file per activity in data/catapult_api/10hz/, so a game is only
downloaded once.
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Callable, Optional
from zoneinfo import ZoneInfo

import pandas as pd

from . import catapult_api
from .config import CATAPULT_API_DIR, TIMEZONE
from .names import canonical

TENHZ_DIR = CATAPULT_API_DIR / "10hz"
FIELDS = "ts,cs,v,a,o,pl,hr,lat,long"  # x/y can't be requested on their own


def _path(activity_id: str):
    return TENHZ_DIR / f"{activity_id}.pkl.gz"


def _meta_path(activity_id: str):
    return TENHZ_DIR / f"{activity_id}.json"


def activity(activity_id: str) -> dict:
    """The activity's details plus its periods (quarters)."""
    meta = _meta_path(activity_id)
    if meta.exists():
        return json.loads(meta.read_text())
    tok = catapult_api.token()
    acts = catapult_api._get(tok, "activities") or []
    act = next(a for a in acts if a["id"] == activity_id)
    act["period_list"] = catapult_api._get(tok, f"activities/{activity_id}/periods") or []
    TENHZ_DIR.mkdir(parents=True, exist_ok=True)
    meta.write_text(json.dumps(act))
    return act


def load(activity_id: str, progress: Optional[Callable] = None) -> pd.DataFrame:
    """Every player's 10Hz trace: player, t (unix seconds), v (m/s), a, o (odometer m), pl, hr, lat, long."""
    path = _path(activity_id)
    if path.exists():
        return pd.read_pickle(path)
    tok = catapult_api.token()
    athletes = catapult_api._get(tok, f"activities/{activity_id}/athletes") or []
    frames = []
    for i, a in enumerate(athletes):
        if progress:
            progress(i, len(athletes))
        data = catapult_api._get(tok, f"activities/{activity_id}/athletes/{a['id']}/sensor?parameters={FIELDS}")
        samples = (data or [{}])[0].get("data") or []
        if not samples:
            continue
        df = pd.DataFrame(samples)
        df["t"] = df["ts"] + df["cs"] / 100
        df["player"] = canonical(f"{a['first_name']} {a['last_name']}")
        frames.append(df.drop(columns=["ts", "cs"]))
    out = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    TENHZ_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    out.to_pickle(tmp, compression="gzip")
    tmp.rename(path)                      # only a complete download counts as cached
    return out


def is_cached(activity_id: str) -> bool:
    return _path(activity_id).exists() and _meta_path(activity_id).exists()


def games(since_year: int = 2026) -> list:
    """Game activities in Catapult (tagged MD, or named like a round/final), newest first."""
    acts = catapult_api._get(catapult_api.token(), "activities") or []
    out = []
    for a in acts:
        tags = {t.get("name") if isinstance(t, dict) else t for t in a.get("tags") or []}
        named = re.search(r"\b(rd|round|wildcard|final)\b|\bvs\b", a["name"], flags=re.I)
        start = datetime.fromtimestamp(a["start_time"], ZoneInfo(TIMEZONE))
        if start.year >= since_year and ("MD" in tags or named) and a["name"].strip().lower() != "not playing":
            out.append({"id": a["id"], "name": a["name"].strip(), "date": start.date(), "start": start})
    return sorted(out, key=lambda g: g["start"], reverse=True)
