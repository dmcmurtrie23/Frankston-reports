"""Player Profile — ported from the Frankston Sport Science app (page "Player Profile").

Jordan's version reads games from OpenField CSV exports. Here games come from the pulled
Catapult 10Hz summaries (same data as This Week), so:
- game rows are activities named like a round or final (Rd…, Wildcard, Final, Elim, Prelim,
  Semi, Qual) — the same rule as his profiles.games();
- minutes / m/min aren't shown, because the API recording runs for the whole session
  (warm-up and breaks included), which would make per-minute numbers far too low;
- quarter splits come from the Game Report tab (full 10Hz per game) instead.
The physiological profile (MAS, ASR, speed–endurance type) needs the conditioning
workbook, so it only shows once that's been added.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import game_summaries, this_week
from .fss import athlete_type, catapult_api, conditioning, trends
from .fss.config import MAS_GROUPS, MAX_PLAUSIBLE_KMH

GAME_NAME = r"^\s*(?:Rd|Round|Wildcard|Final|Elim|Prelim|Semi|Qual)"
FULL_METRICS = [  # Jordan's profile metrics, once games have been worked out from full 10Hz
    ("minutes", "Minutes on ground", 0),
    ("distance_m", "Total distance (m)", 0),
    ("m_per_min", "m/min", 1),
    ("hsr_m", "High-speed running (m)", 0),
    ("hsr_m_per_min", "HSR m/min", 1),
    ("sprint_m", "Sprint distance (m)", 0),
    ("sprint_efforts", "Sprint efforts", 1),
    ("z80_m", "Above 80% of max (m)", 0),
    ("accel_decel", "Accels + decels", 0),
    ("player_load", "PlayerLoad", 0),
    ("max_velocity_kmh", "Max velocity (km/h)", 1),
]
METRICS = [  # (column, label, decimals) — summaries only
    ("distance_m", "Total distance (m)", 0),
    ("hsr_m", "High-speed running (m)", 0),
    ("sprint_m", "Sprint distance (m)", 0),
    ("z80_m", "Above 80% of max (m)", 0),
    ("accel_decel", "Accels + decels", 0),
    ("max_velocity_kmh", "Max velocity (km/h)", 1),
]
LABELS = {c: l for c, l, _ in METRICS}
PART_GAME = 0.6


def _games(load_sess: pd.DataFrame) -> pd.DataFrame:
    g = load_sess[load_sess["activity"].astype(str).str.contains(GAME_NAME, case=False, regex=True)].copy()
    g["max_velocity_kmh"] = g["top_500ms_kmh"]          # held 0.5 s, same rule as the speed flag
    g = g[(g["max_velocity_kmh"] <= MAX_PLAUSIBLE_KMH) & (g["distance_m"] > 0)]
    g["accel_decel"] = g["accels"] + g["decels"]
    g["activity"] = g["activity"].astype(str).str.strip()
    g["activity_id"] = g["activity_id"].astype(str)
    # On-field numbers from the full 10Hz, where that game has been worked out
    full = game_summaries.load_players()
    if len(full):
        cols = ["minutes", "distance_m", "m_per_min", "hsr_m", "hsr_m_per_min", "sprint_m", "sprint_efforts",
                "accels", "decels", "player_load"]
        g = g.drop(columns=[c for c in ("minutes", "m_per_min", "hsr_m_per_min", "sprint_efforts", "player_load")
                            if c in g.columns])
        g = g.merge(full[["activity_id", "player", *cols]].rename(columns={c: f"_f_{c}" for c in cols}),
                    on=["activity_id", "player"], how="left")
        for c in cols:
            if c in g.columns:
                g[c] = g[f"_f_{c}"].where(g[f"_f_{c}"].notna(), g[c])
            else:
                g[c] = g[f"_f_{c}"]
        g = g.drop(columns=[f"_f_{c}" for c in cols])
        g["accel_decel"] = g["accels"] + g["decels"]
    return g


def _master():
    try:
        from .fss import squad
        return squad.load_master()
    except Exception:  # noqa: BLE001
        return pd.DataFrame(columns=["player", "tt_2k_s", "master_max_kmh", "master_group"])


def build(player: str | None = None) -> dict:
    if catapult_api.load_speed().empty:
        return {"empty": True}
    _, players, maxes, _, load_sess = this_week._load()
    games = _games(load_sess)
    counts = games.groupby("player")["date"].nunique()
    order = sorted(players, key=lambda p: (-counts.get(p, 0), p.split(" ", 1)[-1]))
    player = player if player in order else (order[0] if order else None)
    full = game_summaries.load_players()
    use_full = len(full) > 0
    metrics = FULL_METRICS if use_full else METRICS
    labels = {c: l for c, l, _ in metrics}
    out = {"empty": False, "full_games": int(full["activity_id"].nunique()) if use_full else 0,
           "total_games": int(games["activity_id"].nunique()), "players": [{"name": p, "games": int(counts.get(p, 0))} for p in order], "player": player}
    if not player:
        return this_week._clean(out)

    mx = maxes.set_index("player")
    has_max = player in mx.index and pd.notna(mx.loc[player, "max_kmh"])
    master = _master()
    m = master[master["player"] == player]
    tt_s = this_week.time_trials([player]).get(player, (None, None))[0]

    tiles = []
    mine = games[games["player"] == player].sort_values("date")
    tiles.append({"label": "Games", "value": len(mine), "unit": "", "sub": "with GPS"})
    if has_max:
        tiles.append({"label": "Max velocity", "value": f"{mx.loc[player, 'max_kmh']:.2f}", "unit": "km/h",
                      "sub": mx.loc[player, "source"]})
    if tt_s is not None and pd.notna(tt_s):
        mas_ms = 2000 / tt_s
        tiles.append({"label": "MAS", "value": f"{mas_ms:.2f}", "unit": "m/s", "sub": f"2km TT {int(tt_s // 60)}:{int(tt_s % 60):02d}"})
        if has_max and not mx.loc[player, "provisional"]:
            tiles.append({"label": "ASR", "value": f"{conditioning.asr(mx.loc[player, 'max_kmh'], mas_ms):.2f}",
                          "unit": "m/s", "sub": "max speed − MAS"})
        tiles.append({"label": "Running group", "value": conditioning.nearest_group(mas_ms, MAS_GROUPS), "unit": "m/s", "sub": ""})
    out["tiles"] = tiles

    # ---- weekly trends (every metric x window, so the page can switch instantly)
    as_of = load_sess["date"].max()
    w = trends.weekly(load_sess, as_of)
    tr = {}
    for metric in trends.METRICS:
        tr[metric] = {}
        for weeks in trends.WINDOWS:
            win = trends.window(w, player, metric, weeks, as_of).reset_index(drop=True)
            fit = trends.fit(win)
            tr[metric][str(weeks)] = {
                "rows": [{"week": r["week"], "value": r["value"], "sessions": r["sessions"],
                          "team_sessions": r["team_sessions"], "squad": r["squad"], "partial": bool(r["partial"])}
                         for _, r in win.iterrows()],
                "fit": {k: fit.get(k) for k in ("ok", "points", "per_week", "direction", "x", "y")},
            }
    out["trends"] = tr
    out["trend_metrics"] = {k: {"label": v[0], "unit": v[1]} for k, v in trends.METRICS.items()}
    out["trend_windows"] = trends.WINDOWS
    out["min_points"] = trends.MIN_POINTS

    # ---- physiological profile (needs the conditioning workbook)
    out["physiology"] = None
    if not master.empty:
        tts = this_week.time_trials(players)
        roster = pd.DataFrame([{"player": p, "tt_2k_s": tts.get(p, (None, None))[0],
                                "max_kmh": None if bool(mx["provisional"].get(p, False)) else mx["max_kmh"].get(p)}
                               for p in players])
        table = athlete_type.squad_table(roster)
        phys = athlete_type.classify(table, player)
        if phys:
            me, med, rk = phys["me"], phys["median"], phys["rank"]
            out["physiology"] = {
                "type": phys["type"], "blurb": phys["blurb"],
                "tiles": [
                    {"label": "MAS", "value": f"{me['mas']:.2f}", "unit": "m/s", "sub": f"faster than {rk['mas']}% of squad"},
                    {"label": "Max speed", "value": f"{me['max_kmh']:.1f}", "unit": "km/h", "sub": f"faster than {rk['mv']}% of squad"},
                    {"label": "ASR", "value": f"{me['asr']:.2f}", "unit": "m/s", "sub": f"bigger than {rk['asr']}% of squad"},
                    {"label": "Speed reserve", "value": f"{me['srr']:.2f}", "unit": "×", "sub": f"squad median {med['srr']:.2f}"},
                ],
                "focus": [{"who": t, "meta": d, "tone": "red"} for t, d in phys["focus"]],
                "points": [{"label": r["player"], "x": r["mas"], "y": r["max_kmh"]} for _, r in table.iterrows()],
                "median": {"mas": med["mas"], "max_kmh": med["mv"] * 3.6},
            }

    # ---- games
    out["games"] = None
    if len(mine):
        squad = games[[c for c, _, _ in metrics]].mean(numeric_only=True)
        rows = []
        for col, label, dp in metrics:
            vals = mine[col]
            if vals.notna().sum() == 0:
                rows.append({"metric": label, "average": None, "squad": round(squad[col], dp) if pd.notna(squad[col]) else None,
                             "vs_squad": "", "highest": None, "highest_in": "–"})
                continue
            best = mine.loc[vals.idxmax()]
            avg = vals.mean()
            rows.append({"metric": label, "average": round(avg, dp), "squad": round(squad[col], dp),
                         "vs_squad": f"{(avg / squad[col] - 1) * 100:+.0f}%" if squad[col] else "",
                         "highest": round(best[col], dp), "highest_in": f"{best['activity']} ({best['date']:%d %b})"})
        worst = mine.loc[mine["hsr_m"].idxmax()]
        med_d = mine["distance_m"].median()
        flags = [{"who": g["activity"], "meta": f"{g['distance_m']:,.0f} m, under {PART_GAME:.0%} of their usual game "
                  "(subbed off, injured or a short stint), so it pulls their averages down.", "tone": "warn"}
                 for _, g in mine.iterrows() if med_d and g["distance_m"] < PART_GAME * med_d]
        if has_max and not mx.loc[player, "provisional"]:
            n90 = int((mine["max_velocity_kmh"] >= 0.9 * mx.loc[player, "max_kmh"]).sum())
        else:
            n90 = None
        out["games"] = {
            "count": len(mine),
            "table": rows,
            "squad_avg": {c: games[c].mean() for c, _, _ in metrics},
            "by_game": [{"activity": g["activity"], "date": g["date"], **{c: g[c] for c, _, _ in metrics}}
                        for _, g in mine.iterrows()],
            "worst": {"activity": worst["activity"], "date": worst["date"],
                      "rows": [{"metric": labels[c], "worst": round(worst[c], dp) if pd.notna(worst[c]) else None,
                                "average": round(mine[c].mean(), dp) if mine[c].notna().any() else None}
                               for c, _, dp in metrics]},
            "quarters": _quarters(player, set(mine["activity_id"])),
            "n90": n90,
            "flags": flags,
            "max_kmh": float(mx.loc[player, "max_kmh"]) if has_max else None,
        }
    out["metrics"] = [{"key": c, "label": l} for c, l, _ in metrics if c != "minutes"]
    return this_week._clean(out)


def _quarters(player: str, activity_ids: set) -> list:
    """Average per quarter for one player across their worked-out games (on-field time)."""
    q = game_summaries.load_quarters()
    if q.empty:
        return []
    q = q[(q["player"] == player) & q["activity_id"].isin(activity_ids)]
    if q.empty:
        return []
    out = q.groupby("quarter")[["minutes", "distance_m", "m_per_min", "hsr_m", "sprint_m"]].mean()
    return [{"quarter": f"Q{int(i)}", **{k: float(v) for k, v in r.items()}, "games": int((q["quarter"] == i).sum())}
            for i, r in out.iterrows()]
