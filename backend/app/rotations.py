"""Rotations from OpenField annotations, for the Game Report.

OpenField annotations (e.g. rotations / interchanges entered live or after the game)
aren't in Catapult's published API docs, so this tries the likely endpoints for a game
and keeps whatever answers. Each record that has a start/end time (and athletes) becomes
a stint on a per-player, per-quarter timeline. What each endpoint returned is kept so the
shape can be checked if nothing usable comes back.
"""
from __future__ import annotations

import gzip
import json
import urllib.error
import urllib.request

from . import this_week
from .fss import catapult_api, tenhz

TIME_START = ("start_time", "start", "from", "start_timestamp", "begin_time")
TIME_END = ("end_time", "end", "to", "end_timestamp", "finish_time")
NAME_KEYS = ("name", "annotation_name", "label", "title", "description", "tag", "category", "category_name")


def _call(tok: str, region: str, endpoint: str):
    url = f"https://connect-{region}.catapultsports.com/api/v6/{endpoint}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {tok}", "Accept": "application/json",
                                               "Accept-Encoding": "gzip"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                body = gzip.decompress(body)
            return r.status, json.loads(body or b"null")
    except urllib.error.HTTPError as e:
        try:
            detail = e.read()[:300].decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            detail = ""
        return e.code, detail
    except Exception as e:  # noqa: BLE001
        return None, str(e)


def _records(payload):
    """Flatten whatever came back into a list of dicts."""
    if isinstance(payload, list):
        out = []
        for x in payload:
            if isinstance(x, dict) and isinstance(x.get("data"), list) and not any(k in x for k in TIME_START):
                out += [{**d, "_athlete": x.get("athlete_id") or x.get("id"),
                         "_athlete_name": f"{x.get('first_name', '')} {x.get('last_name', '')}".strip()}
                        for d in x["data"] if isinstance(d, dict)]
            elif isinstance(x, dict):
                out.append(x)
        return out
    if isinstance(payload, dict):
        for k in ("data", "annotations", "items", "results"):
            if isinstance(payload.get(k), list):
                return _records(payload[k])
    return []


def _first(d: dict, keys):
    for k in keys:
        if d.get(k) not in (None, ""):
            return d[k]
    return None


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def load(token: str, region: str, activity_id: str) -> dict:
    reg = this_week.REGION_CODES.get(region, "au")
    catapult_api.use_token(token, reg)
    tok = catapult_api.token()
    tried, records = [], []

    candidates = [f"activities/{activity_id}/annotations", f"annotations?activity_id={activity_id}",
                  f"activities/{activity_id}/annotations?include_athletes=true"]
    for ep in candidates:
        status, payload = _call(tok, reg, ep)
        recs = _records(payload) if status == 200 else []
        tried.append({"endpoint": ep, "status": status, "count": len(recs),
                      "sample": recs[:2] if recs else (payload if isinstance(payload, str) else None)})
        if recs:
            records = recs
            break

    names = {}
    if not records:   # per-athlete annotations
        status, athletes = _call(tok, reg, f"activities/{activity_id}/athletes")
        athletes = athletes if status == 200 and isinstance(athletes, list) else []
        names = {a.get("id"): f"{a.get('first_name', '')} {a.get('last_name', '')}".strip() for a in athletes}
        for a in athletes[:40]:
            ep = f"activities/{activity_id}/athletes/{a['id']}/annotations"
            status, payload = _call(tok, reg, ep)
            recs = _records(payload) if status == 200 else []
            if a is athletes[0] or recs:
                tried.append({"endpoint": ep.replace(a["id"], "{athlete}"), "status": status, "count": len(recs),
                              "sample": recs[:2] if recs else (payload if isinstance(payload, str) else None)})
            if status in (404, 405) and a is athletes[0]:
                break                      # endpoint doesn't exist: don't call it 40 times
            records += [{**r, "_athlete": a["id"], "_athlete_name": names[a["id"]]} for r in recs]

    # periods (quarters) so stints can be placed in each quarter
    periods = []
    try:
        periods = sorted(tenhz.activity(activity_id)["period_list"], key=lambda p: p["start_time"])
    except Exception:  # noqa: BLE001
        pass

    stints = []
    for r in records:
        start, end = _num(_first(r, TIME_START)), _num(_first(r, TIME_END))
        if start is None:
            continue
        if start > 1e11:                     # milliseconds
            start, end = start / 1000, (end / 1000 if end else None)
        end = end if end and end >= start else start
        athletes = []
        if r.get("_athlete_name"):
            athletes = [r["_athlete_name"]]
        else:
            for k in ("athletes", "athlete_ids", "athlete_list"):
                v = r.get(k)
                if isinstance(v, list):
                    for a in v:
                        if isinstance(a, dict):
                            athletes.append(f"{a.get('first_name', '')} {a.get('last_name', '')}".strip()
                                            or names.get(a.get("id"), a.get("id")))
                        else:
                            athletes.append(names.get(a, str(a)))
            if r.get("athlete_id"):
                athletes.append(names.get(r["athlete_id"], str(r["athlete_id"])))
        name = _first(r, NAME_KEYS)
        if isinstance(name, dict):
            name = name.get("name")
        quarter = next((n for n, p in enumerate(periods, start=1) if p["start_time"] <= start < p["end_time"]), None)
        for a in athletes or ["(whole team)"]:
            stints.append({"player": a, "name": str(name or "Annotation"), "start": start, "end": end, "quarter": quarter})

    return this_week._clean({
        "found": bool(stints), "tried": tried, "stints": stints,
        "periods": [{"quarter": n, "start": p["start_time"], "end": p["end_time"]} for n, p in enumerate(periods, start=1)],
        "raw_count": len(records),
    })
