"""This Week — ported from the Frankston Sport Science app (fss/, page "This Week").

What to act on this week, from Catapult 10Hz data:
- load spikes / under-loading last week vs each player's own usual week (and the squad);
- this week so far as a % of their usual week;
- players returning from time out (and rehab players close to returning);
- who's due a speed exposure (no >=90% of max in 10+ days).

The 10Hz data is pulled from the Catapult API into Frankston_Reports/sport_science_data/
(summaries only) by sync(), which runs in a background thread because the first pull of
the season downloads every player's 10Hz trace for every session.
"""
from __future__ import annotations

import math
import threading
import time
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

from .fss import catapult, catapult_api, max_velocity, rehab, schedule, speed_exposure
from .fss import load as weekload
from .fss.config import SPEED_EXPOSURE_DAYS, SPEED_EXPOSURE_PCT

REGION_CODES = {"APAC": "au", "EMEA": "eu", "NAM": "us"}

_SYNC = {"running": False, "message": "", "started": None, "finished": None, "result": None}
_LOCK = threading.Lock()


# ---------------------------------------------------------------- sync (background)

def start_sync(token: str, region: str) -> dict:
    with _LOCK:
        if _SYNC["running"]:
            return sync_status()
        catapult_api.use_token(token, REGION_CODES.get(region, "au"))
        _SYNC.update(running=True, message="Starting…", started=time.time(), finished=None, result=None)

    def run():
        try:
            out = catapult_api.sync(progress=lambda msg: _SYNC.__setitem__("message", msg))
        except Exception as e:  # noqa: BLE001
            out = {"new": [], "error": str(e), "busy": False}
        _SYNC.update(running=False, finished=time.time(), result=out,
                     message=("Another pull is already running." if out.get("busy") else ""))

    threading.Thread(target=run, daemon=True).start()
    return sync_status()


def sync_status() -> dict:
    lc = catapult_api.last_check()
    exp = catapult_api.token_expiry() if catapult_api.token() else None
    return {
        "running": _SYNC["running"],
        "message": _SYNC["message"],
        "result": _SYNC["result"],
        "last_check": lc.isoformat() if lc else None,
        "last_error": catapult_api.last_error(),
        "token_expires": exp.isoformat() if exp else None,
    }


# ---------------------------------------------------------------- page data

def _clean(v):
    """numpy / pandas values -> plain JSON."""
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_clean(x) for x in v]
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        return None if math.isnan(float(v)) or math.isinf(float(v)) else float(v)
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    if v is pd.NaT:
        return None
    return v


def _master() -> pd.DataFrame:
    """MASTER2 maxes from the conditioning workbook, if it's been added (needs openpyxl)."""
    try:
        from .fss import squad
        return squad.load_master()
    except Exception:  # noqa: BLE001 - no workbook / no openpyxl: fine, maxes come from OpenField / GPS
        return pd.DataFrame(columns=["player", "tt_2k_s", "master_max_kmh", "master_group"])


def _load():
    rows = catapult.load_all()                       # optional OpenField CSV exports
    sess = catapult.sessions(rows)
    speed_sess = speed_exposure.combine(sess, catapult_api.speed_sessions())
    for col in ("openfield_max_kmh", "max_velocity_kmh", "date", "player"):   # nothing pulled yet
        if col not in speed_sess.columns:
            speed_sess[col] = pd.Series(dtype="object" if col in ("date", "player") else "float")
    master = _master()
    players = sorted(set(master["player"]) | set(speed_sess["player"]))
    maxes = max_velocity.resolve(speed_sess, master, max_velocity.load_overrides(), max_velocity.needs_test())
    load_sess = weekload.sessions(catapult_api.load_speed(), maxes)
    return speed_sess, players, maxes, schedule.load(), load_sess


def _return_limits(usual: dict) -> list:
    out = []
    for m in ("hsr_m", "sprint_m", "z80_m", "accels", "decels"):
        v = usual.get(m)
        if v is not None and pd.notna(v):
            unit = weekload.UNITS[m]
            out.append((weekload.METRICS[m], f"{v * weekload.RETURN_CEILING:,.0f}{' ' + unit if unit else ''}"))
    return out


def _action(metrics, up):
    speed_m = [m for m in metrics if m in ("hsr_m", "sprint_m", "z80_m")]
    cod = [m for m in metrics if m in ("accels", "decels")]
    if up:
        parts = ["Check in at the first session (soreness, how they're pulling up)."]
        if speed_m:
            parts.append("Avoid a second big high-speed week in a row.")
        if cod:
            parts.append("Go easy on change-of-direction volume early in the week.")
    else:
        parts = []
        if speed_m:
            parts.append("Top up high-speed running before the weekend so they're not underdone.")
        if cod:
            parts.append("Add some acceleration and change-of-direction work.")
    return " ".join(parts)


