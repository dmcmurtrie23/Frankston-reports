"""The training calendar in data/config/calendar.csv."""
from __future__ import annotations

from pathlib import Path

import pandas as pd

from .config import CONFIG_DIR

CALENDAR = CONFIG_DIR / "calendar.csv"


def load(path: Path = CALENDAR) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame(columns=["date", "day", "week", "block", "session", "confirmed", "testing", "notes"])
    df = pd.read_csv(path, dtype=str).fillna("")
    df["date"] = pd.to_datetime(df["date"]).dt.date
    return df


def missing_uploads(calendar: pd.DataFrame, gps_dates: set, as_of) -> list:
    """Scheduled sessions that have happened but have no GPS export yet."""
    past = calendar[(calendar["date"] <= as_of) & (calendar["session"] != "")]
    return [d for d in past["date"] if d not in gps_dates]
