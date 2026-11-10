"""Rehab — ported from the Frankston Sport Science app (fss/rehab.py, page "Rehab").

The medical team keeps the rehab list (player, stage, injury, dates, notes, active) in
sport_science_data/config/rehab.csv, edited on the page. Everything else comes from the
pulled Catapult 10Hz summaries: each rehab player's best session in the last 14 days
against their average and peak game.
"""
from __future__ import annotations

from datetime import date

import pandas as pd

from . import this_week
from .fss import catapult_api, rehab
from .fss import load as weekload

RETURN_WHY = ("Last season the first week back was where load jumped most: several players did 2 to 4 times "
              "their usual sprint distance. Plan the first two weeks at or under their usual week from before the time out.")


def _num(v, unit):
    if v is None or pd.isna(v):
        return "–"
    return f"{v:.1f}" if unit == "km/h" else f"{v:,.0f}"


def build() -> dict:
    rl = rehab.load_list()
    if catapult_api.load_speed().empty:
        players, load_sess, mxs = [], pd.DataFrame(), {}
        today = date.today()
    else:
        _, players, maxes, _, load_sess = this_week._load()
        today = load_sess["date"].max() if not load_sess.empty else date.today()
        mxs = maxes[~maxes["provisional"]].set_index("player")["max_kmh"].to_dict()
    players = sorted(set(players) | set(rl["player"].dropna().astype(str)) - {""})

    active = rl[rl["active"] == True]  # noqa: E712
    order = {s: i for i, s in enumerate(rehab.STAGES)}
    cards = []
    w = weekload.weekly(load_sess) if not load_sess.empty else pd.DataFrame()
    for _, r in active.sort_values("stage", key=lambda c: c.map(order)).iterrows():
        sub = []
        if pd.notna(r["start_date"]):
            sub.append(f"Day {(today - r['start_date']).days + 1}")
        if pd.notna(r["target_date"]):
            sub.append(f"target {r['target_date']:%a %d %b} ({(r['target_date'] - today).days} days)")
        if r["injury"]:
            sub.append(r["injury"])
        card = {"player": r["player"], "stage": r["stage"], "stage_index": order.get(r["stage"], 0),
                "notes": r["notes"] or None, "bars": [], "checks": [], "sessions": [], "next_step": None, "caution": None}
        if not load_sess.empty:
            pr = rehab.progress(load_sess, r["player"], today, mxs.get(r["player"]))
            t = pr["table"]
            card["bars"] = [{"label": row["label"],
                             "best": _num(row["best"], row["unit"]), "average": _num(row["average"], row["unit"]),
                             "unit": row["unit"], "pct": row["pct_avg"],
                             "peak_ratio": (row["peak"] / row["average"]) if row["average"] else None}
                            for _, row in t.iterrows()]
            card["checks"] = [{"label": k, "ok": v} for k, v in pr["checks"].items()]
            n_s = len(pr["sessions"])
            sub.append(f"{n_s} session{'' if n_s == 1 else 's'} in the last {rehab.RECENT_DAYS} days")
            sub.append("vs own games" if pr["own_games"] else "vs squad games (fewer than 3 of their own)")
            gaps = pr["gaps"].sort_values("pct_avg")
            card["next_step"] = ("Next to build: " + ", ".join(
                f"{g['label']} ({g['pct_avg']:.0%} of a game)" if pd.notna(g["pct_avg"]) else f"{g['label']} (no data yet)"
                for _, g in gaps.head(3).iterrows()) + ".") if not gaps.empty else \
                "At or above average game demands on every measure."
            ss = pr["sessions"]
            card["sessions"] = [{"date": s["date"], "session": s["activity"], "distance_m": s["distance_m"],
                                 "hsr_m": s["hsr_m"], "sprint_m": s["sprint_m"], "z80_m": s["z80_m"],
                                 "top_kmh": s["top_kmh"], "peak_mpm_60s": s["peak_mpm_60s"],
                                 "accels": s["accels"], "decels": s["decels"]} for _, s in ss.iterrows()]
        else:
            sub.append("no GPS data pulled yet")
        if rehab.near_return(r, today):
            usual = (weekload.usual_week(w, r["player"], r["start_date"] if pd.notna(r["start_date"]) else today)
                     if not w.empty else {})
            lims = []
            for m in ("hsr_m", "sprint_m", "z80_m", "accels", "decels"):
                v = usual.get(m)
                if v is not None and pd.notna(v):
                    unit = weekload.UNITS[m]
                    lims.append({"label": weekload.METRICS[m],
                                 "value": f"≤ {v * weekload.RETURN_CEILING:,.0f}{' ' + unit if unit else ''} a week"})
            card["caution"] = {"heading": "Return week coming up",
                               "body": RETURN_WHY + (" Their usual week before this rehab:" if usual
                                                     else " There's no usual week on record for them yet."),
                               "limits": lims}
        card["sub"] = " · ".join(sub)
        cards.append(card)

    rows = [{**r, "start_date": r["start_date"] if pd.notna(r["start_date"]) else None,
             "target_date": r["target_date"] if pd.notna(r["target_date"]) else None,
             "active": bool(r["active"])} for r in rl.fillna("").to_dict(orient="records")]
    return this_week._clean({"today": today, "stages": rehab.STAGES, "players": players, "list": rows,
                             "cards": cards, "recent_days": rehab.RECENT_DAYS})


def save(rows: list) -> dict:
    df = pd.DataFrame(rows, columns=rehab.FIELDS)
    rehab.REHAB_FILE.parent.mkdir(parents=True, exist_ok=True)
    rehab.save_list(df)
    return build()