def build(as_of: date | None = None) -> dict:
    if catapult_api.load_speed().empty and catapult.load_all().empty:
        d = as_of or date.today()
        mon = weekload.week_of(d)
        return _clean({"as_of": d, "this_mon": mon, "last_mon": mon - timedelta(days=7), "data_through": None,
                       "players": 0, "sessions_pulled": 0, "empty": True,
                       "tiles": {"spikes": 0, "drops": 0, "due": 0, "rehab": 0}, "squad_change": [],
                       "team_sessions_last": 0, "has_last": False, "spikes": [], "drops": [],
                       "so_far": {"rows": [], "cards": [], "team_sessions": 0, "late_week": d.weekday() > 3},
                       "returning": [], "speed_due": [], "building": [], "metrics": weekload.METRICS, "rules": {}})
    speed_sess, players, maxes, calendar, load_sess = _load()
    data_through = load_sess["date"].max() if not load_sess.empty else None
    as_of = as_of or data_through or date.today()
    this_mon = weekload.week_of(as_of)
    last_mon = this_mon - timedelta(days=7)

    w = weekload.weekly(load_sess[load_sess["date"] <= as_of]) if not load_sess.empty else pd.DataFrame()
    last = weekload.assess(w, last_mon) if not w.empty else pd.DataFrame()
    now = weekload.so_far(load_sess, w, as_of) if not w.empty else pd.DataFrame()
    board = (speed_exposure.status_board(speed_exposure.exposures(speed_sess, maxes), players, as_of,
                                         scheduled=calendar["date"].tolist())
             if players else pd.DataFrame(columns=["player", "status", "days_since_90", "max_kmh"]))
    rehab_list = rehab.load_list()
    in_rehab = set(rehab_list.loc[rehab_list["active"] == True, "player"])  # noqa: E712
    spikes = last[last["spike"].map(bool)] if not last.empty else last
    drops = last[last["drop"].map(bool)] if not last.empty else last
    due = board[board["status"] == "Flag"] if not board.empty else board

    def change_cards(df, key, tone, up):
        cards = []
        for _, r in df.iterrows():
            ms = r[key]
            biggest = max(ms, key=lambda m: abs(r[f"{m}_z"]))
            cards.append({"who": r["player"], "num": f"{r[f'{biggest}_pct'] - 1:+.0%}",
                          "unit": weekload.METRICS[biggest], "tone": tone,
                          "pill": "In rehab" if r["player"] in in_rehab else None,
                          "meta": " · ".join(weekload.describe(r, m) for m in ms), "act": _action(ms, up)})
        return cards

    squad_change = []
    if not last.empty:
        tc = weekload.team_change(last)
        squad_change = [{"label": weekload.METRICS[m], "pct": v - 1} for m, v in tc.items() if pd.notna(v)]

    # this week so far
    so_far = {"rows": [], "cards": [], "team_sessions": 0, "late_week": as_of.weekday() > 3}
    if not now.empty:
        team_n = int(now["team_sessions"].iloc[0])
        so_far["team_sessions"] = team_n
        hold = now[(now["hsr_m_pct"] > weekload.HOLD) | (now["sprint_m_pct"] > weekload.HOLD)]
        top = now[((now["hsr_m_pct"] < weekload.TOP_UP) | (now["sprint_m_pct"] < weekload.TOP_UP)) & (team_n >= 2)]
        so_far["cards"] = (
            [{"who": r["player"], "num": f"{max(r['hsr_m_pct'], r['sprint_m_pct']):.0%}", "unit": "of usual", "tone": "flag",
              "meta": f"HSR {r['hsr_m_pct']:.0%} · sprint {r['sprint_m_pct']:.0%} of a usual week",
              "act": "Already at or past a normal week. Hold back high-speed work."} for _, r in hold.iterrows()]
            + [{"who": r["player"], "num": f"{min(r['hsr_m_pct'], r['sprint_m_pct']):.0%}", "unit": "of usual", "tone": "warn",
                "meta": f"HSR {r['hsr_m_pct']:.0%} · sprint {r['sprint_m_pct']:.0%} of a usual week",
                "act": "Behind a normal week. Top up high-speed running at the next session."} for _, r in top.iterrows()])
        so_far["rows"] = [{"player": r["player"], "sessions": int(r["sessions"]),
                           **{m: r[f"{m}_pct"] for m in weekload.METRICS}} for _, r in now.iterrows()]

    # returning from time out
    back = weekload.returning(w, this_mon) if not w.empty else pd.DataFrame()
    soon = (rehab_list[(rehab_list["active"] == True)  # noqa: E712
                       & rehab_list.apply(lambda r: rehab.near_return(r, as_of), axis=1)]
            if not rehab_list.empty else rehab_list)
    back_names = set(back["player"]) if not back.empty else set()
    returning = []
    for _, r in back.iterrows():
        over = r["over"]
        pcts = [r[m + "_pct"] for m in ("hsr_m", "sprint_m") if pd.notna(r[m + "_pct"])]
        returning.append({
            "who": r["player"], "num": f"{max(pcts):.0%}" if pcts else None, "unit": "of usual",
            "tone": "flag" if over else "ok",
            "meta": f"Week {int(r['week_back'])} back after {int(r['weeks_out'])} weeks out · "
                    + " · ".join(weekload.describe(r, m) for m in ("hsr_m", "sprint_m", "accels")),
            "act": ("Already over their usual week in " + ", ".join(weekload.METRICS[m] for m in over)
                    + ". Hold back for the rest of the week.") if over
                   else "Within their usual week. Keep building gradually."})
    for _, r in soon.iterrows():
        if r["player"] in back_names:
            continue
        usual = (weekload.usual_week(w, r["player"], r["start_date"] if pd.notna(r["start_date"]) else as_of)
                 if not w.empty else {})
        lims = _return_limits(usual)
        returning.append({
            "who": r["player"], "pill": "Returning soon", "tone": "warn",
            "meta": f"Rehab: {r['stage']}" + (f" · target {r['target_date']:%a %d %b}" if pd.notna(r["target_date"]) else ""),
            "act": ("First two weeks back, stay under their usual week: "
                    + " · ".join(f"{k} {v}" for k, v in lims[:3]) + ".") if lims
                   else "No usual week on record yet. Build up gradually."})

    speed_due = [{"who": r["player"], "num": None if pd.isna(r["days_since_90"]) else int(r["days_since_90"]),
                  "unit": "days", "tone": "red", "pill": "None on record" if pd.isna(r["days_since_90"]) else None,
                  "act": f"Exposure at ≥{0.9 * r['max_kmh']:.1f} km/h." if pd.notna(r["max_kmh"]) else "Plan an exposure."}
                 for _, r in due.iterrows()]

    return _clean({
        "empty": False, "as_of": as_of, "this_mon": this_mon, "last_mon": last_mon, "data_through": data_through,
        "players": len(players), "sessions_pulled": int(load_sess["activity_id"].nunique()) if not load_sess.empty else 0,
        "tiles": {"spikes": len(spikes), "drops": len(drops), "due": len(due), "rehab": len(in_rehab)},
        "squad_change": squad_change,
        "team_sessions_last": int(last["team_sessions"].iloc[0]) if not last.empty else 0,
        "has_last": not last.empty,
        "spikes": change_cards(spikes, "spike", "flag", True),
        "drops": change_cards(drops, "drop", "warn", False),
        "so_far": so_far,
        "returning": returning,
        "speed_due": speed_due,
        "building": last[last["building"]]["player"].tolist() if not last.empty else [],
        "metrics": weekload.METRICS,
        "rules": {
            "top_up": weekload.TOP_UP, "hold": weekload.HOLD, "z_one": weekload.Z_ONE, "z_two": weekload.Z_TWO,
            "beyond_team": weekload.BEYOND_TEAM, "min_change": weekload.MIN_CHANGE,
            "return_gap_weeks": weekload.RETURN_GAP_WEEKS, "return_watch_weeks": weekload.RETURN_WATCH_WEEKS,
            "speed_pct": SPEED_EXPOSURE_PCT, "speed_days": SPEED_EXPOSURE_DAYS,
        },
    })


