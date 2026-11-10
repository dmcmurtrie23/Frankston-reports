"""
FastAPI backend for the Catapult Activity / Athlete Reporting dashboard.

Routes:
    GET  /api/health
    GET  /api/regions
    GET  /api/app-config           -> raw text of ../app-config.txt (repo root)
    POST /api/fetch-data           -> activities + joined athlete/period stats
    GET  /api/debug/last-fetch     -> raw column names from the last fetch,
                                       for fixing config.py's column mapping

There is one main call from the frontend: "Fetch Data" hits /api/fetch-data
once with a token + date range, gets back every activity in range plus the
full athlete/period/position/team stats grid (already joined with each
row's activity name/date/tags), and everything else — the Date/Activity
pickers, the Reporting tables, and the Averages tab's tag/activity/period
filters — is just filtering and aggregating that one payload in the browser.
"""
import datetime
import logging
from pathlib import Path

import httpx
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse

from . import catapult_client
from .config import OPTIONAL_STAT_PARAMETERS, REGION_CONFIG
from .schemas import DebugColumnsResponse, FetchDataRequest, FetchDataResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("catapult_reporting")

# backend/app/main.py -> backend/app -> backend -> repo root
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
APP_CONFIG_PATH = REPO_ROOT / "app-config.txt"

app = FastAPI(title="Catapult Reporting API")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Holds the raw (pre-join) DataFrames from the most recent /api/fetch-data
# call, purely so /api/debug/last-fetch can show you real column names.
# Fine for a single local user; not meant for multi-user deployment.
_LAST_FETCH: dict = {"activities": pd.DataFrame(), "stats": pd.DataFrame()}


@app.exception_handler(Exception)
async def catch_all_exception_handler(request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": f"Unexpected server error: {exc}"})


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/regions")
def regions():
    return {"regions": list(REGION_CONFIG.keys())}


@app.get("/api/app-config", response_class=PlainTextResponse)
def get_app_config():
    """Serves the raw text of app-config.txt, which lives at the repo root
    (next to README.md) rather than inside frontend/, so it's the first
    thing you see when you open the project folder. Read fresh from disk
    on every call — no caching — so editing it and refreshing the browser
    tab picks up changes immediately."""
    try:
        return APP_CONFIG_PATH.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""


def _handle_api_error(e: Exception):
    if isinstance(e, httpx.HTTPStatusError):
        raise HTTPException(e.response.status_code, f"Catapult API error: {e.response.text[:300]}")
    if isinstance(e, httpx.RequestError):
        raise HTTPException(502, f"Could not reach Catapult API: {e}")
    raise HTTPException(500, str(e))


def _day_bounds_utc(start_date: str, end_date: str):
    """YYYY-MM-DD -> (start_unix, end_unix) covering the full UTC day range."""
    d_from = datetime.date.fromisoformat(start_date)
    d_to = datetime.date.fromisoformat(end_date)
    start_dt = datetime.datetime.combine(d_from, datetime.time.min, tzinfo=datetime.timezone.utc)
    end_dt = datetime.datetime.combine(d_to, datetime.time.max, tzinfo=datetime.timezone.utc)
    return int(start_dt.timestamp()), int(end_dt.timestamp())


def _ddmmyyyy(iso_date: str) -> str:
    """YYYY-MM-DD -> DD/MM/YYYY, matching the original script's /stats date filter format."""
    d = datetime.date.fromisoformat(iso_date)
    return d.strftime("%d/%m/%Y")


def _sanitize_records(df: pd.DataFrame):
    df = df.replace([float("inf"), float("-inf")], None)
    df = df.where(pd.notnull(df), None)
    return df.to_dict(orient="records")


# The last successful fetch (token, region, dates and the full result) is kept on
# disk so closing the laptop or restarting the app does not lose the data: the
# page reloads it on open. Lives beside the other sport-science data, outside
# backend/ so writing it never triggers a uvicorn reload.
LAST_FETCH_FILE = REPO_ROOT / "sport_science_data" / "cache" / "last_fetch.json.gz"


@app.post("/api/fetch-data", response_model=FetchDataResponse)
def fetch_data(req: FetchDataRequest):
    resp = _fetch_data(req)
    if resp.activities:
        try:
            import gzip, json
            from fastapi.encoders import jsonable_encoder
            LAST_FETCH_FILE.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                "saved_at": datetime.datetime.now().isoformat(timespec="seconds"),
                "token": req.token, "region": req.region,
                "start_date": req.start_date, "end_date": req.end_date,
                "data": jsonable_encoder(resp),
            }
            tmp = LAST_FETCH_FILE.with_suffix(".tmp")
            with gzip.open(tmp, "wt", encoding="utf-8") as f:
                json.dump(payload, f)
            tmp.replace(LAST_FETCH_FILE)
        except Exception as e:  # noqa: BLE001
            logger.warning("Could not save last fetch: %s", e)
    return resp


