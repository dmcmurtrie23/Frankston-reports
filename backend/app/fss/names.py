"""Player name matching across Catapult ("Taine Barlow"), Excel ("Barlow, Taine")
and the TT history (surname only, or "S. Campbell-Farrell").

Catapult's spelling is the canonical one. Anything else that differs
("Lachie Reidy" vs "Lachlan Reidy") goes in data/config/name_aliases.csv.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Iterable, Optional

import pandas as pd

from .config import CONFIG_DIR


@lru_cache(maxsize=1)
def aliases() -> dict:
    path = CONFIG_DIR / "name_aliases.csv"
    if not path.exists():
        return {}
    df = pd.read_csv(path)
    return dict(zip(df["name"].str.strip(), df["player"].str.strip()))


def canonical(name: str) -> str:
    """'First Last' from 'First Last' or 'Last, First', with aliases applied."""
    name = " ".join(str(name).split())
    if "," in name:
        last, first = [p.strip() for p in name.split(",", 1)]
        name = f"{first} {last}"
    return aliases().get(name, name)


def _surname(full: str) -> str:
    return full.split(" ", 1)[1] if " " in full else full


def match_short_name(short: str, squad: Iterable[str]) -> Optional[str]:
    """Match a surname-only or 'I. Surname' name to one squad member.

    Returns None when there's no match or it's ambiguous (e.g. two Lloyds),
    so it can be resolved with an alias rather than guessed.
    """
    short = " ".join(str(short).split())
    if short in aliases():
        return aliases()[short]
    initial = None
    if "." in short:
        initial, short = [p.strip() for p in short.split(".", 1)]
    hits = [p for p in squad if _surname(p).lower() == short.lower()]
    if initial:
        hits = [p for p in hits if p[0].lower() == initial[0].lower()]
    return hits[0] if len(hits) == 1 else None
