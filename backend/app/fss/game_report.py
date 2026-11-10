"""Game report from 10Hz data: totals, zones relative to each player's max, and peak windows.

On-field time: OpenField's per-player quarter splits aren't in the API, so we
estimate interchange from the data. A player is on the bench when they're slow
(rolling 60 s mean < 1 m/s) AND near the interchange spot (the place players
stand still most during quarters). Checked against OpenField's minutes for
Rd15 Geelong: within a minute for 82 of 90 player-quarters.

Peak windows use on-field time only, inside a quarter (a window never spans a
quarter break or a stint on the bench).

Definitions were calibrated against OpenField's Rd15 Geelong export (median
player): distance (odometer) 1.000, Player Load 0.999, accels 1.00, decels 1.05,
HSR 0.98, sprint 1.04. Speed-zone distance only counts efforts held for 1 s.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .config import HSR_KMH, SPRINT_KMH

HZ = 10
BENCH_RADIUS_M = 30
BENCH_WINDOW_S = 60
BENCH_SPEED_MS = 1.0
ACCEL_MS2 = 3.0          # accel / decel effort: beyond ±3 m/s²...
ACCEL_MIN_S = 0.3        # ...held for at least 0.3 s (matches OpenField's counts)
BAND_MIN_S = 1.0         # speed-zone distance counts efforts held this long (HSR, sprint, % of max)
EFFORT_MIN_S = 0.5       # a ≥90% effort needs 0.5 s, same as the speed flag
MAX_STEP_M = 1.2         # most a player can cover in 0.1 s
PEAK_WINDOWS = {"30 s": 30, "1 min": 60, "2 min": 120, "3 min": 180, "4 min": 240, "5 min": 300}
# Speed zones: team-wide bands (km/h) and individual bands (fraction of each player's max)
ZONES = {"hsr": ("HSR", HSR_KMH, None), "sprint": ("Sprint", SPRINT_KMH, None),
         "z80": (">80% max", None, 0.8), "z90": (">90% max", None, 0.9)}
PEAK_METRICS = {"m_per_min": "m/min", "hsr_m_per_min": "HSR m/min", "sprint_m_per_min": "Sprint m/min",
                "z80_m_per_min": ">80% max m/min", "z90_m_per_min": ">90% max m/min"}


def _xy(df: pd.DataFrame, lat0: float, lon0: float):
    return (df["long"] - lon0) * 111320 * np.cos(np.radians(lat0)), (df["lat"] - lat0) * 110540


def _bench_spot(q: pd.DataFrame, lat0: float, lon0: float):
    """Where players stand still most during quarters: the interchange."""
    still = q[q["v"] < 0.3]
    x, y = _xy(still, lat0, lon0)
    edges = np.arange(-150, 151, 5)
    h, xe, ye = np.histogram2d(x, y, bins=[edges, edges])
    i, j = np.unravel_index(h.argmax(), h.shape)
    return xe[i] + 2.5, ye[j] + 2.5


def _runs(mask: np.ndarray, min_len: int) -> int:
    """Number of runs of True at least min_len samples long."""
    if not mask.any():
        return 0
    padded = np.concatenate([[0], mask.astype(int), [0]])
    starts, ends = np.flatnonzero(np.diff(padded) == 1), np.flatnonzero(np.diff(padded) == -1)
    return int(((ends - starts) >= min_len).sum())


def _band(kmh: np.ndarray, threshold: float) -> np.ndarray:
    """Samples inside an effort at or above `threshold` that lasts at least BAND_MIN_S."""
    m = kmh >= threshold
    padded = np.concatenate([[0], m.astype(int), [0]])
    starts, ends = np.flatnonzero(np.diff(padded) == 1), np.flatnonzero(np.diff(padded) == -1)
    out = np.zeros(len(m), bool)
    for a, b in zip(starts, ends):
        if b - a >= BAND_MIN_S * HZ:
            out[a:b] = True
    return out


def label_quarters(trace: pd.DataFrame, periods: list) -> pd.DataFrame:
    """Keep samples inside quarters, tagged 1–4, with on-field estimated."""
    d = trace.copy()
    d["quarter"] = 0
    for n, p in enumerate(sorted(periods, key=lambda p: p["start_time"]), start=1):
        d.loc[(d["t"] >= p["start_time"]) & (d["t"] < p["end_time"]), "quarter"] = n
    d = d[d["quarter"] > 0].sort_values(["player", "t"])
    fix = d[(d["lat"].abs() > 1) & (d["long"].abs() > 1)]
    lat0, lon0 = fix["lat"].median(), fix["long"].median()
    bx, by = _bench_spot(fix, lat0, lon0)
    x, y = _xy(d, lat0, lon0)
    has_fix = (d["lat"].abs() > 1) & (d["long"].abs() > 1)
    near_bench = has_fix & (np.hypot(x - bx, y - by) < BENCH_RADIUS_M)
    slow = (d.groupby(["player", "quarter"])["v"]
            .transform(lambda v: v.rolling(BENCH_WINDOW_S * HZ, center=True, min_periods=1).mean()) < BENCH_SPEED_MS)
    d["on_field"] = ~(near_bench & slow)
    return d


def _zone(kmh: np.ndarray, zone: str, mx) -> np.ndarray | None:
    """Samples in a speed zone (efforts held ≥ BAND_MIN_S). None when the zone needs a max we don't have."""
    _, kmh_cut, frac = ZONES[zone]
    if frac is not None:
        if not mx:
            return None
        kmh_cut = frac * mx
    return _band(kmh, kmh_cut)