@app.get("/api/last-fetch")
def last_fetch():
    """The saved last fetch, or {} if there is none."""
    if not LAST_FETCH_FILE.exists():
        return {}
    import gzip, json
    try:
        with gzip.open(LAST_FETCH_FILE, "rt", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:  # noqa: BLE001
        logger.warning("Could not read last fetch: %s", e)
        return {}


def _fetch_data(req: FetchDataRequest) -> FetchDataResponse:
    if not req.token:
        raise HTTPException(400, "Token is required.")
    if req.end_date < req.start_date:
        raise HTTPException(400, "End date must be on or after start date.")

    start_unix, end_unix = _day_bounds_utc(req.start_date, req.end_date)

    try:
        activities_df = catapult_client.get_activities(req.token, req.region, start_unix, end_unix)
    except Exception as e:
        _handle_api_error(e)

    # Optional extra parameters (Athlete Drill tab): only requested if this
    # account actually has them, so a missing custom parameter never breaks
    # the main fetch.
    explosive_map = {}
    optional_params = []
    try:
        account_params = catapult_client.get_parameters(req.token, req.region)
        explosive_map = catapult_client.find_explosive_parameters(account_params)
        account_slugs = {str(p.get("slug") or "") for p in account_params}
        optional_params = [p for p in OPTIONAL_STAT_PARAMETERS if p in account_slugs]
    except Exception as e:  # noqa: BLE001
        logging.getLogger(__name__).warning("Could not read /parameters: %s", e)
    _LAST_FETCH["explosive_parameters"] = explosive_map
    _LAST_FETCH["optional_parameters"] = optional_params

    try:
        stats_df = catapult_client.fetch_stats(
            req.token, req.region, _ddmmyyyy(req.start_date), _ddmmyyyy(req.end_date),
            extra_parameters=list(explosive_map.values()) + optional_params,
        )
    except Exception as e:
        _handle_api_error(e)
    stats_df = stats_df.rename(
        columns={slug: canon for canon, slug in explosive_map.items() if slug != canon and slug in stats_df.columns}
    )

    _LAST_FETCH["activities"] = activities_df
    _LAST_FETCH["stats"] = stats_df

    if activities_df.empty:
        return FetchDataResponse(activities=[], rows=[], row_count=0, stats_columns=list(stats_df.columns))

    # Derive a plain YYYY-MM-DD date for each activity from its start_time,
    # used by the frontend's top-bar Date -> Activity picker.
    activities_df = activities_df.copy()
    if "start_time" in activities_df.columns:
        def _to_date(st):
            try:
                return datetime.datetime.fromtimestamp(float(st), tz=datetime.timezone.utc).date().isoformat()
            except (ValueError, TypeError, OSError):
                return None

        activities_df["date"] = activities_df["start_time"].apply(_to_date)
    else:
        activities_df["date"] = None

    activities_out = [
        {
            "id": str(r["id"]),
            "name": str(r.get("name", r["id"])),
            "date": r.get("date"),
            "start_time": float(r["start_time"]) if r.get("start_time") is not None else None,
            "tags": r.get("tags") or [],
        }
        for _, r in activities_df.iterrows()
    ]
    activities_out.sort(key=lambda a: (a["date"] or "", a["start_time"] or 0, a["name"]))

    if stats_df.empty or "activity_id" not in stats_df.columns:
        return FetchDataResponse(
            activities=activities_out, rows=[], row_count=0, stats_columns=list(stats_df.columns)
        )

    # Join stats rows with their activity's name/date/tags so the frontend
    # never has to do a second lookup.
    act_lookup = activities_df[["id", "name", "date", "tags"]].rename(
        columns={"id": "activity_id", "name": "activity_name", "date": "activity_date"}
    )
    act_lookup["activity_id"] = act_lookup["activity_id"].astype(str)
    stats_df = stats_df.copy()
    stats_df["activity_id"] = stats_df["activity_id"].astype(str)
    # /stats grouped by activity can carry its own activity_name / date columns. A plain merge
    # would then split them into name_x / name_y and the app would see no activity_name at all
    # ("(unknown)" activities). Keep the activity list's values, and fall back to the stats'
    # own values for any activity the list didn't include.
    merged = stats_df.merge(act_lookup, on="activity_id", how="left", suffixes=("_stats", ""))
    for col, alts in (("activity_name", ("activity_name_stats", "activity_stats", "name")),
                      ("activity_date", ("activity_date_stats", "date"))):
        for alt in alts:
            if alt in merged.columns:
                merged[col] = merged[col].where(merged[col].notna(), merged[alt])
    if "tags_stats" in merged.columns:
        merged["tags"] = merged["tags"].where(merged["tags"].notna(), merged["tags_stats"])
    if merged["activity_date"].isna().any() and "start_time" in merged.columns:
        def _d(st):
            try:
                return datetime.datetime.fromtimestamp(float(st), tz=datetime.timezone.utc).date().isoformat()
            except (ValueError, TypeError, OSError):
                return None
        merged["activity_date"] = merged["activity_date"].where(merged["activity_date"].notna(),
                                                                merged["start_time"].map(_d))
    # stats 'date' comes as DD/MM/YYYY: make every activity_date YYYY-MM-DD
    def _iso(v):
        if v is None or (isinstance(v, float) and pd.isna(v)):
            return None
        v = str(v)
        if len(v) == 10 and v[2] == "/" and v[5] == "/":
            return f"{v[6:]}-{v[3:5]}-{v[:2]}"
        return v[:10]
    merged["activity_date"] = merged["activity_date"].map(_iso)
    merged = merged.drop(columns=[c for c in merged.columns if c.endswith("_stats")])
    _LAST_FETCH["unmatched_activity_ids"] = sorted(set(stats_df["activity_id"]) - set(act_lookup["activity_id"]))

    rows = _sanitize_records(merged)
    return FetchDataResponse(
        activities=activities_out,
        rows=rows,
        row_count=len(rows),
        stats_columns=list(merged.columns),
    )


@app.get("/api/debug/last-fetch", response_model=DebugColumnsResponse)
def debug_last_fetch():
    """Shows the raw (pre-normalization-friendly) column names from the most
    recent fetch, so config.py's STATS_COLUMN_CANDIDATES / ACTIVITY_COLUMN_CANDIDATES
    can be corrected if a table looks wrong."""
    activities_df = _LAST_FETCH["activities"]
    stats_df = _LAST_FETCH["stats"]
    sample = []
    if not stats_df.empty:
        sample = _sanitize_records(stats_df.head(5))
    return DebugColumnsResponse(
        activities_columns=list(activities_df.columns) if not activities_df.empty else [],
        stats_columns=list(stats_df.columns) if not stats_df.empty else [],
        sample_stats_rows=sample,
    )


@app.get("/api/debug/explosive-parameters")
def debug_explosive_parameters():
    """Which account parameter slugs were matched to Explosive Efforts /
    Explosive Distance on the last fetch ({} = account doesn't have them)."""
    return {
        "explosive": _LAST_FETCH.get("explosive_parameters", {}),
        "optional_found": _LAST_FETCH.get("optional_parameters", []),
    }


# ---------------------------------------------------------------- This Week (ported from Frankston Sport Science)

from pydantic import BaseModel as _BaseModel  # noqa: E402

from . import this_week  # noqa: E402


class _SyncRequest(_BaseModel):
    token: str
    region: str = "APAC"


@app.post("/api/this-week/sync")
def this_week_sync(req: _SyncRequest):
    if not req.token:
        raise HTTPException(400, "Token is required.")
    return this_week.start_sync(req.token, req.region)


@app.get("/api/this-week/sync-status")
def this_week_sync_status():
    return this_week.sync_status()


@app.get("/api/this-week")
def this_week_page(as_of: str = None):
    try:
        d = datetime.date.fromisoformat(as_of) if as_of else None
    except ValueError:
        raise HTTPException(400, "as_of must be YYYY-MM-DD")
    return this_week.build(d)


@app.get("/api/speed-exposure")
def speed_exposure_page(as_of: str = None):
    try:
        d = datetime.date.fromisoformat(as_of) if as_of else None
    except ValueError:
        raise HTTPException(400, "as_of must be YYYY-MM-DD")
    return this_week.build_speed(d)


# ---------------------------------------------------------------- Game Report (ported from Frankston Sport Science)

from . import game_report_page  # noqa: E402


class _GameRequest(_BaseModel):
    token: str
    region: str = "APAC"
    activity_id: str = ""


@app.post("/api/game-report/games")
def game_report_games(req: _GameRequest):
    if not req.token:
        raise HTTPException(400, "Token is required.")
    try:
        return game_report_page.games(req.token, req.region)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Couldn't load games from Catapult: {e}")


@app.post("/api/game-report/download")
def game_report_download(req: _GameRequest):
    if not req.token or not req.activity_id:
        raise HTTPException(400, "Token and activity_id are required.")
    return game_report_page.start_download(req.token, req.region, req.activity_id)


@app.get("/api/game-report/status")
def game_report_status(activity_id: str):
    return game_report_page.status(activity_id)


@app.get("/api/game-report")
def game_report_build(activity_id: str):
    try:
        return game_report_page.build(activity_id)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"Couldn't build the game report: {e}")


