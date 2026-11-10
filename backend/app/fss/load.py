"""Week-to-week load changes: who spiked, who dropped, and where this week is tracking.

Each player is compared with their OWN usual week: their last 4 weeks where they
did every team session (so a missed session doesn't make a normal week look like a
spike). Not enough of those yet → their last 4 weeks with any sessions. Guard rails keep it to a handful of flags a week:
- spread is at least 15% of their mean, so very steady players don't flag on noise;
- a change must also be big in real terms (e.g. 200 m of HSR, 6 accels);
- flag when one metric is ≥2.5 SD from usual, or two metrics are ≥2 SD;
- and the player moved well beyond the squad: when everyone's up (an extra
  session, the week after a bye) that's the plan, not a red flag.
A drop only counts if they wore a unit at every session that week (otherwise it's
missed sessions, not under-loading).

Weeks run Monday to Sunday, so in season a week ends with the game.
"""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd

from . import catapult_api
from .config import MAX_PLAUSIBLE_KMH, NO_GPS_KMH

METRICS = {"hsr_m": "HSR", "sprint_m": "Sprint", "z80_m": ">80% max", "accels": "Accels", "decels": "Decels"}
UNITS = {"hsr_m": "m", "sprint_m": "m", "z80_m": "m", "accels": "", "decels": ""}
MIN_CHANGE = {"hsr_m": 200, "sprint_m": 60, "z80_m": 75, "accels": 6, "decels": 6}
BASELINE_WEEKS = 4
MIN_BASELINE_WEEKS = 3
SD_FLOOR = 0.15
Z_ONE, Z_TWO = 2.5, 2.0      # back-tested on 2026: about 3 spikes and 1 drop a week across ~28 players
BEYOND_TEAM = 0.25           # a spike must be 25% more than the squad's typical change (drops: 25% less)
TOP_UP, HOLD = 0.5, 1.2      # week so far vs usual: below 50% → top up, above 120% → hold back
# Coming back from time out: in 2026 the first week back was where load jumped most (up to ~2x usual sprint)
RETURN_GAP_WEEKS = 2         # this many squad weeks with no unit = time out
RETURN_WATCH_WEEKS = 2       # watch the first 2 weeks back
RETURN_CEILING = 1.0         # first weeks back: stay at or under their usual week from before the time out


def week_of(d: date) -> date:
    return d - timedelta(days=d.weekday())


def sessions(speed: pd.DataFrame, maxes: pd.DataFrame) -> pd.DataFrame:
    """One row per player-session with load metrics, including metres above 80% of their own max."""
    s = speed.dropna(subset=["hsr_m"])
    # no GPS lock, or a GPS fault (impossible speeds pile up fake sprint metres): leave the session out
    s = s[(s["peak_kmh"] >= NO_GPS_KMH) & (s["peak_kmh"] <= MAX_PLAUSIBLE_KMH)].copy()
    mx = maxes[~maxes["provisional"]].set_index("player")["max_kmh"]
    s["max_kmh"] = s["player"].map(mx)
    s["z80_m"] = [catapult_api.above(r, 0.8 * m) if pd.notna(m) else np.nan for r, m in zip(
        s.to_dict("records"), s["max_kmh"])]
    s["week"] = s["date"].map(week_of)
    return s


def weekly(s: pd.DataFrame) -> pd.DataFrame:
    """Totals per player per week, plus how many of the team's sessions they wore a unit for."""
    w = s.groupby(["player", "week"]).agg(**{m: (m, "sum") for m in METRICS}, sessions=("activity_id", "nunique"))
    # z80 is NaN for players without a tested max: keep it NaN rather than 0
    no_max = s.groupby(["player", "week"])["z80_m"].apply(lambda x: x.isna().all())
    w.loc[no_max[no_max].index, "z80_m"] = np.nan
    team = s.groupby("week")["activity_id"].nunique().rename("team_sessions")
    return w.reset_index().merge(team, on="week")


def _baseline(g: pd.DataFrame, week: date) -> pd.DataFrame:
    """A player's usual weeks before `week`: last 4 with every session done, else last 4 with any."""
    before = g[g["week"] < week].sort_values("week")
    full = before[before["sessions"] >= before["team_sessions"]].tail(BASELINE_WEEKS)
    return full if len(full) >= MIN_BASELINE_WEEKS else before.tail(BASELINE_WEEKS)


def usual_week(w: pd.DataFrame, player: str, before: date) -> dict:
    """{metric: usual weekly value} from before a date (e.g. before an injury), or {} with no history."""
    base = _baseline(w[w["player"] == player], week_of(before))
    return {m: base[m].mean() for m in METRICS} if len(base) else {}


