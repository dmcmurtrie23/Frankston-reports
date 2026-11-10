"""Decide which max velocity each player's % numbers are based on.

Priority: manual override > OpenField stored max > MASTER2 > fastest recorded
GPS speed (provisional, for players who haven't been tested).
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

from .config import (MAX_PLAUSIBLE_KMH, MAX_VELOCITY_OVERRIDES, NEEDS_MAX_VELOCITY_TEST,
                     OPENFIELD_PLACEHOLDER_KMH)

MISMATCH_KMH = 0.5


def load_overrides(path: Path = MAX_VELOCITY_OVERRIDES) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame(columns=["player", "max_velocity_kmh", "source"])
    return pd.read_csv(path)


def needs_test(path: Path = NEEDS_MAX_VELOCITY_TEST) -> set:
    if not path.exists():
        return set()
    return set(pd.read_csv(path)["player"])


def resolve(sessions: pd.DataFrame, master: pd.DataFrame,
            overrides: pd.DataFrame, untested: set) -> pd.DataFrame:
    """One row per player: the max velocity to use and where it came from."""
    # OpenField shows 36.00 when no max has been set, so skip those values
    of_rows = sessions.dropna(subset=["openfield_max_kmh"])
    of_rows = of_rows[(of_rows["openfield_max_kmh"] - OPENFIELD_PLACEHOLDER_KMH).abs() > 0.02]
    # Frankston Reports: other accounts use other "not set" defaults (e.g. 20 m/s = 72 km/h), so
    # any stored max no human can run (over MAX_PLAUSIBLE_KMH, or under 20 km/h) is treated as not set.
    of_rows = of_rows[(of_rows["openfield_max_kmh"] <= MAX_PLAUSIBLE_KMH) & (of_rows["openfield_max_kmh"] >= 20)]
    openfield = of_rows.sort_values("date").groupby("player")["openfield_max_kmh"].last()
    plausible = sessions[sessions["max_velocity_kmh"] <= MAX_PLAUSIBLE_KMH]
    best = plausible.groupby("player")["max_velocity_kmh"].max()
    master_max = master.set_index("player")["master_max_kmh"].dropna()
    ov = overrides.set_index("player")

    players = sorted(set(openfield.index) | set(master_max.index) | set(best.index) | set(ov.index))
    rows = []
    for p in players:
        of, mm, rec = openfield.get(p), master_max.get(p), best.get(p)
        provisional = False
        marked_untested = p in ov.index and str(ov.loc[p, "source"]).lower() == "untested"
        if marked_untested or p in untested:
            value, source, provisional = rec, "fastest recorded (untested)", True
        elif p in ov.index and pd.notna(ov.loc[p, "max_velocity_kmh"]):
            value, source = float(ov.loc[p, "max_velocity_kmh"]), f"override ({ov.loc[p, 'source']})"
        elif of is not None:
            value, source = of, "OpenField"
        elif mm is not None:
            value, source = mm, "MASTER2"
        else:
            value, source, provisional = rec, "fastest recorded", True
        rows.append({
            "player": p,
            "max_kmh": value,
            "source": source,
            "provisional": provisional,
            "openfield_kmh": of,
            "master_kmh": mm,
            "fastest_recorded_kmh": rec,
            "sources_disagree": of is not None and mm is not None and abs(of - mm) > MISMATCH_KMH
                                and p not in ov.index,
            "needs_test": p in untested,
        })
    return pd.DataFrame(rows)