# ---------------------------------------------------------------- Speed Exposure page

def build_speed(as_of: date | None = None) -> dict:
    """Days since each player last hit >=90% of their max velocity (ported "Speed Exposure" page)."""
    from .fss.config import MIN_DWELL_SECONDS

    empty = catapult_api.load_speed().empty and catapult.load_all().empty
    if empty:
        return _clean({"empty": True, "as_of": as_of or date.today(), "tiles": {}, "new_max": [], "flagged": [],
                       "tests": [], "board": [], "rules": {"speed_pct": SPEED_EXPOSURE_PCT, "speed_days": SPEED_EXPOSURE_DAYS}})
    speed_sess, players, maxes, calendar, _ = _load()
    as_of = as_of or (speed_sess["date"].max() if not speed_sess.empty else date.today())
    board = speed_exposure.status_board(speed_exposure.exposures(speed_sess, maxes), players, as_of,
                                        scheduled=calendar["date"].tolist())
    counts = board["status"].value_counts()

    new_max = board.dropna(subset=["new_max_kmh"])
    flagged = board[board["status"] == "Flag"]
    tests = board[board["status"] == "Needs max test"]
    missing = schedule.missing_uploads(calendar, set(speed_sess["date"]), as_of)

    window = speed_sess[(speed_sess["date"] <= as_of) & (speed_sess["date"] > as_of - timedelta(days=SPEED_EXPOSURE_DAYS))]
    checked = window.get("dwell_checked", pd.Series(dtype=bool)).fillna(False).astype(bool)
    if len(window) and checked.all():
        source = (f"10Hz from Catapult. A hit means at least {MIN_DWELL_SECONDS:g} s at "
                  f"≥{SPEED_EXPOSURE_PCT:.0%} of max.")
    elif checked.any():
        source = (f"Mixed. Catapult sessions need {MIN_DWELL_SECONDS:g} s at ≥{SPEED_EXPOSURE_PCT:.0%}; "
                  "older CSV exports use the session top speed (no minimum time).")
    else:
        source = "CSV exports. Uses the session top speed, with no minimum time at speed."

    return _clean({
        "empty": False, "as_of": as_of,
        "tiles": {s: int(counts.get(s, 0)) for s in ("Flag", "Needs max test", "No data", "OK")},
        "missing_uploads": [d for d in missing],
        "new_max": [{"who": r["player"], "num": f"{r['new_max_kmh']:.2f}", "unit": "km/h", "tone": "ok",
                     "meta": f"Stored max {r['max_kmh']:.2f} km/h", "act": "Update their max velocity."}
                    for _, r in new_max.iterrows()],
        "flagged": [{"who": r["player"], "num": None if pd.isna(r["days_since_90"]) else int(r["days_since_90"]),
                     "unit": "days", "tone": "flag", "pill": "None on record" if pd.isna(r["days_since_90"]) else None,
                     "meta": (f"Best lately {r['best_recent_pct']:.0%} of max · units {r['sessions_with_unit']}"
                              if pd.notna(r["best_recent_pct"]) else f"Units {r['sessions_with_unit']}"),
                     "act": f"Plan an exposure at ≥{0.9 * r['max_kmh']:.1f} km/h." if pd.notna(r["max_kmh"]) else "Plan an exposure."}
                    for _, r in flagged.iterrows()],
        "tests": [{"who": r["player"], "pill": "Test", "tone": "warn",
                   "meta": "Using their fastest recorded speed for now."} for _, r in tests.iterrows()],
        "board": [{"player": r["player"], "status": r["status"],
                   "days_since_90": None if pd.isna(r["days_since_90"]) else int(r["days_since_90"]),
                   "last_90_date": None if pd.isna(r["last_90_date"]) else r["last_90_date"],
                   "best_recent_pct": r["best_recent_pct"], "units": r["sessions_with_unit"],
                   "max_kmh": r["max_kmh"], "provisional": bool(r["provisional_max"])}
                  for _, r in board.iterrows()],
        "source": source,
        "rules": {"speed_pct": SPEED_EXPOSURE_PCT, "speed_days": SPEED_EXPOSURE_DAYS, "dwell_s": MIN_DWELL_SECONDS},
    })


def time_trials(players) -> dict:
    """{player: (2 km TT seconds, source)}: MASTER2 first, else their latest matched time trial
    in the workbook's TT Comparisons sheet (same rule as the sport science app's checks.roster)."""
    out = {}
    try:
        from .fss import squad
        master = squad.load_master()
        for _, r in master.dropna(subset=["tt_2k_s"]).iterrows():
            out[r["player"]] = (float(r["tt_2k_s"]), "MASTER2")
        tt = squad.load_tt_history(players)
        if len(tt):
            latest = tt[tt["matched"]].sort_values("date").groupby("player").last()
            for p, r in latest.iterrows():
                if p not in out:
                    out[p] = (float(r["tt_2k_s"]), r["test"])
    except Exception:  # noqa: BLE001 - no workbook / no openpyxl
        pass
    return out
