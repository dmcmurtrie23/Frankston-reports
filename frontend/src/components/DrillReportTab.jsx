import React, { useEffect, useMemo, useState } from 'react'
import ButtonSlicer from './ButtonSlicer.jsx'
import { deriveRow, uniqueSorted } from '../utils/aggregate.js'

// Port of the MichiganFB Weekly AMS "Drill Report" bar pages, laid out like
// the report's player panel: one row per player (or per drill), one column per
// metric, every column sharing the same row order. Each bar is light grey with
// its value printed inside, and a red marker shows the rolling average over
// the last N days (the report's "Rolling Avg Duration" slicer, default 7).
//
// How values are worked out (mirrors the report's DAX):
//   volume -> total for the session (per player), or each player's drill
//             total averaged across players (per drill)
//   rate   -> per minute, from totals; per drill averaged across players
//   max    -> highest single value
//   mean   -> average of the rows

export const METRICS = [
  { key: 'total_player_load', label: 'Total Playerload', type: 'volume', decimals: 0 },
  { key: 'total_distance', label: 'Total Distance', type: 'volume', decimals: 0, unit: 'm' },
  { key: 'max_vel', label: 'Max Velocity', type: 'max', decimals: 1 },
  { key: 'max_effort_acceleration', label: 'Max Accel', type: 'max', decimals: 2 },
  // High-Speed COD = Michigan's "Gen2 HML Effort Count": accel bands 7+8 + decel bands 1+2 efforts.
  { key: 'hs_cod', label: 'High-Speed COD', type: 'volume', decimals: 0 },
  { key: 'hs_distance', label: 'High-Speed Running', type: 'volume', decimals: 0, unit: 'm' },
  { key: 'player_load_per_min', label: 'Player Load per Minute', type: 'rate', num: 'total_player_load', decimals: 2 },
  { key: 'accel_load_density_index', label: 'Accel Load Density', type: 'mean', decimals: 2, optional: true },
]

const BAR = '#6E6E6E' // mid grey so white values read clearly
export const MARK = '#E31B23' // Frankston red

export const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))
export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)

// One player's value over a set of rows (one session, chosen drills).
export function playerValue(rows, m) {
  if (rows.length === 0) return null
  const vals = (k) => rows.map((r) => r[k]).filter(isNum).map(Number)
  if (m.type === 'max') { const v = vals(m.key); return v.length ? Math.max(...v) : null }
  if (m.type === 'mean') return mean(vals(m.key))
  if (m.type === 'rate') {
    const num = vals(m.num).reduce((a, b) => a + b, 0)
    const dur = vals('total_duration').reduce((a, b) => a + b, 0)
    return dur > 0 && vals(m.num).length ? num / (dur / 60) : null
  }
  const v = vals(m.key)
  return v.length ? v.reduce((a, b) => a + b, 0) : null
}

// One drill's value: per-player value, averaged across players (max/mean use all rows).
export function drillValue(rows, m) {
  if (rows.length === 0) return null
  if (m.type === 'max' || m.type === 'mean') return playerValue(rows, m)
  const byAthlete = new Map()
  for (const r of rows) {
    if (!byAthlete.has(r.athlete_name)) byAthlete.set(r.athlete_name, [])
    byAthlete.get(r.athlete_name).push(r)
  }
  return mean(Array.from(byAthlete.values()).map((rs) => playerValue(rs, m)).filter(isNum))
}

export function prettyDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso || '—'
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function niceTicks(max) {
  if (!(max > 0)) return [0]
  const raw = max / 3
  const p = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((s) => s * p).find((s) => s >= raw) || raw
  const out = []
  // Ticks run up to the first one at or above the max, so bars never overflow.
  for (let t = 0; out.length < 50; t += step) {
    out.push(Number(t.toPrecision(12)))
    if (t >= max - 1e-9) break
  }
  return out
}

function tickLabel(t) {
  if (t >= 10000) return `${Math.round(t / 1000)}k`
  if (t >= 1000 && t % 1000 === 0) return `${t / 1000}k`
  return Number.isInteger(t) ? String(t) : t.toFixed(1)
}

export const ROW_H = 40
export const HEAD_H = 34
const AXIS_H = 26