def returning(w: pd.DataFrame, week: date) -> pd.DataFrame:
    """Players in their first weeks back after time out, against their usual week from before it.

    Time out = RETURN_GAP_WEEKS or more squad weeks in a row without a unit. Found from the data,
    so it covers players who were never on the rehab list.
    """
    squad_weeks = sorted(w["week"].unique())
    rows = []
    for player, g in w.groupby("player"):
        present = set(g["week"])
        if week not in present:
            continue
        before = [wk for wk in squad_weeks if wk <= week]
        # walk back from this week to find the first week back after a gap
        for back_i in range(len(before) - 1, max(len(before) - 1 - RETURN_WATCH_WEEKS, -1), -1):
            gap = 0
            k = back_i - 1
            while k >= 0 and before[k] not in present:
                gap, k = gap + 1, k - 1
            if before[back_i] in present and gap >= RETURN_GAP_WEEKS and k >= 0:
                usual = usual_week(w, player, before[k + 1])
                if not usual:
                    break
                this = g[g["week"] == week].iloc[0]
                row = {"player": player, "back_week": before[back_i], "weeks_out": gap,
                       "week_back": len([wk for wk in before[back_i:] if wk in present])}
                for m in METRICS:
                    row[m], row[f"{m}_usual"] = this[m], usual[m]
                    row[f"{m}_pct"] = this[m] / usual[m] if usual[m] and pd.notna(this[m]) else np.nan
                row["over"] = [m for m in ("hsr_m", "sprint_m", "z80_m", "accels", "decels")
                               if pd.notna(row[f"{m}_pct"]) and row[f"{m}_pct"] > RETURN_CEILING
                               and row[m] - usual[m] >= MIN_CHANGE[m] / 2]
                rows.append(row)
                break
    return pd.DataFrame(rows)


def assess(w: pd.DataFrame, week: date) -> pd.DataFrame:
    """Each player's week vs their previous weeks: z-scores, % of usual and flags."""
    rows = []
    for player, g in w.groupby("player"):
        this = g[g["week"] == week]
        if this.empty:
            continue
        this = this.iloc[0]
        base = _baseline(g, week)
        row = {"player": player, "week": week, "sessions": int(this["sessions"]),
               "team_sessions": int(this["team_sessions"]), "baseline_weeks": len(base)}
        for m in METRICS:
            val, mean = this[m], base[m].mean()
            sd = max(base[m].std(ddof=0), SD_FLOOR * mean) if len(base) else np.nan
            row[m] = val
            row[f"{m}_usual"] = mean
            row[f"{m}_pct"] = val / mean if mean and pd.notna(val) else np.nan
            row[f"{m}_z"] = (val - mean) / sd if sd and pd.notna(val) and len(base) >= MIN_BASELINE_WEEKS else np.nan
            row[f"{m}_change"] = val - mean if pd.notna(val) and pd.notna(mean) else np.nan
        rows.append(row)
    a = pd.DataFrame(rows)
    if a.empty:
        return a

    # how the squad as a whole moved this week (median player's % of their usual)
    team = {m: a[f"{m}_pct"].median() for m in METRICS}
    for m in METRICS:
        a[f"{m}_team_pct"] = team[m]

    def big(r, m, sign):
        if not (pd.notna(r[f"{m}_z"]) and sign * r[f"{m}_change"] >= MIN_CHANGE[m]):
            return False
        vs_team = r[f"{m}_pct"] / team[m] if team[m] and pd.notna(team[m]) else np.nan
        return pd.isna(vs_team) or (vs_team >= 1 + BEYOND_TEAM if sign > 0 else vs_team <= 1 - BEYOND_TEAM)

    def flagged(r, sign):
        strong = [m for m in METRICS if big(r, m, sign) and sign * r[f"{m}_z"] >= Z_ONE]
        moderate = [m for m in METRICS if big(r, m, sign) and sign * r[f"{m}_z"] >= Z_TWO]
        return strong if strong else (moderate if len(moderate) >= 2 else [])

    a["spike"] = a.apply(lambda r: flagged(r, +1), axis=1)
    full_week = a["sessions"] >= a["team_sessions"]
    a["drop"] = [flagged(r, -1) if ok else [] for (_, r), ok in zip(a.iterrows(), full_week)]
    a["building"] = a["baseline_weeks"] < MIN_BASELINE_WEEKS
    return a


def so_far(s: pd.DataFrame, w: pd.DataFrame, today: date) -> pd.DataFrame:
    """This week so far as a share of each player's usual week."""
    week = week_of(today)
    now = s[(s["week"] == week) & (s["date"] <= today)]
    if now.empty:
        return pd.DataFrame()
    done = now.groupby("player").agg(**{m: (m, "sum") for m in METRICS}, sessions=("activity_id", "nunique"))
    usual = (w[w["week"] < week].sort_values("week").groupby("player").tail(BASELINE_WEEKS)
             .groupby("player")[list(METRICS)].mean())
    out = done.join(usual, rsuffix="_usual")
    for m in METRICS:
        out[f"{m}_pct"] = out[m] / out[f"{m}_usual"]
    out["team_sessions"] = now["activity_id"].nunique()
    return out.reset_index()


def team_change(a: pd.DataFrame) -> dict:
    """{metric: squad's median % of usual} for a week, from assess()."""
    return {m: a[f"{m}_team_pct"].iloc[0] for m in METRICS} if len(a) else {}


def describe(r, m) -> str:
    """'HSR 1,240 m vs usual 760 m (+63%)'."""
    unit = UNITS[m]
    return (f"{METRICS[m]} {r[m]:,.0f}{' ' + unit if unit else ''} vs usual {r[f'{m}_usual']:,.0f} "
            f"({r[f'{m}_pct'] - 1:+.0%})")


def backtest(w: pd.DataFrame) -> pd.DataFrame:
    """Flags per week across history, to check the rules give a sensible number."""
    out = []
    for week in sorted(w["week"].unique()):
        a = assess(w, week)
        if a.empty:
            continue
        out.append({"week": week, "players": len(a), "spikes": int(a["spike"].map(bool).sum()),
                    "drops": int(a["drop"].map(bool).sum())})
    return pd.DataFrame(out)
