import React, { useEffect, useMemo, useState } from 'react'
import DataTable from './DataTable.jsx'
import WeeklyTrendChart from './WeeklyTrendChart.jsx'
import { ATHLETE_PARAMS, groupAndAggregate, uniqueSorted, uniqueTags } from '../utils/aggregate.js'

function formatDurationHMS(totalSeconds) {
  const n = Number(totalSeconds)
  if (!Number.isFinite(n)) return '—'
  const secs = Math.max(0, Math.round(n))
  const pad = (x) => String(x).padStart(2, '0')
  return `${pad(Math.floor(secs / 3600))}:${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}`
}

function formatFor(param) {
  if (param.format === 'duration') return (v) => formatDurationHMS(v)
  const decimals = typeof param.decimals === 'number' ? param.decimals : 0
  return (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(decimals) : '—')
}

const SERIES_COLORS = ['#E31B23', '#E8ECEF', '#EDA100', '#4F9BFF', '#C58BFF', '#7CE38B', '#E356A6', '#9A9A9A']

// Trailing moving average over `window` activities (ignoring gaps).
function rollingAvg(values, window = 3) {
  return values.map((v, i) => {
    if (v === null || v === undefined || !Number.isFinite(v)) return null
    let sum = 0
    let cnt = 0
    for (let j = Math.max(0, i - window + 1); j <= i; j++) {
      const x = values[j]
      if (x !== null && x !== undefined && Number.isFinite(x)) {
        sum += x
        cnt += 1
      }
    }
    return cnt ? sum / cnt : null
  })
}

