import React, { useEffect, useMemo, useRef, useState } from 'react'
import { fetchPlayerProfile, fetchWorkOutGamesStatus, startWorkOutGames } from '../api.js'
import ScatterChart from './ScatterChart.jsx'
import { Avatar } from '../photos.jsx'
import { AllClear, Cards, Fold, Tile, fmtDay } from './ThisWeekTab.jsx'

// "Player Profile" — ported from the Frankston Sport Science app: weekly trends with a
// trend line, (if the conditioning workbook is added) where they sit between speed and
// endurance, their average and highest game against the squad, and the worst-case game.

const fmt = (v, dp = 0) => (v === null || v === undefined ? '–' : Number(v).toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp }))
const dpOf = (label) => (/km\/h|m\/min|efforts/i.test(label) ? 1 : 0)
const short = (iso) => fmtDay(iso, { day: '2-digit', month: 'short' })

function useTip() {
  const [tip, setTip] = useState(null)
  const show = (e, lines) => {
    const box = e.currentTarget.ownerSVGElement.parentNode.getBoundingClientRect()
    setTip({ x: e.clientX - box.left + 12, y: e.clientY - box.top + 12, lines })
  }
  const node = tip && (
    <div className="chart-tooltip" style={{ left: tip.x, top: tip.y }}>
      {tip.lines.map((l, i) => <div key={i} style={i === 0 ? { fontWeight: 700 } : undefined}>{l}</div>)}
    </div>
  )
  return { show, hide: () => setTip(null), node }
}

// Bars with optional horizontal reference lines and a trend line.
function BarChart({ bars, lines = [], trend = null, height = 300 }) {
  const { show, hide, node } = useTip()
  const W = 1200, padL = 56, padR = 16, padT = 16, padB = 56
  const vals = [...bars.map((b) => b.value), ...lines.map((l) => l.y), ...lines.flatMap((l) => l.ys || []),
    ...(trend ? trend.y : [])].filter((v) => v !== null && v !== undefined && Number.isFinite(v))
  const max = Math.max(1, ...vals) * 1.1
  const plotW = W - padL - padR, plotH = height - padT - padB
  const slot = plotW / Math.max(1, bars.length)
  const bw = Math.min(46, slot * 0.55)
  const x = (i) => padL + slot * i + slot / 2
  const y = (v) => padT + plotH * (1 - v / max)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => (max / 1.1) * f)
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" style={{ display: 'block' }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.07)" />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#9d9da6">{fmt(t)}</text>
          </g>
        ))}
        {bars.map((b, i) => {
          const has = b.value !== null && b.value !== undefined
          const top = has ? y(b.value) : y(0)
          const h = Math.max(0, y(0) - top)
          const r = Math.min(4, bw / 2, h)
          return (
            <g key={i} onMouseMove={(e) => show(e, b.tip)} onMouseLeave={hide}>
              <rect x={x(i) - slot / 2} y={padT} width={slot} height={plotH} fill="transparent" />
              {has && h > 0 && (
                <path d={`M${x(i) - bw / 2},${y(0)} V${top + r} Q${x(i) - bw / 2},${top} ${x(i) - bw / 2 + r},${top} H${x(i) + bw / 2 - r} Q${x(i) + bw / 2},${top} ${x(i) + bw / 2},${top + r} V${y(0)} Z`} fill={b.colour} />
              )}
              {!has && <text x={x(i)} y={y(0) - 6} textAnchor="middle" fontSize="11" fill="#6f6f76">No data</text>}
              <text x={x(i)} y={height - padB + 16} textAnchor="middle" fontSize="11" fill="#9d9da6"
                transform={bars.length > 10 ? `rotate(-35 ${x(i)} ${height - padB + 16})` : undefined}>{b.label}</text>
            </g>
          )
        })}
        {lines.map((l, k) => (l.ys ? (
          <polyline key={k} fill="none" stroke={l.colour} strokeWidth={l.width || 1.5} strokeDasharray={l.dash}
            points={l.ys.map((v, i) => (v === null || v === undefined ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(' ')} />
        ) : (
          <g key={k}>
            <line x1={padL} x2={W - padR} y1={y(l.y)} y2={y(l.y)} stroke={l.colour} strokeWidth={l.width || 1.5} strokeDasharray={l.dash} />
            <text x={l.anchor === 'end' ? W - padR - 4 : padL + 4} y={y(l.y) - 5} textAnchor={l.anchor || 'start'} fontSize="11" fill={l.colour}>{l.label}</text>
          </g>
        )))}
        {trend && <line x1={x(trend.x[0])} x2={x(trend.x[1])} y1={y(trend.y[0])} y2={y(trend.y[1])} stroke="#E31B23" strokeWidth="3" strokeLinecap="round" />}
      </svg>
      {node}
    </div>
  )
}

