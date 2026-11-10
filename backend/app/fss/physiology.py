"""What a running session is targeting.

The HIIT types and their expected responses come from the Conditioning
Overview sheet. Speed, repeated-sprint and tempo types aren't in the workbook;
they and the neuromuscular ratings follow Buchheit & Laursen (2013), and the
thresholds are ours to tune.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

from .conditioning import Session

WORKBOOK = "your Conditioning Overview sheet"
ADDED = "added (not in the workbook), based on Buchheit & Laursen 2013"
NM_LEVELS = ["Low", "Moderate", "Moderate–high", "High", "Very high"]


@dataclass
class Target:
    session_type: str
    objective: str
    vo2: str
    hr: str
    lactate: str
    neuromuscular: str
    source: str = WORKBOOK
    notes: List[str] = field(default_factory=list)


def relative_speed(session: Session, mas: float, asr: float) -> tuple:
    """(fraction of MAS, fraction of max speed) the session runs at."""
    max_speed = mas + asr
    if session.basis == "ASR":
        speed = mas + session.intensity * asr
    elif session.basis == "MaxV":
        speed = session.intensity * max_speed
    else:
        speed = session.intensity * mas
    return speed / mas, speed / max_speed


def classify(session: Session, typical_mas: float = 4.9, typical_asr: float = 3.8) -> Target:
    """Match a session to a type, using a typical squad player's MAS and ASR."""
    rel, pct_max = relative_speed(session, typical_mas, typical_asr)
    work, rest = session.work_s, session.rest_s
    ratio = f"{work / rest:.2g}:1" if rest else "continuous"

    if work <= 10 and pct_max >= 0.85:
        if rest >= 60:
            t = Target("Speed / max velocity",
                       "Develop top speed and keep players exposed to ≥90% of their max. Near-full recovery.",
                       "Low", "Low–moderate", "Low", "Very high", ADDED)
        else:
            t = Target("Repeated sprint",
                       "Repeat near-max efforts with incomplete recovery, like a passage of play.",
                       "Moderate–high", "High", "High", "High", ADDED)
    elif work >= 60 and rel <= 1.0:
        t = Target("Long HIIT", "Increase VO2max. Run below MAS, work:rest 1.5:1 to 2:1.",
                   "High", "High", "Moderate", "Low")
    elif rel < 0.9:
        t = Target("Tempo / aerobic",
                   "Build aerobic volume at low cost. Run below 90% MAS.",
                   "Moderate", "Moderate–high", "Low", "Low", ADDED)
    elif work <= 60 and rel <= 1.05:
        t = Target("Short aerobic HIIT", "Increase VO2max. Run at 95–105% MAS, work:rest 3:1 to 2:1.",
                   "High", "High", "Moderate–high", "Moderate")
    elif work <= 30:
        t = Target("Short supramaximal HIIT",
                   "Increase VO2max with repeated accelerations. Run above MAS, work:rest 1:1 or more rest.",
                   "Moderate–high", "Moderate–high", "High", "Moderate–high")
    else:
        t = Target("Doesn't match a type", "Check the intent of this session.",
                   "—", "—", "—", "—", source="estimate")

    t.notes.append(f"Runs at about {rel:.0%} of MAS and {pct_max:.0%} of max speed, work:rest {ratio}.")
    if session.cod and t.neuromuscular in NM_LEVELS:
        t.neuromuscular = NM_LEVELS[min(NM_LEVELS.index(t.neuromuscular) + 1, len(NM_LEVELS) - 1)]
        t.notes.append(f"{session.cod} change(s) of direction per rep add accel/decel load, "
                       "so neuromuscular load is one step higher.")
    if pct_max >= 0.9:
        t.notes.append("At ≥90% of max speed, this counts towards each player's speed exposure.")
    if work >= 60 and rel > 1.0:
        t.notes.append("Long reps above MAS are very hard to sustain. Check this is intended.")
    return t
