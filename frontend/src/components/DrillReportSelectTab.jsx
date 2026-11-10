import React, { useEffect, useMemo, useState } from 'react'
import ButtonSlicer from './ButtonSlicer.jsx'
import { deriveRow, uniqueSorted } from '../utils/aggregate.js'
import {
  METRICS, MARK, isNum, mean, playerValue, drillValue, prettyDate, addDays, ROW_H, HEAD_H, MetricColumn,
} from './DrillReportTab.jsx'

// "Drill Report Select": the Drill Report board, but picked by WEEK from a
// list down the right-hand side (like the Athlete Drill tab) instead of one
// session. Values cover every session in the selected week(s):
//   volume -> each player's total across those sessions (per drill: averaged across players)
//   rate / max / mean -> as on the Drill Report
// The red marker is the rolling average of the same value over the last N
// weeks (ending at the latest selected week) — like the report's "Weekly
// Total Measure Volume Rolling Average" (current + previous 3 weeks).

// ISO week key + the Monday it starts on.
function weekOf(iso) {
  if (!iso || iso === '(no date)') return null
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  const day = d.getUTCDay() || 7
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() - day + 1)
  const thursday = new Date(d)
  thursday.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7)
  return { key: monday.toISOString().slice(0, 10), week }
}

function shortDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export default function DrillReportSelectTab({ rows }) {
  const derived = useMemo(
    () =>
      rows.map((r) => {
        const w = weekOf(r.activity_date)
        return { ...deriveRow(r), _weekKey: w ? w.key : null, _weekNo: w ? w.week : null }
      }),
    [rows]
  )

  // Weeks (newest first), keyed by their Monday.
  const weeks = useMemo(() => {
    const m = new Map()
    for (const r of derived) if (r._weekKey && !m.has(r._weekKey)) m.set(r._weekKey, r._weekNo)
    return Array.from(m.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, no]) => ({ key, no }))
  }, [derived])
  const weekNo = useMemo(() => Object.fromEntries(weeks.map((w) => [w.key, w.no])), [weeks])

  const [selWeeks, setSelWeeks] = useState([])
  const [sessionsSel, setSessionsSel] = useState([])
  const [rollingWeeks, setRollingWeeks] = useState(4)
  const [rowMode, setRowMode] = useState('players')
  const [sortKey, setSortKey] = useState('name')
  const [positions, setPositions] = useState([])
  const [drills, setDrills] = useState([])
  const [tip, setTip] = useState(null)

  // Default (and fallback) to the latest week.
  useEffect(() => {
    const valid = selWeeks.filter((k) => weekNo[k] !== undefined)
    if (valid.length === 0 && weeks.length) setSelWeeks([weeks[0].key])
    else if (valid.length !== selWeeks.length) setSelWeeks(valid)
  }, [weeks, weekNo]) // eslint-disable-line react-hooks/exhaustive-deps
  const activeWeeks = selWeeks.length ? selWeeks : weeks.slice(0, 1).map((w) => w.key)

  const inWeeks = useMemo(() => derived.filter((r) => activeWeeks.includes(r._weekKey)), [derived, activeWeeks])

  // Sessions inside the selected week(s) — optional narrowing.
  const sessionOptions = useMemo(() => {
    const m = new Map()
    for (const r of inWeeks) {
      const id = String(r.activity_id)
      if (!m.has(id)) m.set(id, { id, name: r.activity_name || id, date: r.activity_date || '' })
    }
    return Array.from(m.values()).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
  }, [inWeeks])
  const sessionById = useMemo(() => Object.fromEntries(sessionOptions.map((s) => [s.id, s])), [sessionOptions])
  useEffect(() => { setSessionsSel((c) => c.filter((id) => sessionById[id])) }, [sessionById])

  const positionNames = useMemo(() => uniqueSorted(derived.map((r) => r.position_name)), [derived])
  const drillNames = useMemo(() => uniqueSorted(inWeeks.map((r) => r.period_name || '(no period)')), [inWeeks])
  useEffect(() => { setDrills((c) => c.filter((d) => drillNames.includes(d))) }, [drillNames])

  // Position + drill filters apply to the selection AND to the rolling weeks.
  const keep = (r) =>
    (positions.length === 0 || positions.includes(r.position_name)) &&
    (drills.length === 0 || drills.includes(r.period_name || '(no period)'))

  const labelOf = (r) => (rowMode === 'players' ? r.athlete_name : r.period_name || '(no period)')
  const valueFn = rowMode === 'players' ? playerValue : drillValue

  const hasOptional = (key) => rows.some((r) => isNum(r[key]))
  const metrics = METRICS.filter((m) => !m.optional || hasOptional(m.key))
  const missing = METRICS.filter((m) => m.optional && !hasOptional(m.key))

  // Rolling window: the N weeks ending at the latest selected week.
  const anchor = [...activeWeeks].sort().pop()
  const windowWeeks = useMemo(() => {
    if (!anchor) return []
    const from = addDays(anchor, -7 * (Math.max(1, rollingWeeks) - 1))
    return weeks.filter((w) => w.key >= from && w.key <= anchor).map((w) => w.key)
  }, [weeks, anchor, rollingWeeks])

  const { labels, table } = useMemo(() => {
    const sel = inWeeks.filter(
      (r) => keep(r) && (sessionsSel.length === 0 || sessionsSel.includes(String(r.activity_id)))
    )
    const cur = new Map()
    for (const r of sel) {
      const l = labelOf(r)
      if (!cur.has(l)) cur.set(l, [])
      cur.get(l).push(r)
    }
    // week -> label -> rows (for the rolling marker)
    const wk = new Map()
    for (const r of derived) {
      if (!windowWeeks.includes(r._weekKey) || !keep(r)) continue
      if (!wk.has(r._weekKey)) wk.set(r._weekKey, new Map())
      const m = wk.get(r._weekKey)
      const l = labelOf(r)
      if (!m.has(l)) m.set(l, [])
      m.get(l).push(r)
    }
    const t = {}
    for (const [label, rs] of cur.entries()) {
      t[label] = {}
      for (const m of metrics) {
        const refs = windowWeeks.map((w) => valueFn(wk.get(w)?.get(label) || [], m)).filter(isNum)
        t[label][m.key] = { value: valueFn(rs, m), ref: mean(refs), refN: refs.length }
      }
    }
    const ls = Object.keys(t)
    if (sortKey === 'name') ls.sort((a, b) => a.localeCompare(b))
    else ls.sort((a, b) => (t[b][sortKey]?.value ?? -Infinity) - (t[a][sortKey]?.value ?? -Infinity))
    return { labels: ls, table: t }
  }, [inWeeks, derived, sessionsSel, positions, drills, rowMode, windowWeeks, sortKey, metrics.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const onHover = (e, d, metric, fmt) => {
    if (!e) return setTip(null)
    const box = e.currentTarget.closest('.drill-board').getBoundingClientRect()
    setTip({ x: e.clientX - box.left + 14, y: e.clientY - box.top + 14, d, metric, fmt })
  }

  const title = (() => {
    const nos = [...activeWeeks].sort().map((k) => weekNo[k])
    if (nos.length === 0) return 'Drill Report'
    return nos.length === 1 ? `Week ${nos[0]}` : `Weeks ${nos.join(', ')}`
  })()

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">⚡</div>
        <h2>No data yet</h2>
        <p>Fetch a date range to use the Drill Report Select.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-body">
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
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
              <span className="sidebar-label" style={{ display: 'block', marginBottom: 6 }}>Rolling avg (weeks)</span>
              <input
                type="number"
                min={1}
                max={52}
                className="config-select"
                value={rollingWeeks}
                onChange={(e) => setRollingWeeks(Math.max(1, Math.min(52, Number(e.target.value) || 1)))}
                style={{ width: 100, backgroundImage: 'none' }}
              />
            </div>
          </div>
          <ButtonSlicer
            label="Sessions"
            options={sessionOptions.map((s) => s.id)}
            selected={sessionsSel}
            onChange={setSessionsSel}
            render={(id) => `${shortDate(sessionById[id]?.date)} · ${sessionById[id]?.name}`}
          />
          <ButtonSlicer label="Position" options={positionNames} selected={positions} onChange={setPositions} />
          <ButtonSlicer label="Drills" options={drillNames} selected={drills} onChange={setDrills} />
          {missing.length > 0 && (
            <p className="field-hint" style={{ marginTop: 4 }}>
              Not shown — this account didn't return: {missing.map((m) => m.label).join(', ')}.
            </p>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div className="drill-board" style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div className="drill-board-head">
            <span className="drill-board-title">{title}</span>
            <span className="field-hint">
              {sessionsSel.length ? sessionsSel.length : sessionOptions.length} session
              {(sessionsSel.length || sessionOptions.length) === 1 ? '' : 's'} ·{' '}
              <span style={{ display: 'inline-block', width: 3, height: 11, background: MARK, verticalAlign: 'middle', borderRadius: 1 }} />{' '}
              {rollingWeeks}-week rolling avg ({windowWeeks.length} week{windowWeeks.length === 1 ? '' : 's'} of data)
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
              <div>{rollingWeeks}-week rolling avg: {tip.fmt(tip.d.ref)}{tip.d.refN ? ` (${tip.d.refN} weeks)` : ''}</div>
            </div>
          )}
        </div>

        <div className="card" style={{ flex: '0 0 170px', marginBottom: 0 }}>
          <div className="card-body">
            <ButtonSlicer
              label="Week"
              options={weeks.map((w) => w.key)}
              selected={selWeeks}
              onChange={(v) => setSelWeeks(v.length ? v : weeks.slice(0, 1).map((w) => w.key))}
              vertical
              render={(k) => `Wk ${weekNo[k]} · ${shortDate(k)}`}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
