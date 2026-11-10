"""Load player testing data from the conditioning workbook."""
from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Iterable

import openpyxl
import pandas as pd

from .config import CONDITIONING_WORKBOOK
from .names import canonical, match_short_name


def load_master(path: Path = CONDITIONING_WORKBOOK) -> pd.DataFrame:
    """MASTER2: one row per player with 2km TT, max velocity and group."""
    ws = openpyxl.load_workbook(path, data_only=True)["MASTER2"]
    rows = list(ws.iter_rows(values_only=True))
    header = rows[0]
    df = pd.DataFrame([r for r in rows[1:] if r[0]], columns=header)
    out = pd.DataFrame({
        "player": df["ATHLETE"].map(canonical),
        "tt_2k_s": pd.to_numeric(df["2KM TT (s)"], errors="coerce"),
        "master_max_kmh": pd.to_numeric(df["MV (KM/HR)"], errors="coerce"),
        "master_group": pd.to_numeric(df["Column1"], errors="coerce"),
    })
    return out.reset_index(drop=True)


_DATE = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{2,4})")


def load_tt_history(squad: Iterable[str], path: Path = CONDITIONING_WORKBOOK) -> pd.DataFrame:
    """TT Comparisons: every 2km time trial, matched to full player names.

    Rows that can't be matched to one player keep their short name and get
    matched=False so they can be fixed in data/config/name_aliases.csv.
    """
    ws = openpyxl.load_workbook(path, data_only=True)["TT Comparisons"]
    squad = list(squad)
    tests = []  # (column index of seconds, label, date)
    for cell in ws[1]:
        if cell.value:
            m = _DATE.search(str(cell.value))
            d, mth, y = (int(x) for x in m.groups())
            y = y + 2000 if y < 100 else y
            tests.append((cell.column, str(cell.value).strip(), datetime(y, mth, d).date()))

    records = []
    for r in range(3, ws.max_row + 1):
        short = ws.cell(r, 1).value
        if not short or str(short).strip().upper() == "AVERAGE":
            continue
        short = str(short).strip()
        player = match_short_name(short, squad)
        for col, label, date in tests:
            secs = ws.cell(r, col).value
            if isinstance(secs, (int, float)) and secs > 0:
                records.append({
                    "player": player or short,
                    "matched": player is not None,
                    "test": label,
                    "date": date,
                    "tt_2k_s": float(secs),
                    "mas": 2000 / float(secs),
                })
    return pd.DataFrame(records)