export function MetricColumn({ metric, items, rollingDays, onHover }) {
  // Horizontal positions are percentages so text never stretches with the column.
  const padL = 4
  const padR = 9
  const plotW = 100 - padL - padR
  const max = Math.max(1e-9, ...items.flatMap((d) => [d.value, d.ref]).filter(isNum))
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1] || max
  const xp = (v) => padL + (plotW * v) / top
  const x = (v) => `${xp(v)}%`
  const H = items.length * ROW_H + AXIS_H
  const fmt = (v) =>
    isNum(v) ? Number(v).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: metric.decimals }) : '—'
  return (
    <div className="drill-col">
      <div className="drill-col-head" style={{ height: HEAD_H }}>{metric.label}</div>
      <svg width="100%" height={H} style={{ display: 'block', overflow: 'visible' }}>
        {ticks.map((t) => (
          <line key={t} x1={x(t)} x2={x(t)} y1={0} y2={items.length * ROW_H} stroke="rgba(255,255,255,0.10)" strokeDasharray="2 3" />
        ))}
        {items.map((d, i) => {
          const y = i * ROW_H
          const bh = ROW_H - 12
          const w = isNum(d.value) ? Math.max(0, xp(d.value) - padL) : 0
          const inside = w > 30
          return (
            <g
              key={d.label}
              onMouseMove={(e) => onHover(e, d, metric, fmt)}
              onMouseLeave={() => onHover(null)}
            >
              <rect x="0" y={y} width="100%" height={ROW_H} fill="transparent" />
              {w > 0 && <rect x={`${padL}%`} y={y + 6} width={`${w}%`} height={bh} rx="2" fill={BAR} />}
              {isNum(d.ref) && (
                <rect x={x(d.ref)} y={y + 9} width="3" height={bh - 6} rx="1" fill={MARK} transform="translate(-1.5 0)" />
              )}
              <text
                x={inside ? `${padL + 4}%` : `${padL + w + 2}%`}
                y={y + ROW_H / 2 + 4}
                fontSize="11"
                fontWeight="700"
                fill="#ffffff"
              >
                {fmt(d.value)}
              </text>
            </g>
          )
        })}
        {ticks.map((t) => (
          <text key={`l${t}`} x={x(t)} y={items.length * ROW_H + 17} textAnchor="middle" fontSize="10" fill="#ffffff">
            {tickLabel(t)}
          </text>
        ))}
      </svg>
    </div>
  )
}

