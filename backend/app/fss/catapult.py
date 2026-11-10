"""Read OpenField CTR summary report exports (one row per player per period)."""
from __future__ import annotations

import csv
from datetime import datetime
from pathlib import Path

import pandas as pd

from .config import CATAPULT_DIR
from .names import canonical

COLUMNS = {
    "Player Name": "player",
    "Period Name": "period",
    "Period Number": "period_number",
    "Duration": "duration_s",
    "Distance": "distance_m",
    "Meterage Per Minute": "m_per_min",
    "Max Velocity": "max_velocity_kmh",
    "Max Vel (% Max)": "max_velocity_pct",
    "High Speed Distance": "hsr_m",
    "High Speed Distance Per Minute": "hsr_m_per_min",
    "Sprint Distance": "sprint_m",
    "Sprint Efforts": "sprint_efforts",
    "Acceleration Efforts": "accels",
    "Deceleration Efforts": "decels",
    "Accel + Decel Efforts": "accel_decel",
    "Player Load": "player_load",
    "Energy": "energy",
}
# Present in newer exports only
OPTIONAL = {
    "Activity Tags": "activity_tags",
    "Game Tags": "game_tags",
    "Athlete Participation Tags": "participation",
    "Period Tags": "period_tags",
}


def _seconds(hms: str) -> int:
    h, m, s = (int(x) for x in hms.split(":"))
    return h * 3600 + m * 60 + s


def read_ctr_report(path: Path) -> pd.DataFrame:
    """Parse one CTR export into tidy rows: one per player per period.

    The 'Session' period is the whole activity; numbered periods are quarters
    or drills as coded in OpenField.
    """
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))

    meta = {}
    header_idx = None
    for i, row in enumerate(rows):
        if row and row[0] == "Player Name":
            header_idx = i
            break
        if len(row) >= 2 and row[0].endswith(":"):
            meta[row[0].rstrip(":")] = row[1]
    if header_idx is None:
        raise ValueError(f"{path.name}: no 'Player Name' header row found")

    header = rows[header_idx]
    records = [dict(zip(header, r)) for r in rows[header_idx + 1:] if len(r) > 5]
    raw = pd.DataFrame(records)
    missing = [c for c in COLUMNS if c not in raw.columns]
    if missing:
        raise ValueError(f"{path.name}: missing columns {missing}")
    df = raw[list(COLUMNS)].rename(columns=COLUMNS)
    for src, dst in OPTIONAL.items():
        df[dst] = raw[src].replace("", None) if src in raw.columns else None
    df["player"] = df["player"].map(canonical)
    df["duration_s"] = df["duration_s"].map(_seconds)
    numeric = [c for c in COLUMNS.values() if c not in ("player", "period", "duration_s")]
    df[numeric] = df[numeric].apply(pd.to_numeric, errors="coerce")

    df["date"] = datetime.strptime(meta["Date"], "%d/%m/%Y").date()
    df["start_time"] = meta.get("Start Time")
    df["activity"] = path.stem.replace("ctr-report-", "").replace("-", " ").title()
    df["source_file"] = path.name
    # OpenField's stored max velocity is implied by max velocity and its % of max
    pct = df["max_velocity_pct"].where(df["max_velocity_pct"] > 0)
    df["openfield_max_kmh"] = (df["max_velocity_kmh"] / pct * 100).round(2)
    return df


def load_all(directory: Path = CATAPULT_DIR) -> pd.DataFrame:
    """Every CTR export in the folder, combined.

    The same session exported twice (a re-upload, or a sync copy like
    "... 2.csv") is counted once: we keep the export with the most columns,
    then the most recently modified.
    """
    files = sorted(directory.glob("*.csv"))
    if not files:
        return pd.DataFrame(columns=list(COLUMNS.values()) + ["date"])
    frames = []
    for f in files:
        df = read_ctr_report(f)
        df["_cols"] = df[list(OPTIONAL.values())].notna().any().sum()
        df["_mtime"] = f.stat().st_mtime
        frames.append(df)
    allrows = pd.concat(frames, ignore_index=True)
    keep = (allrows.drop_duplicates("source_file")
            .sort_values(["_cols", "_mtime"], ascending=False)
            .drop_duplicates(["date", "start_time"])["source_file"])
    out = allrows[allrows["source_file"].isin(set(keep))]
    return out.drop(columns=["_cols", "_mtime"]).reset_index(drop=True)


def duplicate_files(directory: Path = CATAPULT_DIR) -> list:
    """Exports ignored because another file has the same session."""
    used = set(load_all(directory)["source_file"])
    return sorted(f.name for f in directory.glob("*.csv") if f.name not in used)


def sessions(df: pd.DataFrame) -> pd.DataFrame:
    """Whole-activity rows only (one per player per activity)."""
    return df[df["period"] == "Session"].reset_index(drop=True)
