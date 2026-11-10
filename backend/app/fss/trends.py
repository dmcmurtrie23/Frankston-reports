"""Weekly trends: a player's last 4 to 12 weeks for one metric, with a trend line.

Weeks run Monday to Sunday (same as This Week). The window counts squad weeks,
so a break with no team sessions (Christmas, a bye) doesn't eat into it.
- A week the player has no data for is shown as a gap, not a zero: missing
  weeks are usually injury or no unit, and zeros would drag the trend down.
- The current week, viewed Monday to Friday, is shown but left out of the trend.
- Trend = straight line through their weeks (needs 3+). "Rising" or "Falling"
  when it moves at least 5% of their average per week, otherwise "Steady".
"""
from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

from .load import week_of

METRICS = {"distance_m": ("Distance", "m"), "hsr_m": ("HSR", "m"), "sprint_m": ("Sprint", "m"),
           "z80_m": (">80% max", "m"), "accels": ("Accels", ""), "decels": ("Decels", "")}
WINDOWS = [4, 6, 8, 12]
MIN_POINTS = 3
STEADY = 0.05   # under 5% of their average per week = steady


def weekly(s: pd.DataFrame, as_of: date) -> pd.DataFrame:
    """Totals per player per week up to `as_of`, with sessions done and the team's session count."""
    s = s[s["date"] <= as_of]
    if s.empty:
        return pd.DataFrame(columns=["player", "week", *METRICS, "sessions", "team_sessions"])
    w = s.groupby(["player", "week"]).agg(**{m: (m, lambda x: x.sum(min_count=1)) for m in METRICS},
                                           sessions=("activity_id", "nunique")).reset_index()
    team = s.groupby("week")["activity_id"].nunique().rename("team_sessions")
    return w.merge(team, on="week")


def window(w: pd.DataFrame, player: str, metric: str, weeks: int, as_of: date) -> pd.DataFrame:
    """One row per squad week in the window: the player's value (NaN if no data), squad median, partial flag."""
    squad_weeks = sorted(w["week"].unique())[-weeks:]
    squad = w[w["week"].isin(squad_weeks)].groupby("week")[metric].median()
    mine = w[w["player"] == player].set_index("week")
    current = week_of(as_of)
    out = pd.DataFrame({"week": squad_weeks})
    out["value"] = out["week"].map(mine[metric]) if len(mine) else np.nan
    out["sessions"] = out["week"].map(mine["sessions"]) if len(mine) else np.nan
    out["team_sessions"] = out["week"].map(w.drop_duplicates("week").set_index("week")["team_sessions"])
    out["squad"] = out["week"].map(squad)
    out["partial"] = (out["week"] == current) & (as_of.weekday() < 5)   # by Saturday the game week is done
    return out


def fit(win: pd.DataFrame) -> dict:
    """Straight-line trend through the finished weeks with data."""
    pts = win[win["value"].notna() & ~win["partial"]]
    if len(pts) < MIN_POINTS:
        return {"ok": False, "points": len(pts)}
    x = pts.index.to_numpy(dtype=float)
    slope, intercept = np.polyfit(x, pts["value"].to_numpy(dtype=float), 1)
    mean = pts["value"].mean()
    per_week = slope / mean if mean else np.nan
    direction = ("Steady" if pd.isna(per_week) or abs(per_week) < STEADY
                 else "Rising" if per_week > 0 else "Falling")
    return {"ok": True, "points": len(pts), "slope": slope, "per_week": per_week, "mean": mean,
            "direction": direction, "x": [x[0], x[-1]], "y": [intercept + slope * x[0], intercept + slope * x[-1]]}