function prettyDate(iso) {
  if (!iso || iso === '(no date)') return '—'
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function shortDate(iso) {
  if (!iso || iso === '(no date)') return '—'
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

// Longitudinal reporting: pick one player, tick the activities you want, and
// see them side by side (one row per activity) plus a trend line for any
// metric across just those activities.
export default function LongitudinalTab({ rows, activities = [] }) {
  const athletes = useMemo(() => uniqueSorted(rows.map((r) => r.athlete_name)), [rows])
  const [selected, setSelected] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [chartMetrics, setChartMetrics] = useState(['total_distance'])
  const [showRolling, setShowRolling] = useState(false)
  const [chosenIds, setChosenIds] = useState(null) // Set of activity_ids, or null = all
  const [rangeIdx, setRangeIdx] = useState([0, 0]) // date slider [from, to] indexes into playerDates

  // activity_id -> tags (tags live on the activity list, not the stats rows).
  const tagsByActivity = useMemo(() => {
    const m = new Map()
    for (const a of activities) m.set(String(a.id), a.tags || [])
    return m
  }, [activities])
  const allTags = useMemo(() => uniqueTags(activities), [activities])

  useEffect(() => {
    if (athletes.length === 0) setSelected('')
    else if (!athletes.includes(selected)) setSelected(athletes[0])
  }, [athletes, selected])

  const playerRows = useMemo(
    () => (selected ? rows.filter((r) => r.athlete_name === selected) : []),
    [rows, selected]
  )

  // Every activity this player took part in (one row each, summed across
  // periods), most recent first.
  const allActivities = useMemo(() => {
    return groupAndAggregate(playerRows, ['activity_id', 'activity_name', 'activity_date'], 'sum').sort(
      (a, b) => String(b.activity_date).localeCompare(String(a.activity_date))
    )
  }, [playerRows])

  // Activities matching the tag filter (or all if none chosen). These are the
  // ones shown as chips and included in the table/chart.
  const tagMatched = useMemo(
    () =>
      tagFilter
        ? allActivities.filter((a) => (tagsByActivity.get(String(a.activity_id)) || []).includes(tagFilter))
        : allActivities,
    [allActivities, tagFilter, tagsByActivity]
  )

  // Distinct dates (oldest first) for the date-range slider.
  const playerDates = useMemo(
    () =>
      uniqueSorted(
        tagMatched.map((a) => a.activity_date).filter((d) => d && d !== '(no date)')
      ),
    [tagMatched]
  )

  // Reset the slider to the full range whenever the available dates change.
  useEffect(() => {
    setRangeIdx([0, Math.max(0, playerDates.length - 1)])
  }, [playerDates])

  const fromDate = playerDates[Math.min(rangeIdx[0], playerDates.length - 1)]
  const toDate = playerDates[Math.min(rangeIdx[1], playerDates.length - 1)]

  // Activities within the slider's date range (undated ones only when the
  // slider is at its full extent).
  const tagVisible = useMemo(() => {
    if (playerDates.length === 0) return tagMatched
    const full = rangeIdx[0] === 0 && rangeIdx[1] >= playerDates.length - 1
    return tagMatched.filter((a) => {
      const d = a.activity_date
      if (!d || d === '(no date)') return full
      return d >= fromDate && d <= toDate
    })
  }, [tagMatched, playerDates, rangeIdx, fromDate, toDate])

  // Reset the activity selection to "all" whenever the player or tag changes.
  useEffect(() => {
    setChosenIds(null)
  }, [selected, tagFilter])

  const isChosen = (id) => chosenIds === null || chosenIds.has(String(id))

  const toggleActivity = (id) => {
    const sid = String(id)
    setChosenIds((cur) => {
      const base = cur === null ? new Set(tagVisible.map((a) => String(a.activity_id))) : new Set(cur)
      if (base.has(sid)) base.delete(sid)
      else base.add(sid)
      return base
    })
  }

  const selectAll = () => setChosenIds(null)
  const clearAll = () => setChosenIds(new Set())

  // Activities actually shown (chosen), oldest first for the table + chart.
  const shown = useMemo(
    () =>
      tagVisible
        .filter((a) => isChosen(a.activity_id))
        .slice()
        .sort((a, b) => String(a.activity_date).localeCompare(String(b.activity_date)))
        .map((a) => ({ ...a, date_label: prettyDate(a.activity_date) })),
    [tagVisible, chosenIds]
  )

  // Total across the chosen activities.
  const tableRows = useMemo(() => {
    if (shown.length === 0) return []
    const chosenSet = new Set(shown.map((a) => String(a.activity_id)))
    const chosenRaw = playerRows.filter((r) => chosenSet.has(String(r.activity_id)))
    const total = groupAndAggregate(chosenRaw.map((r) => ({ ...r, _all: 'total' })), '_all', 'sum')[0]
    return [
      ...shown,
      { ...total, activity_name: 'TOTAL', date_label: '', _isTotal: true },
    ]
  }, [shown, playerRows])

  const columns = [
    { key: 'date_label', label: 'Date', bold: true },
    { key: 'activity_name', label: 'Activity' },
    ...ATHLETE_PARAMS,
  ]

  // Chart across the chosen activities. One or more metrics; when several are
  // picked they're indexed to each metric's own max so different scales stay
  // comparable on one axis (like the Player tab).
  const chartParams = useMemo(
    () =>
      ATHLETE_PARAMS.filter((p) => chartMetrics.includes(p.key)).map((p, i) => ({
        ...p,
        color: SERIES_COLORS[i % SERIES_COLORS.length],
      })),
    [chartMetrics]
  )
  const indexed = chartParams.length > 1

  const xLabels = useMemo(() => shown.map((a) => shortDate(a.activity_date)), [shown])
  const xFulls = useMemo(() => shown.map((a) => `${a.activity_name} · ${prettyDate(a.activity_date)}`), [shown])

  const chartSeries = useMemo(() => {
    const out = []
    for (const p of chartParams) {
      const f = formatFor(p)
      const raw = shown.map((a) => (typeof a[p.key] === 'number' && Number.isFinite(a[p.key]) ? a[p.key] : null))
      const max = Math.max(0, ...raw.filter((v) => v !== null))
      const scale = (v) => (v === null ? null : indexed ? (max > 0 ? (v / max) * 100 : 0) : v)
      out.push({
        id: p.key,
        color: p.color,
        dashed: false,
        values: raw.map(scale),
        tooltips: raw.map((v, i) => `${xFulls[i]}\n${p.label}: ${v === null ? '—' : f(v)}`),
      })
      if (showRolling) {
        const roll = rollingAvg(raw, 3)
        out.push({
          id: `${p.key}__roll`,
          color: p.color,
          dashed: true,
          values: roll.map(scale),
          tooltips: roll.map((v, i) => `${xFulls[i]}\n${p.label} 3-pt avg: ${v === null ? '—' : f(v)}`),
        })
      }
    }
    return out
  }, [chartParams, shown, xFulls, indexed, showRolling])

  const yFormat = useMemo(() => {
    if (indexed) return (v) => `${Math.round(v)}%`
    if (chartParams.length === 1) return formatFor(chartParams[0])
    return (v) => String(Math.round(v))
  }, [indexed, chartParams])

  const toggleMetric = (key) => {
    setChartMetrics((cur) => {
      if (cur.includes(key)) return cur.length === 1 ? cur : cur.filter((k) => k !== key)
      return [...cur, key]
    })
  }

  if (athletes.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">⚡</div>
        <h2>No athletes in this data</h2>
        <p>Fetch a date range with activity data to use longitudinal reporting.</p>
      </div>
    )
  }

  const chosenCount = shown.length

  return (
    <div>
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <span className="card-title card-title-accent">Player</span>
          <span className="field-hint">{chosenCount} of {tagVisible.length} activities selected</span>
        </div>
        <div className="card-body">
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
            <div>
              <span className="sidebar-label" style={{ display: 'block', marginBottom: 6 }}>Player</span>
              <select
                className="config-select"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                style={{ minWidth: 220 }}
              >
                {athletes.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <span className="sidebar-label" style={{ display: 'block', marginBottom: 6 }}>Tag</span>
              <select
                className="config-select"
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
                style={{ minWidth: 160 }}
              >
                <option value="">All tags</option>
                {allTags.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          {playerDates.length > 1 && (
            <div style={{ marginBottom: 16, maxWidth: 560 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <span className="sidebar-label">Date range</span>
                <span className="field-hint">
                  {prettyDate(fromDate)} → {prettyDate(toDate)}
                  {(rangeIdx[0] !== 0 || rangeIdx[1] !== playerDates.length - 1) && (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="select-link"
                        onClick={() => setRangeIdx([0, playerDates.length - 1])}
                      >
                        Reset
                      </button>
                    </>
                  )}
                </span>
              </div>
              <div className="range-slider">
                <div className="range-slider-track" />
                <div
                  className="range-slider-fill"
                  style={{
                    left: `${(rangeIdx[0] / (playerDates.length - 1)) * 100}%`,
                    right: `${100 - (rangeIdx[1] / (playerDates.length - 1)) * 100}%`,
                  }}
                />
                <input
                  type="range"
                  min={0}
                  max={playerDates.length - 1}
                  step={1}
                  value={rangeIdx[0]}
                  aria-label="From date"
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setRangeIdx(([, hi]) => [Math.min(v, hi), hi])
                  }}
                />
                <input
                  type="range"
                  min={0}
                  max={playerDates.length - 1}
                  step={1}
                  value={rangeIdx[1]}
                  aria-label="To date"
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setRangeIdx(([lo]) => [lo, Math.max(v, lo)])
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }} className="field-hint">
                <span>{shortDate(playerDates[0])}</span>
                <span>{shortDate(playerDates[playerDates.length - 1])}</span>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span className="sidebar-label">Activities</span>
            <button type="button" className="select-link" onClick={selectAll}>Select all</button>
            <span className="select-sep">·</span>
            <button type="button" className="select-link" onClick={clearAll}>Clear</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
            {tagVisible.map((a) => (
              <button
                key={a.activity_id}
                type="button"
                className={`toggle-btn ${isChosen(a.activity_id) ? 'active' : ''}`}
                onClick={() => toggleActivity(a.activity_id)}
                style={{ fontSize: 12, padding: '5px 10px' }}
              >
                {shortDate(a.activity_date)} · {a.activity_name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <span className="card-title card-title-accent">Activities — {selected}</span>
        </div>
        <div className="card-body">
          <DataTable
            columns={columns}
            rows={tableRows}
            emptyLabel="Select one or more activities above."
            rowClassName={(row) => (row._isTotal ? 'row-total' : '')}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title card-title-accent">Trend — {selected}</span>
          <button
            type="button"
            className={`toggle-btn ${showRolling ? 'active' : ''}`}
            onClick={() => setShowRolling((v) => !v)}
            title="Overlay a dashed 3-activity moving average for each metric"
          >
            3-pt Rolling Avg
          </button>
        </div>
        <div className="card-body">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {ATHLETE_PARAMS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`toggle-btn ${chartMetrics.includes(p.key) ? 'active' : ''}`}
                onClick={() => toggleMetric(p.key)}
                style={{ fontSize: 12, padding: '5px 10px' }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 12 }}>
            {chartParams.map((p) => (
              <span key={p.key} className="field-hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 14, height: 3, borderRadius: 2, background: p.color, display: 'inline-block' }} />
                {p.label}
              </span>
            ))}
            {showRolling && (
              <span className="field-hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 16, height: 0, borderTop: '2px dashed var(--cat-text-dim)', display: 'inline-block' }} />
                dashed = 3-pt avg
              </span>
            )}
            {indexed && <span className="field-hint">values indexed to each metric's own max (%)</span>}
          </div>

          <WeeklyTrendChart xLabels={xLabels} xFulls={xFulls} series={chartSeries} yFormat={yFormat} />
        </div>
      </div>
    </div>
  )
}
