"""
Thin synchronous wrapper around the two Catapult Connect v6 endpoints this
app needs. Mirrors the original R script's two calls:

  1. GET  /activities                 -> activity list (id, name, start_time, tags)
  2. POST /stats  (cached_stats)       -> athlete/period/position/team grid

Both functions return a plain pandas DataFrame so the rest of the backend
never has to think about raw JSON shapes.
"""
from datetime import datetime, timedelta
from typing import Any, Dict, List

import httpx
import pandas as pd

from .config import REGION_CONFIG, STAT_GROUP_BY, STAT_PARAMETERS, STATS_COLUMN_CANDIDATES

TIMEOUT = httpx.Timeout(30.0, read=120.0)


def _clean_token(token: str) -> str:
    token = (token or "").strip()
    if token.lower().startswith("bearer "):
        token = token.split(" ", 1)[1].strip()
    return token


def _headers(token: str) -> Dict[str, str]:
    return {
        "accept": "application/json",
        "content-type": "application/json",
        "authorization": f"Bearer {_clean_token(token)}",
    }


def _base_url(region: str) -> str:
    if region not in REGION_CONFIG:
        raise ValueError(f"Unknown region: {region}")
    return REGION_CONFIG[region]


def _get(client: httpx.Client, url: str, headers: Dict[str, str], params=None) -> Any:
    r = client.get(url, headers=headers, params=params)
    r.raise_for_status()
    return r.json()


def _post(client: httpx.Client, url: str, headers: Dict[str, str], payload: dict) -> Any:
    r = client.post(url, headers=headers, json=payload)
    r.raise_for_status()
    return r.json()


def normalize_columns(df: pd.DataFrame, candidates: Dict[str, List[str]]) -> pd.DataFrame:
    """Renames the first matching candidate column to its canonical name.
    See config.py for why this exists."""
    if df.empty:
        return df
    rename = {}
    for canonical, options in candidates.items():
        if canonical in df.columns:
            continue
        for opt in options:
            if opt in df.columns:
                rename[opt] = canonical
                break
    return df.rename(columns=rename)


# ---------------------------------------------------------------- activities

ACTIVITY_CHUNK_S = 31 * 86400


def get_activities(token: str, region: str, start_unix: int, end_unix: int) -> pd.DataFrame:
    """Activities in the range, asked for a month at a time (a long range in one request can
    come back short), de-duplicated by id."""
    base = _base_url(region)
    hdrs = _headers(token)
    data = []
    with httpx.Client(timeout=TIMEOUT) as client:
        cur = start_unix
        while cur <= end_unix:
            stop = min(cur + ACTIVITY_CHUNK_S - 1, end_unix)
            part = _get(client, f"{base}/activities", hdrs, params={"start_time": cur, "end_time": stop})
            if isinstance(part, dict):
                part = part.get("data") or []
            data += part or []
            cur = stop + 1
    df = pd.DataFrame(data)
    if df.empty:
        return df
    if "id" in df.columns:
        df = df.drop_duplicates("id").reset_index(drop=True)

    # Make sure "tags" is always a clean list-of-strings column, whatever
    # shape Catapult sent it in (missing / null / a single string / a list).
    if "tags" not in df.columns:
        df["tags"] = [[] for _ in range(len(df))]
    else:
        def _as_list(t):
            if isinstance(t, list):
                return [str(x).strip() for x in t if str(x).strip()]
            if t is None or (isinstance(t, float) and pd.isna(t)):
                return []
            return [str(t).strip()] if str(t).strip() else []

        df["tags"] = df["tags"].apply(_as_list)

    return df


# ---------------------------------------------------------------- stats

def _fetch_stats_window(token: str, region: str, start_date_ddmmyyyy: str, end_date_ddmmyyyy: str, parameters: List[str] = None) -> pd.DataFrame:
    """athlete / activity / period / position / team grid across the whole
    date range in one call (matches the original script's single /stats
    request rather than one call per activity)."""
    base = _base_url(region)
    hdrs = _headers(token)
    payload = {
        "filters": [
            {"name": "date", "comparison": ">=", "values": [start_date_ddmmyyyy]},
            {"name": "date", "comparison": "<=", "values": [end_date_ddmmyyyy]},
        ],
        "group_by": STAT_GROUP_BY,
        "parameters": parameters or STAT_PARAMETERS,
        "source": "cached_stats",
    }
    with httpx.Client(timeout=TIMEOUT) as client:
        data = _post(client, f"{base}/stats", hdrs, payload)
    return pd.DataFrame(data)


STATS_CHUNK_DAYS = 31


def fetch_stats(token: str, region: str, start_date_ddmmyyyy: str, end_date_ddmmyyyy: str, extra_parameters: List[str] = None) -> pd.DataFrame:
    """Same as one /stats call over the range, but long ranges (e.g. a whole
    season for longitudinal reporting) are split into ~monthly windows so no
    single request gets big enough to time out. Windows don't overlap, so no
    activity is counted twice."""
    fmt = "%d/%m/%Y"
    params = list(STAT_PARAMETERS) + [p for p in (extra_parameters or []) if p not in STAT_PARAMETERS]
    start = datetime.strptime(start_date_ddmmyyyy, fmt).date()
    end = datetime.strptime(end_date_ddmmyyyy, fmt).date()
    frames = []
    cur = start
    while cur <= end:
        win_end = min(cur + timedelta(days=STATS_CHUNK_DAYS - 1), end)
        df = _fetch_stats_window(token, region, cur.strftime(fmt), win_end.strftime(fmt), params)
        if not df.empty:
            frames.append(df)
        cur = win_end + timedelta(days=1)
    if not frames:
        return pd.DataFrame()
    df = pd.concat(frames, ignore_index=True)
    return normalize_columns(df, STATS_COLUMN_CANDIDATES)


# ---------------------------------------------------------------- parameters

def get_parameters(token: str, region: str) -> List[Dict[str, Any]]:
    """GET /parameters — every parameter (incl. custom ones) on the account."""
    base = _base_url(region)
    hdrs = _headers(token)
    with httpx.Client(timeout=TIMEOUT) as client:
        data = _get(client, f"{base}/parameters", hdrs)
    if isinstance(data, dict):
        data = data.get("data") or data.get("parameters") or []
    return [d for d in data if isinstance(d, dict)]


def find_explosive_parameters(params: List[Dict[str, Any]]) -> Dict[str, str]:
    """Map canonical names -> this account's slugs for the Explosive Efforts /
    Explosive Distance parameters used by the Athlete Drill tab (ported from the
    Michigan Power BI report). Slugs differ between accounts (Michigan's is
    literally `explsoive_distance`), so match loosely on slug or display name.
    Returns {} if the account doesn't have them."""
    exact = {"explosive_efforts": "explosive_efforts", "explosive_distance": "explosive_distance"}
    out: Dict[str, str] = {}
    slugs = {str(p.get("slug") or "").strip() for p in params}
    for canon, slug in exact.items():
        if slug in slugs:
            out[canon] = slug
    for p in params:
        slug = str(p.get("slug") or "").strip()
        text = f"{slug} {p.get('name') or ''}".lower()
        if not slug or not ("explos" in text or "explsoive" in text):
            continue
        if any(w in text for w in ("ratio", "minute", "per_min", "/min", "high", "%")):
            continue
        if "effort" in text and "explosive_efforts" not in out:
            out["explosive_efforts"] = slug
        elif "distance" in text and "explosive_distance" not in out:
            out["explosive_distance"] = slug
    return out