# ---------------------------------------------------------------- Rehab (ported from Frankston Sport Science)

from typing import List as _List  # noqa: E402

from . import rehab_page  # noqa: E402


class _RehabRow(_BaseModel):
    player: str = ""
    stage: str = ""
    injury: str = ""
    start_date: str = ""
    target_date: str = ""
    notes: str = ""
    active: bool = True


class _RehabList(_BaseModel):
    rows: _List[_RehabRow]


@app.get("/api/rehab")
def rehab_get():
    return rehab_page.build()


@app.post("/api/rehab")
def rehab_save(req: _RehabList):
    return rehab_page.save([r.dict() for r in req.rows])


# ---------------------------------------------------------------- Player Profile (ported from Frankston Sport Science)

from . import player_profile_page  # noqa: E402


@app.get("/api/player-profile")
def player_profile(player: str = None):
    return player_profile_page.build(player)


from . import rotations  # noqa: E402


@app.post("/api/game-report/rotations")
def game_report_rotations(req: _GameRequest):
    if not req.token or not req.activity_id:
        raise HTTPException(400, "Token and activity_id are required.")
    return rotations.load(req.token, req.region, req.activity_id)


from . import game_summaries  # noqa: E402


@app.post("/api/player-profile/work-out-games")
def player_profile_work_out_games(req: _GameRequest):
    if not req.token:
        raise HTTPException(400, "Token is required.")
    return game_summaries.start(req.token, req.region)