function Seg({ options, value, onChange }) {
  return (
    <div className="tw-seg" style={{ marginBottom: 10 }}>
      {options.map(([k, label]) => (
        <button key={k} type="button" className={`tw-seg-btn ${value === k ? 'active' : ''}`} onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  )
}

// Works out every game from the full 10Hz (on-field minutes, m/min, PlayerLoad,
// sprint efforts and quarter splits). Each game downloads once; later runs only do new games.
function WorkOutGamesBar({ token, region, full, total, onDone }) {
  const [st, setSt] = useState(null)
  const [error, setError] = useState(null)
  const poll = useRef(null)
  const done = useRef(onDone)
  done.current = onDone
  const tick = async () => {
    const s = await fetchWorkOutGamesStatus().catch(() => null)
    if (!s) return
    setSt(s)
    if (!s.running && poll.current) {
      clearInterval(poll.current)
      poll.current = null
      if (s.error) setError(s.error)
      done.current && done.current()
    }
  }
  useEffect(() => {
    fetchWorkOutGamesStatus().then((s) => { setSt(s); if (s.running && !poll.current) poll.current = setInterval(tick, 2000) }).catch(() => {})
    return () => poll.current && clearInterval(poll.current)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => {
    setError(null)
    try {
      setSt(await startWorkOutGames({ token, region }))
      if (!poll.current) poll.current = setInterval(tick, 2000)
    } catch (e) {
      setError(e.message)
    }
  }
  const missing = Math.max(0, total - full)
  return (
    <>
      <div className="tw-sync">
        <span className={`tw-dot ${st?.running ? 'run' : missing === 0 ? 'ok' : ''}`} />
        <span>
          {st?.running
            ? `Working out games from full 10Hz${st.total ? ` (${st.done} of ${st.total} done)` : ''}… ${st.message || ''}`
            : `${full} of ${total} games worked out from full 10Hz (on-field minutes, m/min, PlayerLoad, quarters)`}
        </span>
        {!st?.running && missing > 0 && (
          <button type="button" className="toggle-btn" style={{ marginLeft: 'auto' }} onClick={go} disabled={!token}>
            Work out {missing} game{missing === 1 ? '' : 's'}
          </button>
        )}
      </div>
      {error && <div className="tw-error">{error}</div>}
    </>
  )
}

export default function PlayerProfileTab({ token, region }) {
  const [player, setPlayer] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [tMetric, setTMetric] = useState('hsr_m')
  const [tWeeks, setTWeeks] = useState('8')
  const [gMetric, setGMetric] = useState('hsr_m')

  const load = (p) => {
    setError(null)
    fetchPlayerProfile(p).then((out) => { setData(out); if (out.player) setPlayer(out.player) }).catch((e) => setError(e.message))
  }
  useEffect(() => { load() }, [])

  const d = data
  const tr = d?.trends?.[tMetric]?.[tWeeks]
  const tm = d?.trend_metrics?.[tMetric]
  const unit = tm?.unit ? ` ${tm.unit}` : ''
  const trendName = (k) => (d?.trend_metrics?.[k]?.label || k).replace('>', 'Above ')

  const trendTiles = useMemo(() => {
    if (!tr) return null
    const done = tr.rows.filter((r) => r.value !== null && !r.partial)
    const last = done[done.length - 1]
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
    const f = tr.fit
    return {
      empty: tr.rows.every((r) => r.value === null),
      noMax: tMetric === 'z80_m' && tr.rows.every((r) => r.value === null) && tr.rows.some((r) => r.squad !== null),
      tiles: [
        { label: 'Trend', value: f.ok ? f.direction : 'Not enough weeks', unit: '',
          sub: f.ok ? `${f.per_week >= 0 ? '+' : ''}${Math.round(f.per_week * 100)}% a week` : `needs ${d.min_points}+ weeks with data`,
          tone: f.ok ? (f.direction === 'Steady' ? 'ok' : 'warn') : undefined },
        { label: 'Average week', value: fmt(mean(done.map((r) => r.value))), unit: tm?.unit || '',
          sub: `${done.length} of ${tr.rows.filter((r) => !r.partial).length} weeks with data` },
        { label: 'Last full week', value: last ? fmt(last.value) : '–', unit: tm?.unit || '', sub: last ? `week of ${short(last.week)}` : '' },
        { label: 'Squad median', value: fmt(mean(done.map((r) => r.squad).filter((v) => v !== null))), unit: tm?.unit || '', sub: 'average over the same weeks' },
      ],
    }
  }, [tr, tMetric, tm, d])

  const g = d?.games
  const gLabel = d?.metrics?.find((m) => m.key === gMetric)?.label || gMetric
  const gameBars = useMemo(() => {
    if (!g) return []
    const vals = g.by_game.map((r) => r[gMetric])
    const top = vals.reduce((bi, v, i) => (v !== null && (bi === -1 || v > vals[bi]) ? i : bi), -1)
    return g.by_game.map((r, i) => ({
      value: r[gMetric],
      label: `${r.activity.split(/ vs /i)[0]} · ${short(r.date)}`,
      colour: i === top ? '#E31B23' : '#e9e9ec',
      tip: [r.activity, fmtDay(r.date), `${gLabel}: ${fmt(r[gMetric], gMetric === 'max_velocity_kmh' ? 1 : 0)}`],
    }))
  }, [g, gMetric, gLabel])
  const gAvg = useMemo(() => {
    const v = (g?.by_game || []).map((r) => r[gMetric]).filter((x) => x !== null)
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  }, [g, gMetric])

  return (
    <div className="tw">
      <div className="tw-head">
        <div className="who-wrap">
          {d?.player && <Avatar name={d.player} size={64} />}
          <div>
          <div className="tw-title">{d?.player || 'Player Profile'}</div>
          <div className="tw-sub">{g ? `${g.count} games with GPS` : 'Player Profile'} · 10Hz from Catapult</div>
          </div>
        </div>
        {d?.players?.length > 0 && (
          <select className="config-select tw-head-select" value={player} onChange={(e) => { setPlayer(e.target.value); load(e.target.value) }} style={{ minWidth: 240 }}>
            {d.players.map((p) => <option key={p.name} value={p.name}>{p.name} · {p.games} game{p.games === 1 ? '' : 's'}</option>)}
          </select>
        )}
      </div>
      {error && <div className="tw-error">{error}</div>}
      {d?.empty && <div className="tw-clear">No 10Hz data yet. Pull from Catapult on the This Week tab first.</div>}
      {d && !d.empty && (
        <WorkOutGamesBar token={token} region={region} full={d.full_games} total={d.total_games} onDone={() => load(player || undefined)} />
      )}

      {d && !d.empty && d.player && (
        <>
          <div className="tw-tiles">{d.tiles.map((t) => <Tile key={t.label} {...t} />)}</div>

          <Fold
            title="Weekly trends"
            count={tr?.fit?.ok ? `${trendName(tMetric)} ${tr.fit.direction.toLowerCase()}, ${tr.fit.per_week >= 0 ? '+' : ''}${Math.round(tr.fit.per_week * 100)}% a week over ${tWeeks} weeks` : ''}
            note="Weekly totals from Catapult with a trend line. The dotted line is the squad's median week. Gaps are weeks with no data."
            open
          >
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Seg options={Object.keys(d.trend_metrics).map((k) => [k, trendName(k)])} value={tMetric} onChange={setTMetric} />
              <Seg options={d.trend_windows.map((n) => [String(n), `${n} weeks`])} value={tWeeks} onChange={setTWeeks} />
            </div>
            {trendTiles?.noMax ? (
              <AllClear>No tested max velocity, so metres above 80% of max can't be worked out yet.</AllClear>
            ) : trendTiles?.empty ? (
              <AllClear>No GPS data for {d.player} in the last {tWeeks} weeks.</AllClear>
            ) : tr && (
              <>
                <div className="tw-tiles">{trendTiles.tiles.map((t) => <Tile key={t.label} {...t} />)}</div>
                <BarChart
                  bars={tr.rows.map((r) => ({
                    value: r.value, label: short(r.week), colour: r.partial ? '#5a5b62' : '#e9e9ec',
                    tip: r.value === null ? [`Week of ${fmtDay(r.week)}`, 'No data']
                      : [`Week of ${fmtDay(r.week)}`, `${fmt(r.value)}${unit}`, `${r.sessions || 0} of ${r.team_sessions} sessions`, ...(r.partial ? ['Week not finished'] : [])],
                  }))}
                  lines={[{ ys: tr.rows.map((r) => r.squad), colour: '#9d9da6', dash: '4 4' }]}
                  trend={tr.fit.ok ? tr.fit : null}
                />
                <p className="field-hint" style={{ marginTop: 6 }}>
                  Red line: {tm.label} trend through their finished weeks. Grey bar: week still in progress, left out of the trend. Hover a bar for sessions done.
                </p>
              </>
            )}
          </Fold>

          {d.physiology ? (
            <Fold title="Physiological profile" count={d.physiology.type} note="Where they sit between speed and endurance, against the squad.">
              <div className="pp-two">
                <div>
                  <div className="tw-clear" style={{ borderLeftColor: '#E31B23', marginBottom: 12 }}>
                    <div style={{ fontSize: 22, fontWeight: 800 }}>{d.physiology.type}</div>
                    <div style={{ color: 'var(--cat-text-dim)' }}>{d.physiology.blurb}</div>
                  </div>
                  <div className="tw-tiles">{d.physiology.tiles.map((t) => <Tile key={t.label} {...t} />)}</div>
                  <Cards items={d.physiology.focus} />
                </div>
                <ScatterChart points={d.physiology.points} xLabel="MAS (m/s)" yLabel="Max speed (km/h)"
                  title="Speed v endurance" xThreshold={d.physiology.median.mas} yThreshold={d.physiology.median.max_kmh}
                  xFormat={(v) => Number(v).toFixed(2)} yFormat={(v) => Number(v).toFixed(1)} />
              </div>
            </Fold>
          ) : (
            <Fold title="Physiological profile" count="needs the conditioning workbook"
              note="MAS (from the 2 km time trial), ASR and speed-endurance type come from the conditioning workbook. Add it to sport_science_data/testing/ to turn this on." />
          )}

          {!g ? (
            <AllClear>No game GPS data for this player yet.</AllClear>
          ) : (
            <>
              <Fold
                title="Games"
                count={`${g.count} games · average HSR ${fmt(g.table.find((r) => r.metric.startsWith('High-speed'))?.average)} m, squad ${fmt(g.squad_avg.hsr_m)} m`}
                note="Their average game against the squad's, and their biggest game for each measure."
                open
              >
                <div className="summary-table-wrap">
                  <table className="summary-table">
                    <thead><tr><th>Metric</th><th>Average</th><th>Squad avg</th><th>vs squad</th><th>Highest</th><th>Highest in</th></tr></thead>
                    <tbody>
                      {g.table.map((r) => (
                        <tr key={r.metric}>
                          <td className="cell-bold">{r.metric}</td><td>{fmt(r.average, dpOf(r.metric))}</td>
                          <td>{fmt(r.squad, dpOf(r.metric))}</td><td>{r.vs_squad}</td>
                          <td>{fmt(r.highest, dpOf(r.metric))}</td><td>{r.highest_in}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="field-hint" style={{ margin: '14px 0 8px' }}>
                  Game by game. The red bar is the season high, the solid line their average and the dotted line the squad's.
                </p>
                <Seg options={d.metrics.map((m) => [m.key, m.label.replace(/ \(.*\)/, '')])} value={gMetric} onChange={setGMetric} />
                <BarChart
                  bars={gameBars}
                  height={340}
                  lines={[
                    ...(gAvg !== null ? [{ y: gAvg, colour: '#c9c9cf', width: 2, label: `Player avg ${fmt(gAvg)}` }] : []),
                    ...(g.squad_avg[gMetric] !== null ? [{ y: g.squad_avg[gMetric], colour: '#9d9da6', dash: '4 4', label: `Squad avg ${fmt(g.squad_avg[gMetric])}`, anchor: 'end' }] : []),
                    ...(gMetric === 'max_velocity_kmh' && g.max_kmh ? [{ y: 0.9 * g.max_kmh, colour: '#ff5147', dash: '6 4', label: `90% of max ${(0.9 * g.max_kmh).toFixed(1)}`, anchor: 'end' }] : []),
                  ]}
                />
              </Fold>

              <Fold
                title="Return to play"
                count={`worst case ${g.worst.activity}, ${fmt(g.worst.rows.find((r) => r.metric.startsWith('Total distance'))?.worst)} m${g.n90 !== null ? ` · ≥90% of max in ${g.n90} of ${g.count} games` : ''}`}
                note="Build to the average game, then the worst case (their biggest high-speed game)."
              >
                <div className="pp-two">
                  <div>
                    <div className="sidebar-label" style={{ marginBottom: 8 }}>Worst-case game · {g.worst.activity} ({short(g.worst.date)})</div>
                    <div className="summary-table-wrap">
                      <table className="summary-table">
                        <thead><tr><th>Metric</th><th>Worst case</th><th>Average</th></tr></thead>
                        <tbody>
                          {g.worst.rows.map((r) => (
                            <tr key={r.metric}><td className="cell-bold">{r.metric}</td>
                              <td>{fmt(r.worst, dpOf(r.metric))}</td><td>{fmt(r.average, dpOf(r.metric))}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div>
                    <div className="sidebar-label" style={{ marginBottom: 8 }}>By quarter</div>
                    {g.quarters?.length ? (
                      <div className="summary-table-wrap">
                        <table className="summary-table">
                          <thead><tr><th>Quarter</th><th>Min</th><th>Distance (m)</th><th>m/min</th><th>HSR (m)</th><th>Sprint (m)</th></tr></thead>
                          <tbody>
                            {g.quarters.map((q) => (
                              <tr key={q.quarter}><td className="cell-bold">{q.quarter}</td><td>{fmt(q.minutes, 1)}</td><td>{fmt(q.distance_m)}</td>
                                <td>{fmt(q.m_per_min, 1)}</td><td>{fmt(q.hsr_m)}</td><td>{fmt(q.sprint_m)}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <AllClear>Quarter splits need the games worked out from full 10Hz (button at the top of the page).</AllClear>
                    )}
                    {g.n90 !== null && <p className="field-hint" style={{ marginTop: 8 }}>Reached ≥90% of max velocity in {g.n90} of {g.count} games.</p>}
                  </div>
                </div>
              </Fold>

              {g.flags.length > 0 && (
                <Fold title="Data notes" count={`${g.flags.length} thing${g.flags.length === 1 ? '' : 's'} to know`} note="Things in this player's data worth knowing.">
                  <Cards items={g.flags} />
                </Fold>
              )}
            </>
          )}

          <div className="tw-notes">
            <p><strong>Games</strong> are activities named like a round or final (Rd…, Final, Semi, Prelim, Elim, Qual, Wildcard), from Catapult 10Hz.</p>
            <p>
              <strong>Minutes, m/min, PlayerLoad, sprint efforts and quarters</strong> come from each game's full 10Hz, on-field time only
              (bench time near the interchange is left out, as in Game Report). Games not worked out yet only show distance, HSR, sprint,
              &gt;80% max, accels + decels and max velocity.
            </p>
            <p><strong>Max velocity</strong> is held for 0.5 s. HSR &gt; 19.8 km/h, sprint &gt; 25.2 km/h.</p>
          </div>
        </>
      )}
    </div>
  )
}
