import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchDrillMatrix, fetchDrillSyncStatus, saveDrillNames, startDrillSync } from '../api.js'
import { AllClear, Cards, Fold, Tile, fmtDay } from './ThisWeekTab.jsx'

// "Drill Matrix" — ported from the Frankston Sport Science app. A season-long drill
// library (not one session like the Drill Report): each drill's demands per minute
// (median player, averaged over every run) against the average game, sorted into a
// physical-demand category and the training day it suits.

const f = (v, dp = 0) => (v === null || v === undefined ? '–' : Number(v).toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp }))

function Seg({ options, value, onChange }) {
  return (
    <div className="tw-seg">
      {options.map(([k, label]) => (
        <button key={k} type="button" className={`tw-seg-btn ${value === k ? 'active' : ''}`} onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  )
}

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

// Drill map: accels + decels a minute (across) v HSR or sprint m/min (up), coloured by category.
function DrillMap({ rows, yKey, yLabel, categories, game, cutoffs }) {
  const { show, hide, node } = useTip()
  const W = 1100, H = 560, padL = 64, padR = 24, padT = 24, padB = 56
  const pts = rows.filter((r) => r.accel_decel_per_min !== null && r[yKey] !== null)
  const xs = [...pts.map((r) => r.accel_decel_per_min), game?.accel_decel_per_min].filter((v) => v !== null && v !== undefined)
  const ys = [...pts.map((r) => r[yKey]), game?.[yKey]].filter((v) => v !== null && v !== undefined)
  const xMax = Math.max(0.1, ...xs) * 1.12, yMax = Math.max(0.1, ...ys) * 1.15
  const x = (v) => padL + ((W - padL - padR) * v) / xMax
  const y = (v) => padT + (H - padT - padB) * (1 - v / yMax)
  const ticks = (m) => [0, 0.25, 0.5, 0.75, 1].map((t) => (m / 1.12) * t)
  return (
    <div style={{ position: 'relative' }}>
      <div className="rot-legend dm-legend">
        {Object.entries(categories).map(([k, c]) => <span key={k}><i style={{ background: c.colour }} />{k} · {c.fits}</span>)}
        {game && <span><i style={{ background: '#fff', transform: 'rotate(45deg)' }} />Average game</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
        {ticks(yMax).map((t) => (
          <g key={`y${t}`}><line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.06)" />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="#9d9da6">{f(t, 1)}</text></g>
        ))}
        {ticks(xMax).map((t) => (
          <g key={`x${t}`}><line x1={x(t)} x2={x(t)} y1={padT} y2={H - padB} stroke="rgba(255,255,255,0.04)" />
            <text x={x(t)} y={H - padB + 18} textAnchor="middle" fontSize="12" fill="#9d9da6">{f(t, 2)}</text></g>
        ))}
        <text x={(W + padL) / 2} y={H - 10} textAnchor="middle" fontSize="13" fill="#c9c9cf">Accels + decels a minute</text>
        <text x={16} y={H / 2} textAnchor="middle" fontSize="13" fill="#c9c9cf" transform={`rotate(-90 16 ${H / 2})`}>{yLabel}</text>
        {cutoffs && <line x1={x(cutoffs.accel_decel_per_min)} x2={x(cutoffs.accel_decel_per_min)} y1={padT} y2={H - padB} stroke="#5a5b62" strokeDasharray="3 4" />}
        {cutoffs && yKey === 'hsr_m_per_min' && <line x1={padL} x2={W - padR} y1={y(cutoffs.hsr_m_per_min)} y2={y(cutoffs.hsr_m_per_min)} stroke="#5a5b62" strokeDasharray="3 4" />}
        {pts.map((r) => {
          const c = categories[r.category]?.colour || '#8a8a90'
          const rad = 5 + Math.min(r.runs, 10)
          return (
            <g key={r.drill} onMouseMove={(e) => show(e, [`${r.drill} · ${r.category}${r.fits ? ` (${r.fits})` : ''}`,
              `${f(r[yKey], 1)} ${yLabel} · ${f(r.accel_decel_per_min, 2)} accels + decels a min`,
              `${f(r.distance_m_per_min)} m/min · ${f(r.minutes)} min · run ${r.runs} times`])} onMouseLeave={hide}>
              <circle cx={x(r.accel_decel_per_min)} cy={y(r[yKey])} r={rad} fill={c} stroke="#0d0d0f" strokeWidth="2" />
              <text x={x(r.accel_decel_per_min)} y={y(r[yKey]) - rad - 4} textAnchor="middle" fontSize="12" fontWeight="600" fill="#000">{r.drill}</text>
            </g>
          )
        })}
        {game && game[yKey] !== null && game[yKey] !== undefined && (
          <g>
            <rect x={x(game.accel_decel_per_min) - 8} y={y(game[yKey]) - 8} width="16" height="16" fill="#fff" stroke="#E31B23" strokeWidth="2"
              transform={`rotate(45 ${x(game.accel_decel_per_min)} ${y(game[yKey])})`} />
            <text x={x(game.accel_decel_per_min)} y={y(game[yKey]) + 26} textAnchor="middle" fontSize="12" fontWeight="600" fill="#000">Average game</text>
          </g>
        )}
      </svg>
      {node}
    </div>
  )
}

function RunsChart({ runs, gameAvg }) {
  const { show, hide, node } = useTip()
  const W = 1100, H = 280, padL = 56, padR = 16, padT = 16, padB = 36
  const max = Math.max(1, ...runs.map((r) => r.distance_m_per_min || 0), gameAvg || 0) * 1.12
  const slot = (W - padL - padR) / Math.max(1, runs.length)
  const bw = Math.min(40, slot * 0.55)
  const y = (v) => padT + (H - padT - padB) * (1 - v / max)
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
        {[0, 0.5, 1].map((t) => <g key={t}><line x1={padL} x2={W - padR} y1={y((max / 1.12) * t)} y2={y((max / 1.12) * t)} stroke="rgba(255,255,255,0.07)" />
          <text x={padL - 8} y={y((max / 1.12) * t) + 4} textAnchor="end" fontSize="11" fill="#9d9da6">{f((max / 1.12) * t)}</text></g>)}
        {runs.map((r, i) => {
          const cx = padL + slot * i + slot / 2
          const top = y(r.distance_m_per_min || 0)
          return (
            <g key={i} onMouseMove={(e) => show(e, [r.activity, fmtDay(r.date), `${f(r.distance_m_per_min)} m/min`])} onMouseLeave={hide}>
              <rect x={cx - slot / 2} y={padT} width={slot} height={H - padT - padB} fill="transparent" />
              <rect x={cx - bw / 2} y={top} width={bw} height={Math.max(0, y(0) - top)} rx="4" fill="#e9e9ec" />
              <text x={cx} y={H - 12} textAnchor="middle" fontSize="11" fill="#9d9da6">{fmtDay(r.date, { day: '2-digit', month: 'short' })}</text>
            </g>
          )
        })}
        {gameAvg && <g><line x1={padL} x2={W - padR} y1={y(gameAvg)} y2={y(gameAvg)} stroke="#E31B23" strokeWidth="1.5" strokeDasharray="3 4" />
          <text x={padL + 4} y={y(gameAvg) - 5} fontSize="11" fill="#ff5a5f">Average game {f(gameAvg)}</text></g>}
      </svg>
      {node}
    </div>
  )
}

export default function DrillMatrixTab({ token, region }) {
  const [phase, setPhase] = useState('All')
  const [kind, setKind] = useState('Skills')
  const [yKey, setYKey] = useState('hsr_m_per_min')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [sync, setSync] = useState(null)
  const [names, setNames] = useState([])
  const [oneDrill, setOneDrill] = useState('')
  const [saveMsg, setSaveMsg] = useState(null)
  const poll = useRef(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const out = await fetchDrillMatrix(phase, kind)
      setData(out)
      setNames(out.names || [])
    } catch (e) {
      setError(e.message)
    }
  }, [phase, kind])
  useEffect(() => { load() }, [load])

  const tick = useCallback(async () => {
    const s = await fetchDrillSyncStatus().catch(() => null)
    if (!s) return
    setSync(s)
    if (!s.running && poll.current) { clearInterval(poll.current); poll.current = null; load() }
  }, [load])
  useEffect(() => {
    fetchDrillSyncStatus().then((s) => { setSync(s); if (s.running && !poll.current) poll.current = setInterval(tick, 2000) }).catch(() => {})
    return () => poll.current && clearInterval(poll.current)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const pull = async () => {
    try {
      setSync(await startDrillSync({ token, region }))
      if (!poll.current) poll.current = setInterval(tick, 2000)
    } catch (e) { setError(e.message) }
  }

  const d = data
  const mtx = d?.matrix || []
  const g = d?.reference?.avg
  const p5 = d?.reference?.peak5
  useEffect(() => { if (mtx.length && !mtx.some((r) => r.drill === oneDrill)) setOneDrill([...mtx].sort((a, b) => a.drill.localeCompare(b.drill))[0].drill) }, [mtx, oneDrill])
  const pctCell = (v, base) => {
    if (v === null || v === undefined || !base) return '–'
    const p = (v / base) * 100
    return (
      <div className="tw-pctbar"><div style={{ width: `${Math.min(150, p) / 1.5}%`, background: '#E31B23' }} /><span>{Math.round(p)}%</span></div>
    )
  }
  const byDay = useMemo(() => [['Tue / Sat', 'Volume and high-speed running'], ['Thu', 'Accels and decels, less HSR'], ['Any day', 'Low load: skills, warm-ups, recovery']]
    .map(([day, what]) => ({ day, what, rows: mtx.filter((r) => r.fits === day) })), [mtx])

  const saveNames = async () => {
    try {
      await saveDrillNames(names)
      setSaveMsg('Saved. The matrix is updated.')
      setTimeout(() => setSaveMsg(null), 2500)
      load()
    } catch (e) { setError(e.message) }
  }

  return (
    <div className="tw">
      <div className="tw-head">
        <div>
          <div className="tw-title">Drill Matrix</div>
          <div className="tw-sub">What each drill asks of players · Catapult drill splits, 10Hz</div>
        </div>
        <Seg options={[['All', 'All'], ['Pre-season', 'Pre-season'], ['In-season', 'In-season']]} value={phase} onChange={setPhase} />
      </div>

      <div className="tw-sync">
        <span className={`tw-dot ${sync?.running ? 'run' : sync?.sessions ? 'ok' : ''}`} />
        <span>
          {sync?.running ? `Pulling drill sessions… ${sync.message || ''}` : `${sync?.sessions ?? 0} training sessions with drill splits pulled`}
        </span>
        <button type="button" className="toggle-btn" style={{ marginLeft: 'auto' }} onClick={pull} disabled={!token || sync?.running}>
          {sync?.running ? 'Pulling…' : 'Pull drill sessions from Catapult'}
        </button>
      </div>
      {(sync?.error) && <div className="tw-error">Last pull failed: {sync.error}</div>}
      {error && <div className="tw-error">{error}</div>}

      {d?.empty && (
        <AllClear>
          No drill data yet. Press <strong>Pull drill sessions from Catapult</strong>. It downloads 10Hz for every training session
          split into periods (drills) in OpenField since 1 Nov 2025, so the first pull takes a while; after that only new sessions.
        </AllClear>
      )}

      {d && !d.empty && (
        <>
          <Seg options={[['Skills', 'Skill drills'], ['Running', 'Running blocks'], ['All', 'Everything']]} value={kind} onChange={setKind} />
          {!d.reference && (
            <div className="tw-error" style={{ background: 'rgba(242,179,61,.1)', borderColor: 'rgba(242,179,61,.45)', color: '#f2d08a' }}>
              No game reference yet, so drills can't be compared with games or put into categories. Work out the games on the
              Player Profile tab (on-field minutes from full 10Hz) and come back.
            </div>
          )}
          {mtx.length === 0 ? (
            <AllClear>No drills of that type run {d.min_runs}+ times in this phase.</AllClear>
          ) : (
            <>
              <div className="tw-tiles">
                <Tile label="Drills" value={mtx.length} unit="" sub={`run ${d.min_runs}+ times`} />
                <Tile label="Times run" value={mtx.reduce((a, r) => a + r.runs, 0)} unit="" sub={`across ${d.sessions} sessions`} />
                {g && <Tile label="Game average" value={f(g.distance_m_per_min)} unit="m/min" sub={`HSR ${f(g.hsr_m_per_min, 1)} · accels + decels ${f(g.accel_decel_per_min, 2)} a min`} tone="red" />}
                {p5?.distance_m_per_min && <Tile label="Game peak 5 min" value={f(p5.distance_m_per_min)} unit="m/min" sub="squad median of each player's best" tone="red" />}
              </div>

              <Fold title="Drill map" count="each drill against the others and the average game" open
                note={`Each dot is a drill run ${d.min_runs}+ times (the median player, averaged over every run), coloured by its physical demand.${d.cutoffs ? ` Dotted lines are the category cut-offs: ${Math.round(d.shares.speed * 100)}% of the average game's HSR a minute, and ${Math.round(d.shares.accel * 100)}% of its accels + decels a minute.` : ''} Bigger dot = run more often.`}>
                <Seg options={[['hsr_m_per_min', 'HSR m/min'], ['sprint_m_per_min', 'Sprint m/min']]} value={yKey} onChange={setYKey} />
                <DrillMap rows={mtx} yKey={yKey} yLabel={yKey === 'hsr_m_per_min' ? 'HSR m/min' : 'Sprint m/min'}
                  categories={d.categories} game={g} cutoffs={d.cutoffs} />
              </Fold>

              {d.reference && (
                <Fold title="By training day" count="which drills suit Tue / Sat and which suit Thu" open
                  note="Tuesday and Saturday are the big days: volume and high-speed running. Thursday is less volume and high-speed running, more accels and decels.">
                  {byDay.map(({ day, what, rows }) => (
                    <div key={day} style={{ marginBottom: 14 }}>
                      <div className="sidebar-label" style={{ marginBottom: 8 }}>{day} · {what}</div>
                      {rows.length === 0 ? <p className="field-hint">None in this filter.</p> : (
                        <Cards items={rows.map((r) => ({
                          who: r.drill,
                          num: day === 'Thu' ? f(r.accel_decel_per_min, 2) : f(r.hsr_m_per_min, 1),
                          unit: day === 'Thu' ? 'acc + dec a min' : 'HSR m/min',
                          tone: { 'High speed': 'red', 'High speed + accel/decel': 'flag', 'Accel/decel': 'warn' }[r.category] || 'none',
                          meta: `${r.category} · HSR ${f(r.hsr_m_per_min, 1)} m/min · ${f(r.accel_decel_per_min, 2)} accels + decels a min · ${f(r.distance_m_per_min)} m/min · run ${r.runs} times`,
                        }))} />
                      )}
                    </div>
                  ))}
                </Fold>
              )}

              <Fold title="Intensity vs game" count="per minute, against the average game and peak 5 min" open
                note="The median player in each drill, averaged across runs. % of game = drill rate ÷ average game rate.">
                <div className="summary-table-wrap">
                  <table className="summary-table">
                    <thead><tr>
                      <th>Drill</th><th>Category</th><th>Fits</th><th>Runs</th><th>Length (min)</th><th>m/min</th><th>m/min % of game</th>
                      <th>m/min % of peak 5 min</th><th>HSR m/min</th><th>HSR % of game</th><th>Sprint m/min</th><th>Accels + decels a min</th>
                      <th>&gt;80% max m/min</th><th>Top % of max</th>
                    </tr></thead>
                    <tbody>
                      {mtx.map((r) => (
                        <tr key={r.drill}>
                          <td className="cell-bold">{r.drill}</td><td>{r.category}</td><td>{r.fits || '–'}</td><td>{r.runs}</td><td>{f(r.minutes)}</td>
                          <td>{f(r.distance_m_per_min)}</td><td>{pctCell(r.distance_m_per_min, g?.distance_m_per_min)}</td>
                          <td>{pctCell(r.distance_m_per_min, p5?.distance_m_per_min)}</td><td>{f(r.hsr_m_per_min, 1)}</td>
                          <td>{pctCell(r.hsr_m_per_min, g?.hsr_m_per_min)}</td><td>{f(r.sprint_m_per_min, 1)}</td>
                          <td>{f(r.accel_decel_per_min, 2)}</td><td>{f(r.z80_m_per_min, 1)}</td>
                          <td>{r.pct_max === null || r.pct_max === undefined ? '–' : `${Math.round(r.pct_max * 100)}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Fold>

              <Fold title="Totals per run" count="what one run of each drill adds to a session"
                note="The median player's totals in one run of the drill, averaged across runs.">
                <div className="summary-table-wrap">
                  <table className="summary-table">
                    <thead><tr><th>Drill</th><th>Runs</th><th>Players</th>
                      {Object.entries(d.totals).filter(([c]) => mtx.some((r) => r[c] !== undefined)).map(([c, t]) => <th key={c}>{t.label}{t.unit ? ` (${t.unit})` : ''}</th>)}
                    </tr></thead>
                    <tbody>
                      {mtx.map((r) => (
                        <tr key={r.drill}><td className="cell-bold">{r.drill}</td><td>{r.runs}</td><td>{f(r.players)}</td>
                          {Object.keys(d.totals).filter((c) => mtx.some((x) => x[c] !== undefined)).map((c) => <td key={c}>{f(r[c])}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Fold>

              <Fold title="One drill" count="every time a drill was run, and how it changed">
                <select className="config-select" value={oneDrill} onChange={(e) => setOneDrill(e.target.value)} style={{ minWidth: 260, marginBottom: 10 }}>
                  {[...mtx].sort((a, b) => a.drill.localeCompare(b.drill)).map((r) => <option key={r.drill} value={r.drill}>{r.drill}</option>)}
                </select>
                {d.runs?.[oneDrill] && (
                  <>
                    <RunsChart runs={d.runs[oneDrill]} gameAvg={g?.distance_m_per_min} />
                    <div className="summary-table-wrap" style={{ marginTop: 10 }}>
                      <table className="summary-table">
                        <thead><tr><th>Date</th><th>Session</th><th>Players</th><th>Length (min)</th><th>m/min</th><th>HSR m/min</th><th>Sprint m/min</th><th>Accels + decels a min</th></tr></thead>
                        <tbody>
                          {d.runs[oneDrill].map((r, i) => (
                            <tr key={i}><td>{fmtDay(r.date)}</td><td>{r.activity}</td><td>{r.players}</td><td>{f(r.minutes)}</td>
                              <td>{f(r.distance_m_per_min)}</td><td>{f(r.hsr_m_per_min, 1)}</td><td>{f(r.sprint_m_per_min, 1)}</td><td>{f(r.accel_decel_per_min, 2)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </Fold>
            </>
          )}

          <Fold title="Drill names" count="how OpenField names were merged"
            note="OpenField names are typed by hand, so one drill can have several spellings. Change the drill a name belongs to, or clear it to leave that period out (e.g. rehab groups). Type sets whether it shows with skill drills or running blocks.">
            <div className="summary-table-wrap" style={{ maxHeight: 460, overflowY: 'auto' }}>
              <table className="summary-table rh-edit">
                <thead><tr><th>OpenField name</th><th>Drill</th><th>Type</th></tr></thead>
                <tbody>
                  {names.map((n, i) => (
                    <tr key={n.openfield_name}>
                      <td style={{ textAlign: 'left' }}>{n.openfield_name}</td>
                      <td><input className="config-select" value={n.drill} onChange={(e) => setNames((ns) => ns.map((x, j) => (j === i ? { ...x, drill: e.target.value } : x)))} /></td>
                      <td>
                        <select className="config-select" value={n.type} onChange={(e) => setNames((ns) => ns.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>
                          <option value="">–</option><option value="Skills">Skills</option><option value="Running">Running</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
              <button type="button" className="toggle-btn active" onClick={saveNames}>Save drill names</button>
              {saveMsg && <span className="field-hint">{saveMsg}</span>}
            </div>
          </Fold>

          <div className="tw-notes">
            <p><strong>Drills</strong> come from sessions split into periods in OpenField. Sessions left as one block can't be broken down. A player counts in a drill if they wore a unit for at least half of it.</p>
            <p><strong>Definitions</strong> match the game report: HSR &gt; 19.8 km/h and sprint &gt; 25.2 km/h (efforts held 1 s), accels/decels beyond ±3 m/s², &gt;80% of their own tested max.</p>
            <p><strong>Game average</strong> is per on-field minute from the games worked out on Player Profile. <strong>Peak 5 min</strong> is the squad median of each player's best 5 minutes in a game (10Hz).</p>
          </div>
        </>
      )}
    </div>
  )
}