def _peak(series: np.ndarray, seconds: int) -> float:
    """Best rolling sum over `seconds` (as metres per minute), or NaN if never on for that long."""
    n = seconds * HZ
    if len(series) < n:
        return np.nan
    c = np.concatenate([[0], np.cumsum(series)])
    return float((c[n:] - c[:-n]).max() * 60 / seconds)


def _peak_when(series: np.ndarray, t: np.ndarray, seconds: int):
    n = seconds * HZ
    if len(series) < n:
        return np.nan, None
    c = np.concatenate([[0], np.cumsum(series)])
    sums = c[n:] - c[:-n]
    i = int(sums.argmax())
    return float(sums[i] * 60 / seconds), t[i]


def _metric_series(gq: pd.DataFrame, metric: str, mx):
    """Metres per sample counted by a peak metric, for one player-quarter (None if it needs a missing max)."""
    kmh = gq["v"].to_numpy() * 3.6
    step = gq["v"].to_numpy() / HZ
    if metric == "m_per_min":
        return step
    mask = _zone(kmh, metric.replace("_m_per_min", ""), mx)
    return None if mask is None else step * mask


def player_rows(d: pd.DataFrame, max_kmh: dict) -> pd.DataFrame:
    """One row per player: totals, zones, efforts and peak windows (on-field only)."""
    rows = []
    for player, g in d.groupby("player"):
        on = g[g["on_field"]]
        mx = max_kmh.get(player)
        kmh = on["v"].to_numpy() * 3.6
        step = on["v"].to_numpy() / HZ                      # metres per sample
        contiguous = on["t"].diff() < 1.5 / HZ
        # odometer steps, ignoring jumps when GPS drops out (12 m/s is faster than anyone runs)
        distance = on["o"].diff().where(contiguous & (on["o"].diff() <= MAX_STEP_M)).clip(lower=0).sum()
        minutes = len(on) / HZ / 60
        a = on["a"].to_numpy()
        row = {"player": player, "minutes": minutes, "distance_m": distance,
               "m_per_min": distance / minutes if minutes else np.nan,
               "max_kmh": kmh.max() if len(kmh) else np.nan, "player_max_kmh": mx,
               "pct_max": kmh.max() / mx if mx and len(kmh) else np.nan,
               "accels": _runs(a >= ACCEL_MS2, int(ACCEL_MIN_S * HZ)),
               "decels": _runs(a <= -ACCEL_MS2, int(ACCEL_MIN_S * HZ)),
               "player_load": on["pl"].diff().where(contiguous).clip(lower=0).sum()}
        for zone in ZONES:
            mask = _zone(kmh, zone, mx)
            row[f"{zone}_m"] = (step * mask).sum() if mask is not None else np.nan
            row[f"{zone}_efforts"] = _runs(mask, int(BAND_MIN_S * HZ)) if mask is not None else np.nan
            row[f"{zone}_m_per_min"] = row[f"{zone}_m"] / minutes if minutes else np.nan
        row["efforts_90"] = _runs(kmh >= 0.9 * mx, int(EFFORT_MIN_S * HZ)) if mx else np.nan
        for label, secs in PEAK_WINDOWS.items():
            for metric in PEAK_METRICS:
                # each quarter separately so a window can't span a break
                vals = [_peak(s, secs) for _, gq in on.groupby("quarter")
                        if (s := _metric_series(gq, metric, mx)) is not None]
                row[f"peak_{metric}_{label}"] = np.nanmax(vals) if vals and np.isfinite(vals).any() else np.nan
        rows.append(row)
    return pd.DataFrame(rows).sort_values("distance_m", ascending=False).reset_index(drop=True)


def quarter_rows(d: pd.DataFrame, max_kmh: dict) -> pd.DataFrame:
    """Team totals per quarter (on-field time): distance, m/min and metres in each zone."""
    rows = []
    for q, gq in d[d["on_field"]].groupby("quarter"):
        row = {"quarter": q, "distance_m": 0.0, "samples": len(gq)}
        for zone in ZONES:
            row[f"{zone}_m"] = 0.0
        for player, gp in gq.groupby("player"):
            kmh, step = gp["v"].to_numpy() * 3.6, gp["v"].to_numpy() / HZ
            row["distance_m"] += step.sum()
            for zone in ZONES:
                mask = _zone(kmh, zone, max_kmh.get(player))
                if mask is not None:
                    row[f"{zone}_m"] += (step * mask).sum()
        row["m_per_min"] = row["distance_m"] / (row["samples"] / HZ / 60)
        rows.append(row)
    return pd.DataFrame(rows).set_index("quarter").drop(columns="samples")


def game_peaks(d: pd.DataFrame, max_kmh: dict) -> pd.DataFrame:
    """For each window and metric: the single best player-window of the game, who and when."""
    rows = []
    groups = list(d[d["on_field"]].groupby(["player", "quarter"]))
    for label, secs in PEAK_WINDOWS.items():
        for metric, name in PEAK_METRICS.items():
            best = (np.nan, None, None, None)
            for (player, quarter), gq in groups:
                s = _metric_series(gq, metric, max_kmh.get(player))
                if s is None:
                    continue
                val, t = _peak_when(s, gq["t"].to_numpy(), secs)
                if np.isfinite(val) and not (best[0] >= val):
                    best = (val, player, quarter, t)
            rows.append({"window": label, "metric": name, "key": metric, "value": best[0], "player": best[1],
                         "quarter": best[2], "start_t": best[3]})
    return pd.DataFrame(rows)
