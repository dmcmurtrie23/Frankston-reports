"""Days since each player last hit >=90% of their max velocity.

A player who didn't wear a unit shows "No data" rather than a flag: we can
only flag what we can see.
"""
from __future__ import annotations

from datetime import date, timedelta

import pandas as pd

from .config import MAX_PLAUSIBLE_KMH, SPEED_EXPOSURE_DAYS, SPEED_EXPOSURE_PCT, SPIKE_OVER_MAX

OK, FLAG, NO_DATA, NEEDS_TEST = "OK", "Flag", "No data", "Needs max test"


def combine(csv_sessions: pd.DataFrame, api_sessions: pd.DataFrame) -> pd.DataFrame:
    """CSV exports plus API sessions, one source per day.

    Any day the API has is taken from the API (10Hz, dwell-checked); older days
    fall back to the CSV exports, which can't check the dwell.
    """
    api_days = set(api_sessions["date"])
    old = csv_sessions[~csv_sessions["date"].isin(api_days)].assign(dwell_checked=False)
    if api_sessions.empty:
        return old.reset_index(drop=True)
    return pd.concat([old, api_sessions], ignore_index=True)


def exposures(sessions: pd.DataFrame, maxes: pd.DataFrame) -> pd.DataFrame:
    """Each player's session max as a % of their resolved max velocity."""
    df = sessions.merge(maxes[["player", "max_kmh", "provisional"]], on="player", how="left")
    df["pct_of_max"] = df["max_velocity_kmh"] / df["max_kmh"]
    # A GPS spike isn't a sprint: drop it from the speed numbers and list it as a data issue
    df["suspect"] = (df["max_velocity_kmh"] > MAX_PLAUSIBLE_KMH) | (df["pct_of_max"] > SPIKE_OVER_MAX)
    df.loc[df["suspect"], "pct_of_max"] = None
    df["hit"] = df["pct_of_max"] >= SPEED_EXPOSURE_PCT
    df["new_max"] = ~df["suspect"] & (df["max_velocity_kmh"] > df["max_kmh"])
    return df


def status_board(exp: pd.DataFrame, squad: list, as_of: date,
                 window_days: int = SPEED_EXPOSURE_DAYS, scheduled=()) -> pd.DataFrame:
    """One row per squad member, sorted so the people who need attention come first.

    `scheduled` is the calendar's session dates, so "units worn" counts sessions
    that should have data, not just those that were uploaded.
    """
    window_start = as_of - timedelta(days=window_days)
    team_dates = sorted(d for d in set(exp["date"].unique()) | set(scheduled) if window_start < d <= as_of)
    rows = []
    for p in squad:
        mine = exp[(exp["player"] == p) & (exp["date"] <= as_of)]
        hits = mine[mine["hit"]]
        last_hit = hits["date"].max() if not hits.empty else None
        days = (as_of - last_hit).days if last_hit else None
        recent = mine[mine["date"] > window_start]

        provisional = bool(mine["provisional"].iloc[0]) if not mine.empty else False
        if provisional:
            status = NEEDS_TEST  # % of max is meaningless until he's tested
        elif days is not None and days <= window_days:
            status = OK
        elif recent.empty or (last_hit is None and mine["date"].min() > window_start):
            # no unit worn lately, or our history is too short to say it's been >10 days
            status = NO_DATA
        else:
            status = FLAG

        new_max = mine[mine["new_max"]]
        rows.append({
            "player": p,
            "status": status,
            "days_since_90": days,
            "last_90_date": last_hit,
            "best_recent_pct": recent["pct_of_max"].max() if not recent.empty else None,
            "sessions_with_unit": f"{recent['date'].nunique()}/{len(team_dates)}",
            "max_kmh": mine["max_kmh"].iloc[0] if not mine.empty else None,
            "provisional_max": provisional,
            "new_max_kmh": new_max["max_velocity_kmh"].max() if not new_max.empty else None,
        })
    order = {FLAG: 0, NEEDS_TEST: 1, NO_DATA: 2, OK: 3}
    board = pd.DataFrame(rows)
    board["_o"] = board["status"].map(order)
    board["_d"] = board["days_since_90"].fillna(9999)
    return board.sort_values(["_o", "_d"], ascending=[True, False]).drop(columns=["_o", "_d"])