export default function DrillReportTab({ rows }) {
  const derived = useMemo(() => rows.map(deriveRow), [rows])

  const sessions = useMemo(() => {
    const m = new Map()
    for (const r of derived) {
      const id = String(r.activity_id)
      if (!m.has(id)) m.set(id, { id, name: r.activity_name || id, date: r.activity_date || '' })
    }
    return Array.from(m.values()).sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.name.localeCompare(b.name))
  }, [derived])

  const [sessionId, setSessionId] = useState('')
  const [rollingDays, setRollingDays] = useState(7)
  const [rowMode, setRowMode] = useState('players')
  const [sortKey, setSortKey] = useState('name')
  const [positions, setPositions] = useState([])
  const [drills, setDrills] = useState([])
  const [tip, setTip] = useState(null)

  useEffect(() => {
    if (!sessions.some((s) => s.id === sessionId)) setSessionId(sessions[0]?.id || '')
  }, [sessions, sessionId])
  const session = sessions.find((s) => s.id === sessionId)

  const positionNames = useMemo(() => uniqueSorted(derived.map((r) => r.position_name)), [derived])
  const sessionDrills = useMemo(
    () => uniqueSorted(derived.filter((r) => String(r.activity_id) === sessionId).map((r) => r.period_name || '(no period)')),
    [derived, sessionId]
  )
  useEffect(() => { setDrills((c) => c.filter((d) => sessionDrills.includes(d))) }, [sessionDrills])

  const filtered = useMemo(
    () =>
      derived.filter(
        (r) =>
          (positions.length === 0 || positions.includes(r.position_name)) &&
          (drills.length === 0 || drills.includes(r.period_name || '(no period)'))
      ),
    [derived, positions, drills]
  )

  // activity_id -> row key (player or drill) -> rows
  const index = useMemo(() => {
    const m = new Map()
    for (const r of filtered) {
      const a = String(r.activity_id)
      const k = rowMode === 'players' ? r.athlete_name : r.period_name || '(no period)'
      if (!m.has(a)) m.set(a, new Map())
      const am = m.get(a)
      if (!am.has(k)) am.set(k, [])
      am.get(k).push(r)
    }
    return m
  }, [filtered, rowMode])

  const windowIds = useMemo(() => {
    if (!session?.date) return [sessionId]
    const from = addDays(session.date, -(Math.max(1, rollingDays) - 1))
    return sessions.filter((s) => s.date && s.date >= from && s.date <= session.date).map((s) => s.id)
  }, [sessions, session, sessionId, rollingDays])

  const hasOptional = (key) => rows.some((r) => isNum(r[key]))
  const metrics = METRICS.filter((m) => !m.optional || hasOptional(m.key))
  const missing = METRICS.filter((m) => m.optional && !hasOptional(m.key))
  const valueFn = rowMode === 'players' ? playerValue : drillValue

  // table[label] = { [metricKey]: { value, ref, refN } }
  const { labels, table } = useMemo(() => {
    const cur = index.get(sessionId) || new Map()
    const t = {}
    for (const [label, rs] of cur.entries()) {
      t[label] = {}
      for (const m of metrics) {
        const refs = windowIds.map((id) => valueFn(index.get(id)?.get(label) || [], m)).filter(isNum)
        t[label][m.key] = { value: valueFn(rs, m), ref: mean(refs), refN: refs.length }
      }
    }
    let ls = Object.keys(t)
    if (sortKey === 'name') ls.sort((a, b) => a.localeCompare(b))
    else ls.sort((a, b) => (t[b][sortKey]?.value ?? -Infinity) - (t[a][sortKey]?.value ?? -Infinity))
    return { labels: ls, table: t }
  }, [index, sessionId, windowIds, metrics.length, valueFn, sortKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const onHover = (e, d, metric, fmt) => {
    if (!e) return setTip(null)
    const box = e.currentTarget.closest('.drill-board').getBoundingClientRect()
    setTip({ x: e.clientX - box.left + 14, y: e.clientY - box.top + 14, d, metric, fmt })
  }

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">⚡</div>
        <h2>No data yet</h2>
        <p>Fetch a date range to use the Drill Report.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-body">
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
            <div>
              <span className="sidebar-label" style={{ display: 'block', marginBottom: 6 }}>Session</span>
              <select className="config-select" value={sessionId} onChange={(e) => setSessionId(e.target.value)} style={{ minWidth: 300 }}>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>{prettyDate(s.date)} · {s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <span className="sidebar-label" style={{ display: 'block', marginBottom: 6 }}>Rows</span>
              <select className="config-select" value={rowMode} onChange={(e) => setRowMode(e.target.value)} style={{ minWidth: 120 }}>
                <option value="players">Players</option>
                <option value="drills">Drills</option>
              </select>
            </div>
            <div>
              <span className="sidebar-label" style={{ display: 'block', marginBottom: 6 }}>Sort by</span>
              <select className="config-select" value={sortKey} onChange={(e) => setSortKey(e.target.value)} style={{ minWidth: 170 }}>
                <option value="name">Name</option>
                {metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <span className="sidebar-label" style={{ display: 'block', marginBottom: 6 }}>Rolling avg (days)</span>
              <input
                type="number"
                min={1}
                max={365}
                className="config-select"
                value={rollingDays}
                onChange={(e) => setRollingDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
                style={{ width: 100, backgroundImage: 'none' }}
              />
            </div>
          </div>
          <ButtonSlicer label="Position" options={positionNames} selected={positions} onChange={setPositions} />
          <ButtonSlicer label="Drills" options={sessionDrills} selected={drills} onChange={setDrills} />
          {missing.length > 0 && (
            <p className="field-hint" style={{ marginTop: 4 }}>
              Not shown — this account didn't return: {missing.map((m) => m.label).join(', ')}.
            </p>
          )}
        </div>
      </div>

      <div className="drill-board">
        <div className="drill-board-head">
          <span className="drill-board-title">
            {session ? `${session.name}` : 'Drill Report'}
          </span>
          <span className="field-hint">
            {session ? prettyDate(session.date) : ''} ·{' '}
            <span style={{ display: 'inline-block', width: 3, height: 11, background: MARK, verticalAlign: 'middle', borderRadius: 1 }} />{' '}
            {rollingDays}-day rolling avg ({windowIds.length} session{windowIds.length === 1 ? '' : 's'})
          </span>
        </div>
        {labels.length === 0 ? (
          <p className="field-hint" style={{ padding: 16 }}>No data for this selection.</p>
        ) : (
          <div className="drill-grid">
            <div className="drill-names" style={{ paddingTop: HEAD_H }}>
              {labels.map((l) => (
                <div key={l} className="drill-name" style={{ height: ROW_H }} title={l}>{l}</div>
              ))}
            </div>
            {metrics.map((m) => (
              <MetricColumn
                key={m.key}
                metric={m}
                rollingDays={rollingDays}
                items={labels.map((l) => ({ label: l, ...table[l][m.key] }))}
                onHover={onHover}
              />
            ))}
          </div>
        )}
        {tip && (
          <div className="chart-tooltip" style={{ left: tip.x, top: tip.y }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>{tip.d.label}</div>
            <div>{tip.metric.label}: {tip.fmt(tip.d.value)}{tip.metric.unit ? ` ${tip.metric.unit}` : ''}</div>
            <div>{rollingDays}-day rolling avg: {tip.fmt(tip.d.ref)}{tip.d.refN ? ` (${tip.d.refN} sessions)` : ''}</div>
          </div>
        )}
      </div>
    </div>
  )
}
