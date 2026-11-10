"""Running Prescription — ported from the Frankston Sport Science app (page "Running Prescription").

Targets for a running session by MAS group or by player: speed, pace, rep and total metres,
with what the session targets (VO2, HR, lactate, neuromuscular). MAS = 2000 m ÷ 2 km time trial;
ASR = max speed − MAS (max speed from Speed Exposure's tested maxes).

Time trials come from the conditioning workbook if it's been added, and/or from the list kept on
this page (sport_science_data/config/time_trials.csv), which wins where both have a player.
"""
from __future__ import annotations

import pandas as pd

from . import this_week
from .fss import catapult_api, conditioning, physiology
from .fss.config import CONFIG_DIR, MAS_GROUPS

TT_FILE = CONFIG_DIR / "time_trials.csv"

PRESETS = {
    "Short HIIT · 2 x 8 x 0:45 @ 97.5% MAS / 0:15": dict(sets=2, reps=8, work_s=45, rest_s=15, intensity=0.975),
    "Short CoD HIIT · 2 x 8 x 0:45 + 1 CoD @ 97.5% / 0:15": dict(sets=2, reps=8, work_s=45, rest_s=15, intensity=0.975, cod=1),
    "Short aerobic 15:15 · 2 x 12 @ 100% MAS": dict(sets=2, reps=12, work_s=15, rest_s=15, intensity=1.0),
    "Long HIIT · 4 x 4:00 @ 92.5% MAS / 2:00": dict(sets=1, reps=4, work_s=240, rest_s=120, intensity=0.925),
    "Long HIIT · 2 x 5 x 2:00 @ 92.5% MAS / 1:00": dict(sets=2, reps=5, work_s=120, rest_s=60, intensity=0.925),
    "Supramaximal 15:15 · 2 x 10 @ MAS + 20% ASR": dict(sets=2, reps=10, work_s=15, rest_s=15, intensity=0.20, basis="ASR"),
    "Supramaximal 15s @ MAS + 35% ASR / 0:45": dict(sets=1, reps=10, work_s=15, rest_s=45, intensity=0.35, basis="ASR"),
    "Tempo · 2 x 10 x 0:30 @ 80% MAS / 0:30": dict(sets=2, reps=10, work_s=30, rest_s=30, intensity=0.80),
    "Repeated sprint · 2 x 6 x 0:05 @ 90% max / 0:25": dict(sets=2, reps=6, work_s=5, rest_s=25, intensity=0.90, basis="MaxV"),
    "Speed · 6 x 0:06 @ 95% max / 2:00": dict(sets=1, reps=6, work_s=6, rest_s=120, intensity=0.95, basis="MaxV"),
    "3 min effort @ 95% MAS": dict(sets=1, reps=1, work_s=180, rest_s=0, intensity=0.95),
    "Custom": dict(sets=2, reps=8, work_s=30, rest_s=30, intensity=1.0),
}


def _parse_tt(v):
    """'7:05', '7:05.3' or seconds -> seconds."""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = str(v).strip()
    if not s:
        return None
    try:
        if ":" in s:
            m, sec = s.split(":", 1)
            return int(m) * 60 + float(sec)
        return float(s)
    except ValueError:
        return None


def load_tt() -> pd.DataFrame:
    if not TT_FILE.exists():
        return pd.DataFrame(columns=["player", "tt_2k", "date"])
    return pd.read_csv(TT_FILE, dtype=str, keep_default_na=False)


def save_tt(rows: list) -> dict:
    df = pd.DataFrame(rows, columns=["player", "tt_2k", "date"]).fillna("")
    df = df[df["player"].str.strip() != ""]
    TT_FILE.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(TT_FILE, index=False)
    return runners_payload()


def _runners():
    players, maxes = [], pd.DataFrame(columns=["player", "max_kmh", "provisional"])
    if not catapult_api.load_speed().empty:
        _, players, maxes, _, _ = this_week._load()
    tt = {}
    src = {}
    for p, (secs, source) in this_week.time_trials(players).items():   # conditioning workbook, if added
        tt[p], src[p] = secs, source
    for _, r in load_tt().iterrows():
        secs = _parse_tt(r["tt_2k"])
        if secs:
            tt[r["player"]], src[r["player"]] = secs, f"time trial{(' ' + r['date']) if r['date'] else ''}"
    mx = maxes.set_index("player") if len(maxes) else pd.DataFrame(columns=["max_kmh", "provisional"])
    rows = []
    for p, secs in tt.items():
        prov = bool(mx["provisional"].get(p, False)) if len(mx) else False
        max_kmh = None if prov or not len(mx) else mx["max_kmh"].get(p)
        mas = 2000 / secs
        rows.append({"player": p, "tt_2k_s": secs, "tt_source": src[p], "mas": mas,
                     "max_kmh": None if max_kmh is None or pd.isna(max_kmh) else float(max_kmh),
                     "asr": None if max_kmh is None or pd.isna(max_kmh) else conditioning.asr(max_kmh, mas),
                     "group": conditioning.nearest_group(mas, MAS_GROUPS)})
    return pd.DataFrame(rows, columns=["player", "tt_2k_s", "tt_source", "mas", "max_kmh", "asr", "group"]), sorted(players)


