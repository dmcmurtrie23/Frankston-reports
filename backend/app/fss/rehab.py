"""Return to play: where each rehab player is, and how far off game demands they are.

The rehab list (player, stage, dates, notes) lives in data/config/rehab.csv and is
edited on the Rehab page by the medical team. Everything else comes from Catapult:

- Game demands are the player's own games this season (at least 3), or the squad's
  if they don't have enough. "Average" is their typical game; "Peak" is their
  biggest game for volume and their best window for intensity.
- Rehab sessions are compared with those demands: best single session in the
  last 14 days, as a % of average and of peak.
"""
from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from .config import CONFIG_DIR

REHAB_FILE = CONFIG_DIR / "rehab.csv"
STAGES = ["Return to run", "Running progression", "Modified training", "Full training", "Ready to play"]
FIELDS = ["player", "stage", "injury", "start_date", "target_date", "notes", "active"]
RECENT_DAYS = 14
MIN_GAMES = 3
PART_GAME = 0.6   # games under 60% of their usual distance (subbed off, injured) aren't typical demands
GAP = 0.8         # under 80% of their average game = a gap to close
NEAR_RETURN_DAYS = 14                               # within this of the target date = return is close
NEAR_RETURN_STAGES = ("Full training", "Ready to play")


def near_return(row, today: date) -> bool:
    """In the last stages, or within two weeks of their target date: time to plan the first week back."""
    soon = pd.notna(row.get("target_date")) and (row["target_date"] - today).days <= NEAR_RETURN_DAYS
    return row.get("stage") in NEAR_RETURN_STAGES or bool(soon)

# What we compare. kind: volume (one session vs one game) or intensity (best window)
DEMANDS = {
    "distance_m": ("Distance", "m", "volume"),
    "hsr_m": ("HSR", "m", "volume"),
    "sprint_m": ("Sprint", "m", "volume"),
    "z80_m": (">80% max", "m", "volume"),
    "accels": ("Accels", "", "volume"),
    "decels": ("Decels", "", "volume"),
    "peak_mpm_60s": ("Peak 1 min", "m/min", "intensity"),
    "peak_mpm_300s": ("Peak 5 min", "m/min", "intensity"),
    "peak_hsr_60s": ("Peak 1 min HSR", "m/min", "intensity"),
    "top_kmh": ("Top speed", "km/h", "intensity"),
}


def load_list(path: Path = REHAB_FILE) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame({f: pd.Series(dtype="object") for f in FIELDS})
    df = pd.read_csv(path, dtype=str).fillna("")
    for c in ("start_date", "target_date"):
        df[c] = pd.to_datetime(df[c], errors="coerce").dt.date
    df["active"] = df["active"].str.lower().isin(["yes", "true", "1", "y"])
    return df.reindex(columns=FIELDS)


def save_list(df: pd.DataFrame, path: Path = REHAB_FILE) -> None:
    out = df.reindex(columns=FIELDS).copy()
    out = out[out["player"].fillna("").astype(str).str.strip() != ""]
    out["active"] = out["active"].map(lambda x: "yes" if x is True or str(x).lower() in ("yes", "true", "1") else "no")
    out.to_csv(path, index=False)


def _with_top(s: pd.DataFrame) -> pd.DataFrame:
    s = s.copy()
    s["top_kmh"] = s["top_500ms_kmh"]  # held 0.5 s, same rule as the speed flag
    return s


def demands(s: pd.DataFrame, player: str) -> dict:
    """{metric: (average, peak)} from the player's games, or the squad's if they have fewer than 3."""
    g = _with_top(s[s["game"] == True])
    mine = g[g["player"] == player]
    if len(mine) and mine["distance_m"].median() > 0:
        mine = mine[mine["distance_m"] >= PART_GAME * mine["distance_m"].median()]
    own = len(mine) >= MIN_GAMES
    src = mine if own else g[g["distance_m"] >= PART_GAME * g["distance_m"].median()]
    out = {m: (src[m].mean(), src[m].max() if own else src[m].quantile(0.9)) for m in DEMANDS}
    return {"values": out, "own": own, "games": len(mine)}


def progress(s: pd.DataFrame, player: str, today: date, max_kmh) -> dict:
    """Best rehab session numbers in the last 14 days against game demands."""
    d = demands(s, player)
    recent = _with_top(s[(s["player"] == player) & (s["date"] > today - timedelta(days=RECENT_DAYS))
                         & (s["date"] <= today)]).sort_values("date")
    rows = []
    for m, (label, unit, kind) in DEMANDS.items():
        avg, peak = d["values"][m]
        best = recent[m].max() if len(recent) else np.nan
        rows.append({"metric": m, "label": label, "unit": unit, "kind": kind, "best": best, "average": avg,
                     "peak": peak, "pct_avg": best / avg if avg and pd.notna(best) else np.nan,
                     "pct_peak": best / peak if peak and pd.notna(best) else np.nan})
    table = pd.DataFrame(rows)
    gaps = table[(table["pct_avg"] < GAP) | table["pct_avg"].isna()]
    checks = {
        "Reached ≥90% of max speed": bool(max_kmh and len(recent) and recent["top_kmh"].max() >= 0.9 * max_kmh),
        "A session at average game distance": bool(table.set_index("metric").loc["distance_m", "pct_avg"] >= 1),
        "A session at average game HSR": bool(table.set_index("metric").loc["hsr_m", "pct_avg"] >= 1),
        "Peak 1 min within 90% of game peak": bool(table.set_index("metric").loc["peak_mpm_60s", "pct_peak"] >= 0.9),
    }
    return {"table": table, "gaps": gaps, "checks": checks, "sessions": recent, "own_games": d["own"],
            "games": d["games"], "pct_max": (recent["top_kmh"].max() / max_kmh) if max_kmh and len(recent) else np.nan}
