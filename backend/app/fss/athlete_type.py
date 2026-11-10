"""Where a player sits on the speed–endurance spectrum, relative to this squad.

Uses MAS (aerobic engine) and max velocity (top speed). Their gap is ASR, and
max speed ÷ MAS is the speed reserve ratio: high = speed type, low = endurance type.
Types are relative to the squad's medians, not fixed cut-offs.
"""
from __future__ import annotations

import pandas as pd

from . import conditioning
from .config import MAS_GROUPS

TYPES = {
    (True, False): ("Speed type", "Big top speed, smaller aerobic engine."),
    (False, True): ("Endurance type", "Big aerobic engine, less top-end speed."),
    (True, True): ("All-rounder", "Above the squad for both speed and aerobic engine."),
    (False, False): ("Developing", "Below the squad median for both. Room to build each."),
}


def squad_table(roster: pd.DataFrame) -> pd.DataFrame:
    """MAS, max speed, ASR and speed reserve ratio for players with both tests."""
    r = roster.dropna(subset=["tt_2k_s", "max_kmh"]).copy()
    r["mas"] = 2000 / r["tt_2k_s"]
    r["mv"] = r["max_kmh"] / 3.6
    r["asr"] = r["mv"] - r["mas"]
    r["srr"] = r["mv"] / r["mas"]
    return r.reset_index(drop=True)


def classify(table: pd.DataFrame, player: str) -> dict:
    if player not in set(table["player"]):
        return {}
    me = table[table["player"] == player].iloc[0]
    med = table[["mas", "mv", "asr", "srr"]].median()
    rank = {c: int(round((table[c] < me[c]).mean() * 100)) for c in ("mas", "mv", "asr", "srr")}
    name, blurb = TYPES[(me["mv"] >= med["mv"], me["mas"] >= med["mas"])]

    focus = []
    if me["mas"] < med["mas"]:
        focus.append(("Build the engine",
                      f"MAS {me['mas']:.2f} m/s is below the squad's {med['mas']:.2f}. Prioritise long and short "
                      "aerobic HIIT at or just under MAS. It's the biggest lever for repeat efforts and late-game output."))
    if me["asr"] >= med["asr"]:
        focus.append(("Prescribe above-MAS work by ASR",
                      f"ASR {me['asr']:.2f} m/s is larger than most. A % of MAS above 100% under-loads them, "
                      "so use MAS + % ASR for supramaximal running."))
    if me["mv"] >= med["mv"]:
        focus.append(("Protect the top speed",
                      "Keep regular ≥90% exposures and hamstring robustness work. Speed is their weapon."))
    else:
        focus.append(("Develop top speed",
                      f"Max speed {me['max_kmh']:.1f} km/h is below the squad's {med['mv'] * 3.6:.1f}. "
                      "Acceleration and max-velocity work will lift their ASR."))
    if me["mas"] >= med["mas"] and me["mv"] < med["mv"]:
        focus.append(("Use the engine", "Can carry high running volumes. Recovers well between efforts."))

    return {"player": player, "type": name, "blurb": blurb, "me": me, "median": med, "rank": rank,
            "group": conditioning.nearest_group(me["mas"], MAS_GROUPS), "focus": focus[:3]}