def runners_payload() -> dict:
    r, players = _runners()
    return this_week._clean({"presets": PRESETS, "groups": MAS_GROUPS, "players": players,
                             "time_trials": load_tt().to_dict(orient="records"),
                             "runners": r.sort_values("mas", ascending=False).to_dict(orient="records")})


def prescribe(p: dict, mode: str = "MAS Group", round_to: int = 1) -> dict:
    runners, _ = _runners()
    if runners.empty:
        return {"empty": True}
    session = conditioning.Session(sets=int(p["sets"]), reps=int(p["reps"]), work_s=float(p["work_s"]),
                                   rest_s=float(p["rest_s"]), intensity=float(p["intensity"]),
                                   basis=p.get("basis", "MAS"), cod=int(p.get("cod", 0)))
    med_mas = runners["mas"].median()
    med_asr = runners["asr"].median() if runners["asr"].notna().any() else 3.8
    target = physiology.classify(session, med_mas, med_asr)
    first = conditioning.prescribe(session, med_mas, med_asr)
    tiles = [{"label": "VO2", "value": target.vo2}, {"label": "Heart rate", "value": target.hr},
             {"label": "Lactate", "value": target.lactate}, {"label": "Neuromuscular", "value": target.neuromuscular},
             {"label": "Session", "value": first["session_min"], "unit": "min"}]
    if target.session_type in ("Long HIIT", "Short aerobic HIIT", "Short supramaximal HIIT"):
        tiles.append({"label": "Near VO2max", "value": first["time_at_vo2max_min"], "unit": "min", "sub": "est. 35% of session"})
    warning = None
    if session.basis == "MAS" and session.intensity > 1.0 and runners["asr"].notna().any():
        eq = (session.intensity - 1) * med_mas / med_asr
        warning = (f"This is above MAS. Prescribing it as MAS + {eq:.0%} ASR accounts for each player's top speed. "
                   "Switch Basis to MAS + % ASR.")

    rows, note = [], None
    if mode == "MAS Group":
        for g in MAS_GROUPS:
            members = runners[runners["group"] == g]
            g_asr = members["asr"].median() if session.basis != "MAS" else None
            if session.basis != "MAS" and (g_asr is None or pd.isna(g_asr)):
                continue
            out = conditioning.prescribe(session, g, g_asr, round_to=round_to)
            row = {"group": g, "group_asr": None if g_asr is None else round(g_asr, 2), "kmh": out["speed_kmh"],
                   "pace": out["pace_min_km"], "rep_m": out["rep_m"], "shuttle_m": out["shuttle_m"] if session.cod else None,
                   "total_m": out["total_m"], "players": len(members), "who": ", ".join(members["player"])}
            rows.append(row)
        if session.basis != "MAS":
            note = "Group targets use the group's median ASR. Switch to Player for exact individual targets."
    else:
        for _, r in runners.sort_values("mas", ascending=False).iterrows():
            if session.basis != "MAS" and r["asr"] is None:
                continue
            out = conditioning.prescribe(session, r["mas"], r["asr"], round_to=round_to)
            rows.append({"player": r["player"], "mas": round(r["mas"], 2),
                         "asr": None if r["asr"] is None else round(r["asr"], 2), "group": r["group"],
                         "kmh": out["speed_kmh"], "pace": out["pace_min_km"],
                         "pct_max": None if r["max_kmh"] is None else round(out["speed_kmh"] / r["max_kmh"] * 100),
                         "rep_m": out["rep_m"], "shuttle_m": out["shuttle_m"] if session.cod else None,
                         "total_m": out["total_m"]})
    return this_week._clean({
        "empty": False, "label": session.label,
        "target": {"type": target.session_type, "objective": target.objective, "notes": target.notes,
                   "source": target.source},
        "tiles": tiles, "warning": warning, "rows": rows, "note": note, "basis": session.basis,
        "cod": session.cod, "runners": len(runners),
    })
