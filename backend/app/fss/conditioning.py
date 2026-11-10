"""MAS / ASR running prescription, matching the logic in the conditioning workbook."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .config import COD_COST, TIME_AT_VO2MAX_FRACTION


def mas(tt_2k_seconds: float) -> float:
    """Maximal aerobic speed (m/s) from a 2km time trial."""
    return 2000 / tt_2k_seconds


def asr(max_velocity_kmh: float, mas_ms: float) -> float:
    """Anaerobic speed reserve (m/s): max speed minus MAS."""
    return max_velocity_kmh / 3.6 - mas_ms


def pace_min_per_km(speed_ms: float) -> str:
    secs = 1000 / speed_ms
    return f"{int(secs // 60)}:{secs % 60:04.1f}"


@dataclass
class Session:
    """e.g. 2 sets of 8 x 0:45 @ 97.5% MAS w/ 0:15 rest, 1 CoD over 2 shuttles."""
    sets: int
    reps: int
    work_s: float
    rest_s: float
    intensity: float               # 0.975 = 97.5%
    basis: str = "MAS"             # "MAS" (x% of MAS), "ASR" (MAS + x% of ASR) or "MaxV" (x% of max speed)
    cod: int = 0                   # changes of direction per rep
    shuttles: Optional[int] = None  # defaults to cod + 1

    @property
    def label(self) -> str:
        pct = f"{self.intensity * 100:g}%"
        target = {"MAS": f"{pct} MAS", "ASR": f"MAS + {pct} ASR", "MaxV": f"{pct} max speed"}[self.basis]
        cod = f" + {self.cod} CoD" if self.cod else ""
        return f"{self.sets} x {self.reps} x {self.work_s:g}s{cod} @ {target} w/ {self.rest_s:g}s rest"


def prescribe(session: Session, mas_ms: float, asr_ms: Optional[float] = None,
              round_to: float = 1) -> dict:
    """Targets for one runner (or one MAS group) for a session."""
    if session.basis in ("ASR", "MaxV") and asr_ms is None:
        raise ValueError(f"{session.basis}-based sessions need the player's max velocity")
    if session.basis == "ASR":
        speed = mas_ms + session.intensity * asr_ms
    elif session.basis == "MaxV":
        speed = session.intensity * (mas_ms + asr_ms)
    else:
        speed = mas_ms * session.intensity
    # Each change of direction costs 0.7 m per m/s of MAS (conditioning workbook)
    rep_m = max(0.0, speed * session.work_s - COD_COST * session.cod * mas_ms)
    shuttles = session.shuttles or session.cod + 1
    total_s = session.sets * session.reps * (session.work_s + session.rest_s)

    def rnd(x):
        return round(x / round_to) * round_to if round_to else x

    return {
        "speed_ms": round(speed, 2),
        "speed_kmh": round(speed * 3.6, 1),
        "pace_min_km": pace_min_per_km(speed),
        "rep_m": rnd(rep_m),
        "shuttle_m": rnd(rep_m / shuttles),
        "total_m": rnd(rep_m * session.sets * session.reps),
        "session_min": round(total_s / 60, 1),
        "time_at_vo2max_min": round(total_s * TIME_AT_VO2MAX_FRACTION / 60, 1),
    }


def nearest_group(mas_ms: float, groups: list) -> float:
    """The MAS group a player runs in: the closest group speed."""
    return min(groups, key=lambda g: abs(g - mas_ms))
