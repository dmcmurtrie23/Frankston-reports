import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchGameReport, fetchGameStatus, fetchGames, fetchRotations, startGameDownload } from '../api.js'
import { Fold, Tile, fmtDay } from './ThisWeekTab.jsx'
import { Avatar } from '../photos.jsx'

// "Game Report" — ported from the Frankston Sport Science app. 10Hz for one game
// (downloaded once per game), quarters from OpenField's periods, on-field time
// estimated from the data, then team / player / quarter numbers and peak windows.

const REPORTS = { bands: 'Speed Bands · HSR & Sprint', zones: 'Individual Zones · % of Max' }
const PEAK_SHOW = ['30 s', '1 min', '5 min']

const n0 = (v) => (v === null || v === undefined ? '–' : Math.round(v).toLocaleString('en-AU'))
const n1 = (v) => (v === null || v === undefined ? '–' : Number(v).toFixed(1))
const n2 = (v) => (v === null || v === undefined ? '–' : Number(v).toFixed(2))

// Sortable table; columns: {key, label, fmt, bar (show a bar scaled to the column max), max}
function Table({ columns, rows, initialSort, csvName }) {
  const [sort, setSort] = useState(initialSort || { key: null, dir: -1 })
  const maxes = useMemo(() => {
    const m = {}
    for (const c of columns) if (c.bar) m[c.key] = c.max ?? Math.max(1, ...rows.map((r) => Number(r[c.key]) || 0))
    return m
  }, [columns, rows])
  const sorted = useMemo(() => {
    if (!sort.key) return rows
    return [...rows].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key]
      if (x === y) return 0
      if (x === null || x === undefined) return 1
      if (y === null || y === undefined) return -1
      return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir
    })
  }, [rows, sort])
  const by = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'player' ? 1 : -1 }))

  const downloadCsv = () => {
    const esc = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)
    const lines = [columns.map((c) => esc(c.label)).join(','), ...sorted.map((r) => columns.map((c) => esc(c.csv ? c.csv(r[c.key], r) : r[c.key])).join(','))]
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = csvName
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <div className="summary-table-wrap">
        <table className="summary-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className="sortable-th" onClick={() => by(c.key)}>
                  {c.label}{sort.key === c.key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.id ?? r.player ?? r.quarter ?? i}>
                {columns.map((c) => (
                  <td key={c.key} className={c.key === 'player' ? 'cell-bold' : undefined}>
                    {c.bar && r[c.key] !== null && r[c.key] !== undefined ? (
                      <div className="tw-pctbar">
                        <div style={{ width: `${Math.max(0, Math.min(100, (r[c.key] / maxes[c.key]) * 100))}%`, background: '#E31B23' }} />
                        <span>{c.fmt ? c.fmt(r[c.key], r) : r[c.key]}</span>
                      </div>
                    ) : c.key === 'player' && r[c.key] && r[c.key] !== '–' ? (
                      <span className="tw-player-cell"><Avatar name={r[c.key]} size={26} />{r[c.key]}</span>
                    ) : c.fmt ? c.fmt(r[c.key], r) : (r[c.key] ?? '–')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {csvName && (
        <button type="button" className="toggle-btn" style={{ marginTop: 10 }} onClick={downloadCsv}>
          Download this table (CSV)
        </button>
      )}
    </>
  )
}

// Rotations entered in OpenField as annotations, drawn as each player's stints per quarter.
const ROT_COLOURS = ['#E31B23', '#e9e9ec', '#f2b33d', '#4f9bff', '#4fc483', '#c58bff']

function RotationsPanel({ token, region, activityId }) {
  const [rot, setRot] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => { setRot(null); setError(null) }, [activityId])

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      setRot(await fetchRotations({ token, region, activityId }))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const names = useMemo(() => [...new Set((rot?.stints || []).map((x) => x.name))], [rot])
  const colour = (n) => ROT_COLOURS[names.indexOf(n) % ROT_COLOURS.length]
  const players = useMemo(() => {
    const m = new Map()
    for (const x of rot?.stints || []) {
      if (!m.has(x.player)) m.set(x.player, [])
      m.get(x.player).push(x)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [rot])
  const quarters = rot?.periods?.length ? rot.periods : null
  const clock = (t, q) => {
    const p = quarters?.find((x) => x.quarter === q)
    if (!p) return ''
    const secs = Math.max(0, Math.round(t - p.start))
    return `Q${q} ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
  }

  return (
    <Fold
      title="Rotations"
      count={rot ? (rot.found ? `${rot.stints.length} annotations · ${players.length} players` : 'none found') : 'from OpenField annotations'}
      note="Rotation / interchange annotations entered in OpenField for this game, drawn as each player's stints in each quarter."
    >
      {!rot && (
        <button type="button" className="toggle-btn" onClick={load} disabled={loading || !token}>
          {loading ? 'Loading from Catapult…' : 'Load rotations from OpenField'}
        </button>
      )}
      {error && <div className="tw-error" style={{ marginTop: 10 }}>{error}</div>}

      {rot && rot.found && (
        <>
          <div className="rot-legend">
            {names.map((n) => <span key={n}><i style={{ background: colour(n) }} />{n}</span>)}
          </div>
          <div className="rot-grid" style={{ gridTemplateColumns: `160px repeat(${quarters ? quarters.length : 1}, 1fr)` }}>
            <div />
            {(quarters || [{ quarter: 0 }]).map((q) => <div key={q.quarter} className="rot-qh">{q.quarter ? `Q${q.quarter}` : 'Game'}</div>)}
            {players.map(([p, xs]) => (
              <React.Fragment key={p}>
                <div className="rot-name">{p}</div>
                {(quarters || [{ quarter: 0, start: Math.min(...xs.map((x) => x.start)), end: Math.max(...xs.map((x) => x.end)) }]).map((q) => {
                  const len = Math.max(1, q.end - q.start)
                  return (
                    <div key={q.quarter} className="rot-track">
                      {xs.filter((x) => x.end > q.start && x.start < q.end).map((x, i) => {
                        const a = Math.max(x.start, q.start), b = Math.min(x.end, q.end)
                        const point = b - a < 1
                        return (
                          <div key={i} className={`rot-stint ${point ? 'pt' : ''}`}
                            style={{ left: `${((a - q.start) / len) * 100}%`, width: point ? undefined : `${((b - a) / len) * 100}%`, background: colour(x.name) }}
                            title={`${x.name} · ${clock(x.start, x.quarter || q.quarter)}${point ? '' : ` → ${clock(x.end, x.quarter || q.quarter)} (${Math.round((x.end - x.start) / 60)} min)`}`} />
                        )
                      })}
                    </div>
                  )
                })}
              </React.Fragment>
            ))}
          </div>
          <button type="button" className="select-link" style={{ marginTop: 8 }} onClick={load}>Reload</button>
        </>
      )}

      {rot && !rot.found && (
        <>
          <div className="tw-clear" style={{ borderLeftColor: '#f2b33d' }}>
            No rotation annotations came back from Catapult for this game. Either none were entered in OpenField, or
            they're stored somewhere the API doesn't expose. This is what each request returned:
          </div>
          <div className="summary-table-wrap" style={{ marginTop: 10 }}>
            <table className="summary-table">
              <thead><tr><th>Request</th><th>Status</th><th>Records</th><th>Sample</th></tr></thead>
              <tbody>
                {rot.tried.map((t, i) => (
                  <tr key={i}>
                    <td style={{ textAlign: 'left' }}>{t.endpoint}</td><td>{t.status ?? 'no response'}</td><td>{t.count}</td>
                    <td style={{ textAlign: 'left', maxWidth: 420, whiteSpace: 'normal', fontSize: 11 }}>
                      {t.sample ? (typeof t.sample === 'string' ? t.sample : JSON.stringify(t.sample).slice(0, 300)) : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="select-link" style={{ marginTop: 8 }} onClick={load}>Try again</button>
        </>
      )}
    </Fold>
  )
}

export default function GameReportTab({ token, region }) {
  const [games, setGames] = useState(null)
  const [gid, setGid] = useState('')
  const [report, setReport] = useState('bands')
  const [data, setData] = useState(null)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)
  const [peakMetric, setPeakMetric] = useState({ bands: 'm_per_min', zones: 'z80_m_per_min' })
  const pollRef = useRef(null)

  useEffect(() => {
    if (!token) return
    fetchGames({ token, region })
      .then((g) => { setGames(g); if (g.length) setGid(g[0].id) })
      .catch((e) => setError(e.message))
  }, [token, region])

  const loadReport = useCallback(async (id) => {
    setData(null)
    try {
      const out = await fetchGameReport(id)
      setData(out.cached ? out : null)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  // On picking a game: build it if it's downloaded, otherwise download it first (once per game).
  useEffect(() => {
    if (!gid) return undefined
    let cancelled = false
    setError(null)
    setData(null)
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    ;(async () => {
      try {
        let s = await fetchGameStatus(gid)
        if (cancelled) return
        if (s.cached) { setStatus(s); loadReport(gid); return }
        s = await startGameDownload({ token, region, activityId: gid })
        setStatus(s)
        pollRef.current = setInterval(async () => {
          const st = await fetchGameStatus(gid).catch(() => null)
          if (!st || cancelled) return
          setStatus(st)
          if (!st.running) {
            clearInterval(pollRef.current)
            pollRef.current = null
            if (st.cached) loadReport(gid)
            else if (st.error) setError(st.error)
          }
        }, 1500)
      } catch (e) {
        setError(e.message)
      }
    })()
    return () => { cancelled = true; if (pollRef.current) clearInterval(pollRef.current) }
  }, [gid]) // eslint-disable-line react-hooks/exhaustive-deps

  const game = games?.find((g) => g.id === gid)
  const d = data
  const pk = useMemo(() => {
    const m = {}
    for (const r of d?.peaks || []) m[`${r.window}|${r.key}`] = r
    return m
  }, [d])
  const peakTile = (w, key, name) => {
    const r = pk[`${w}|${key}`] || {}
    return (
      <Tile key={`${w}${key}`} label={`Peak ${w} · ${name}`} value={r.value === null || r.value === undefined ? '–' : Math.round(r.value)}
        unit="m/min" sub={r.player ? `${r.player} · ${r.when}` : '–'} tone="red" />
    )
  }
  const peakKeys = report === 'bands' ? ['m_per_min', 'hsr_m_per_min', 'sprint_m_per_min'] : ['z80_m_per_min', 'z90_m_per_min']
  const pm = d?.peak_metrics || {}
  const metric = peakMetric[report]

  const peakRows = peakKeys.flatMap((k) =>
    PEAK_SHOW.map((w) => {
      const r = pk[`${w}|${k}`] || {}
      return { id: `${k}${w}`, metric: pm[k], window: w, value: r.value, player: r.player || '–', when: r.player ? r.when : '–' }
    })
  )
  const top = pk[`1 min|${peakKeys[0]}`]
  const csvBase = game ? `${game.name} ${game.date} ${report}`.replace(/\s+/g, '-').toLowerCase() : 'game'

  return (
    <div className="tw">
      <div className="tw-head">
        <div>
          <div className="tw-title">{game?.name || 'Game Report'}</div>
          <div className="tw-sub">
            Game Report{game ? ` · ${fmtDay(game.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}` : ''} · 10Hz from Catapult
          </div>
        </div>
        {games && games.length > 0 && (
          <select className="config-select tw-head-select" value={gid} onChange={(e) => setGid(e.target.value)} style={{ minWidth: 260 }}>
            {games.map((g) => (
              <option key={g.id} value={g.id}>{g.name} · {fmtDay(g.date)}</option>
            ))}
          </select>
        )}
      </div>

      {!token && <div className="tw-error">Enter your token in the sidebar to list games.</div>}
      {error && <div className="tw-error">{error}</div>}
      {games && games.length === 0 && (
        <div className="tw-clear">No games found. Games are activities tagged MD in OpenField, or named like a round, final or "vs".</div>
      )}

      <div className="tw-seg">
        {Object.entries(REPORTS).map(([k, label]) => (
          <button key={k} type="button" className={`tw-seg-btn ${report === k ? 'active' : ''}`} onClick={() => setReport(k)}>{label}</button>
        ))}
      </div>

      {status?.running && (
        <div className="tw-sync">
          <span className="tw-dot run" />
          <span>Downloading 10Hz data from Catapult (about a minute, once per game) · {status.message}</span>
        </div>
      )}
      {gid && !d && !status?.running && !error && <p className="field-hint">Building the game report…</p>}

      {d && report === 'bands' && (
        <>
          <div className="tw-tiles">
            <Tile label="Team distance" value={(d.team.distance_m / 1000).toFixed(1)} unit="km" sub={`${d.players.length} players`} />
            <Tile label="Team HSR" value={n0(d.team.hsr_m)} unit="m" sub={`> ${(d.rules.hsr_kmh / 3.6).toFixed(1)} m/s (${d.rules.hsr_kmh} km/h)`} />
            <Tile label="Team sprint" value={n0(d.team.sprint_m)} unit="m" sub={`> ${(d.rules.sprint_kmh / 3.6).toFixed(0)} m/s (${d.rules.sprint_kmh} km/h)`} />
            {peakTile('30 s', 'm_per_min', 'm/min')}
            {peakTile('1 min', 'm_per_min', 'm/min')}
            {peakTile('5 min', 'm_per_min', 'm/min')}
          </div>
        </>
      )}
      {d && report === 'zones' && (
        <div className="tw-tiles">
          <Tile label="Team >80% max" value={n0(d.team.z80_m)} unit="m" sub={`${d.team.z80_players} players`} />
          <Tile label="Team >90% max" value={n0(d.team.z90_m)} unit="m" sub={`${d.team.z90_players} players`} />
          <Tile label="Reached 90%" value={d.team.reached_90} unit={`of ${d.team.with_max}`} sub="players with a tested max" tone="ok" />
          {peakTile('30 s', 'z80_m_per_min', '>80%')}
          {peakTile('1 min', 'z80_m_per_min', '>80%')}
          {peakTile('5 min', 'z80_m_per_min', '>80%')}
        </div>
      )}

      {d && (
        <>
          <Fold
            title="Game peaks"
            count={top?.player ? `best 1 min ${Math.round(top.value)} ${pm[peakKeys[0]]}, ${top.player}` : ''}
            note="The best single window by any player, on-field time only. Time is how far into the quarter the window started."
            open
          >
            <Table
              columns={[
                { key: 'metric', label: 'Metric' }, { key: 'window', label: 'Window' },
                { key: 'value', label: 'Peak (m/min)', fmt: n1 }, { key: 'player', label: 'Player' }, { key: 'when', label: 'When' },
              ]}
              rows={peakRows}
            />
          </Fold>

          {report === 'bands' ? (
            <Fold
              title="Players"
              count={`${d.players.length} players · distance, HSR, sprint, accels`}
              note={`Team-wide speed bands: HSR above ${d.rules.hsr_kmh} km/h (${(d.rules.hsr_kmh / 3.6).toFixed(1)} m/s), sprint above ${d.rules.sprint_kmh} km/h (${(d.rules.sprint_kmh / 3.6).toFixed(0)} m/s). Bars compare players.`}
              open
            >
              <Table
                csvName={`${csvBase}.csv`}
                columns={[
                  { key: 'player', label: 'Player' }, { key: 'minutes', label: 'Min', fmt: n1 },
                  { key: 'distance_m', label: 'Distance (m)', fmt: n0, bar: true }, { key: 'm_per_min', label: 'm/min', fmt: n1 },
                  { key: 'hsr_m', label: 'HSR (m)', fmt: n0, bar: true }, { key: 'hsr_m_per_min', label: 'HSR m/min', fmt: n1 },
                  { key: 'hsr_efforts', label: 'HSR efforts', fmt: n0 }, { key: 'sprint_m', label: 'Sprint (m)', fmt: n0, bar: true },
                  { key: 'sprint_efforts', label: 'Sprint efforts', fmt: n0 }, { key: 'max_kmh', label: 'Top speed (km/h)', fmt: n1 },
                  { key: 'accels', label: 'Accels', fmt: n0 }, { key: 'decels', label: 'Decels', fmt: n0 },
                  { key: 'player_load', label: 'Player Load', fmt: n0 },
                ]}
                rows={d.players}
              />
            </Fold>
          ) : (
            <Fold
              title="Players"
              count={`${d.team.reached_90} of ${d.team.with_max} with a tested max reached 90%`}
              note="Distance above 80% and 90% of each player's own max velocity. % of max is the game's top speed against that max."
              open
            >
              <Table
                csvName={`${csvBase}.csv`}
                initialSort={{ key: 'pct_max', dir: -1 }}
                columns={[
                  { key: 'player', label: 'Player' },
                  { key: 'pct_max', label: '% of max', fmt: (v) => (v === null || v === undefined ? '–' : `${(v * 100).toFixed(1)}%`), bar: true, max: 1, csv: (v) => (v == null ? '' : (v * 100).toFixed(1)) },
                  { key: 'z80_m', label: '>80% (m)', fmt: n0, bar: true }, { key: 'z90_m', label: '>90% (m)', fmt: n0, bar: true },
                  { key: 'z80_efforts', label: '>80% efforts', fmt: n0 }, { key: 'efforts_90', label: 'Efforts ≥90%', fmt: n0 },
                  { key: 'max_kmh', label: 'Top speed (km/h)', fmt: n1 }, { key: 'player_max_kmh', label: 'Max (km/h)', fmt: n2 },
                  { key: 'at80', label: '80% at (km/h)', fmt: n1 }, { key: 'at90', label: '90% at (km/h)', fmt: n1 },
                  { key: 'minutes', label: 'Min', fmt: n1 },
                ]}
                rows={d.players.map((r) => ({
                  ...r,
                  at80: r.player_max_kmh ? r.player_max_kmh * 0.8 : null,
                  at90: r.player_max_kmh ? r.player_max_kmh * 0.9 : null,
                }))}
              />
              {d.no_max.length > 0 && (
                <p className="field-hint" style={{ marginTop: 8 }}>No tested max velocity, so no individual zones: {d.no_max.join(', ')}.</p>
              )}
            </Fold>
          )}

          <Fold title="Peak windows by player" count="each player's best 30 s to 5 min"
            note="Each player's best 30 s to 5 min, on-field time only. Sorted by their 1 min peak.">
            <div className="tw-seg" style={{ marginBottom: 10 }}>
              {peakKeys.map((k) => (
                <button key={k} type="button" className={`tw-seg-btn ${metric === k ? 'active' : ''}`}
                  onClick={() => setPeakMetric((s) => ({ ...s, [report]: k }))}>{pm[k]}</button>
              ))}
            </div>
            <Table
              initialSort={{ key: 'w_1 min', dir: -1 }}
              columns={[{ key: 'player', label: 'Player' }, ...d.peak_windows.map((w) => ({ key: `w_${w}`, label: w, fmt: n1 }))]}
              rows={d.players.map((r) => ({ player: r.player, ...Object.fromEntries(d.peak_windows.map((w) => [`w_${w}`, r[`peak_${metric}_${w}`]])) }))}
            />
          </Fold>

          <Fold
            title="By quarter"
            count={(() => {
              const k = report === 'bands' ? 'm_per_min' : 'z80_m'
              const best = [...d.quarters].sort((a, b) => (b[k] ?? -1) - (a[k] ?? -1))[0]
              return best ? (report === 'bands' ? `highest intensity in Q${best.quarter}` : `most above 80% of max in Q${best.quarter}`) : ''
            })()}
            note="Whole team, on-field time."
          >
            <Table
              columns={report === 'bands'
                ? [{ key: 'q', label: 'Quarter' }, { key: 'distance_m', label: 'Distance (m)', fmt: n0 }, { key: 'm_per_min', label: 'm/min', fmt: n1 },
                  { key: 'hsr_m', label: 'HSR (m)', fmt: n0 }, { key: 'sprint_m', label: 'Sprint (m)', fmt: n0 }]
                : [{ key: 'q', label: 'Quarter' }, { key: 'z80_m', label: '>80% max (m)', fmt: n0 }, { key: 'z90_m', label: '>90% max (m)', fmt: n0 }]}
              rows={d.quarters.map((q) => ({ ...q, q: `Q${q.quarter}` }))}
            />
          </Fold>

          <RotationsPanel token={token} region={region} activityId={gid} />

          <div className="tw-notes">
            <p><strong>On-field time</strong> is estimated from the data: a player standing still near the interchange counts as off. Within a minute of OpenField for most quarters.</p>
            <p>
              <strong>Speed-zone distance</strong> (HSR, sprint, % of max) counts efforts held at least {d.rules.band_min_s} s, as OpenField does.{' '}
              <strong>Efforts ≥90%</strong> need {d.rules.effort_min_s} s, the same rule as the speed flag.
            </p>
            <p>
              <strong>Max velocity</strong> for % of max comes from Speed Exposure (override, OpenField's stored max or the conditioning workbook).{' '}
              <strong>Accels/decels:</strong> beyond ±3 m/s² for 0.3 s.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