@app.get("/api/player-profile/work-out-games")
def player_profile_work_out_status():
    return game_summaries.status()


# ---------------------------------------------------------------- Drill Matrix (ported from Frankston Sport Science)

from . import drill_matrix_page  # noqa: E402


class _DrillName(_BaseModel):
    openfield_name: str = ""
    drill: str = ""
    type: str = ""


class _DrillNames(_BaseModel):
    rows: _List[_DrillName]


@app.post("/api/drill-matrix/sync")
def drill_matrix_sync(req: _GameRequest):
    if not req.token:
        raise HTTPException(400, "Token is required.")
    return drill_matrix_page.start(req.token, req.region)


@app.get("/api/drill-matrix/sync")
def drill_matrix_sync_status():
    return drill_matrix_page.status()


@app.get("/api/drill-matrix")
def drill_matrix(phase: str = "All", kind: str = "Skills"):
    return drill_matrix_page.build(phase, kind)


@app.post("/api/drill-matrix/names")
def drill_matrix_names(req: _DrillNames):
    return drill_matrix_page.save_names([r.dict() for r in req.rows])


# ---------------------------------------------------------------- Running Prescription (ported from Frankston Sport Science)

from typing import Any as _Any, Dict as _Dict  # noqa: E402

from . import prescription_page  # noqa: E402


class _PrescRequest(_BaseModel):
    session: _Dict[str, _Any]
    mode: str = "MAS Group"
    round_to: int = 1


class _TTRow(_BaseModel):
    player: str = ""
    tt_2k: str = ""
    date: str = ""


class _TTList(_BaseModel):
    rows: _List[_TTRow]


@app.get("/api/running-prescription/runners")
def prescription_runners():
    return prescription_page.runners_payload()


@app.post("/api/running-prescription")
def prescription(req: _PrescRequest):
    try:
        return prescription_page.prescribe(req.session, req.mode, req.round_to)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/running-prescription/time-trials")
def prescription_tt(req: _TTList):
    return prescription_page.save_tt([r.dict() for r in req.rows])


# ---------------------------------------------------------------- Player photos from a team web page

from fastapi.responses import FileResponse  # noqa: E402

from . import player_photos  # noqa: E402


class _PhotoScan(_BaseModel):
    url: str
    names: _List[str] = []


class _PhotoItem(_BaseModel):
    player: str
    image_url: str


class _PhotoSave(_BaseModel):
    items: _List[_PhotoItem]
    referer: str = ""


class _PhotoRemove(_BaseModel):
    player: str


@app.post("/api/photos/scan")
def photos_scan(req: _PhotoScan):
    try:
        return player_photos.scan(req.url.strip(), req.names)
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, f"That page returned an error ({e.response.status_code}). It may block automated access.")
    except httpx.RequestError as e:
        raise HTTPException(502, f"Couldn't open that page: {e}")


@app.post("/api/photos/save")
def photos_save(req: _PhotoSave):
    return player_photos.save([i.dict() for i in req.items], req.referer)


@app.post("/api/photos/remove")
def photos_remove(req: _PhotoRemove):
    return player_photos.remove(req.player)


@app.get("/api/photos")
def photos_list():
    return player_photos.photo_map()


@app.get("/api/photos/file/{slug}")
def photos_file(slug: str):
    meta = player_photos.load_index().get(slug)
    if not meta:
        raise HTTPException(404, "No photo")
    path = player_photos.PHOTOS_DIR / meta["file"]
    if not path.exists():
        raise HTTPException(404, "No photo")
    return FileResponse(path, headers={"Cache-Control": "max-age=3600"})
