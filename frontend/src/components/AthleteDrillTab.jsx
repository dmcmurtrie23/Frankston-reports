import React, { useEffect, useMemo, useState } from 'react'
import ScatterChart from './ScatterChart.jsx'
import ButtonSlicer from './ButtonSlicer.jsx'
import { ATHLETE_PARAMS, groupAndAggregate, uniqueSorted } from '../utils/aggregate.js'

// Port of the "Athlete Drill w/ Period" page from the Michigan Power BI
// report: slicers for Year, Athlete, Activity, Position, Period and Week
// Number, and a scatter of each athlete's summed Explosive Distance (x) v
// Explosive Efforts (y). The axes can be switched to any other metric,
// which is also the fallback when the account has no explosive parameters.

const EXPLOSIVE_METRICS = [
  { key: 'explosive_distance', label: 'Explosive Distance (m)', decimals: 1 },
  { key: 'explosive_efforts', label: 'Explosive Efforts', decimals: 0 },
  { key: 'explosive_min', label: 'Explosive Efforts/min', decimals: 2 },
]

function formatDurationHMS(totalSeconds) {
  const n = Number(totalSeconds)
  if (!Number.isFinite(n)) return '—'
  const secs = Math.max(0, Math.round(n))
  const pad = (x) => String(x).padStart(2, '0')
  return `${pad(Math.floor(secs / 3600))}:${pad(Math.floor((secs % 3600) / 60))}:${pad(secs % 60)}`
}

function formatFor(metric) {
  if (!metric) return (v) => String(v)
  if (metric.format === 'duration') return formatDurationHMS
  const d = typeof metric.decimals === 'number' ? metric.decimals : 0
  return (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(d) : '—')
}

// ISO-8601 week number + the Monday that week starts on.
function isoWeek(iso) {
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
  return { week, monday: monday.toISOString().slice(0, 10) }
}

function shortDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export default function AthleteDrillTab({ rows }) {
  // Attach year + week to every row once.
  const enriched = useMemo(
    () =>
      rows.map((r) => {
        const w = isoWeek(r.activity_date)
        return {
          ...r,
          _year: r.activity_date && r.activity_date !== '(no date)' ? r.activity_date.slice(0, 4) : null,
          _week: w ? w.week : null,
          _weekStart: w ? w.monday : null,
        }
      }),
    [rows]
  )

  const hasExplosive = useMemo(
    () => rows.some((r) => r.explosive_efforts !== null && r.explosive_efforts !== undefined),
    [rows]
  )
  const metrics = useMemo(
    () => [...(hasExplosive ? EXPLOSIVE_METRICS : []), ...ATHLETE_PARAMS],
    [hasExplosive]
  )

  const [xKey, setXKey] = useState('explosive_distance')
  const [yKey, setYKey] = useState('explosive_efforts')
  useEffect(() => {
    // Match the Power BI page when the data has explosive params; otherwise
    // fall back to HS Distance v Hard Accels.
    setXKey(hasExplosive ? 'explosive_distance' : 'hs_distance')
    setYKey(hasExplosive ? 'explosive_efforts' : 'hard_accels')
  }, [hasExplosive])

  const [year, setYear] = useState('')
  const [athlete, setAthlete] = useState('')
  const [activity, setActivity] = useState('')
  const [positions, setPositions] = useState([])
  const [periods, setPeriods] = useState([])
  const [weeks, setWeeks] = useState([])

  const years = useMemo(() => uniqueSorted(enriched.map((r) => r._year)), [enriched])
  const byYear = useMemo(() => (year ? enriched.filter((r) => r._year === year) : enriched), [enriched, year])

  // Slicer options cascade from the year so stale choices don't linger.
  const athletes = useMemo(() => uniqueSorted(byYear.map((r) => r.athlete_name)), [byYear])
  const activityNames = useMemo(() => uniqueSorted(byYear.map((r) => r.activity_name)), [byYear])
  const positionNames = useMemo(() => uniqueSorted(byYear.map((r) => r.position_name)), [byYear])
  const periodNames = useMemo(() => uniqueSorted(byYear.map((r) => r.period_name)), [byYear])
  const weekOptions = useMemo(() => {
    const m = new Map()
    for (const r of byYear) if (r._week !== null && !m.has(r._week)) m.set(r._week, r._weekStart)
    return Array.from(m.entries())
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
      .map(([wk, start]) => `${wk}|${start}`)
  }, [byYear])

  useEffect(() => {
    if (athlete && !athletes.includes(athlete)) setAthlete('')
    if (activity && !activityNames.includes(activity)) setActivity('')
    setPositions((cur) => cur.filter((p) => positionNames.includes(p)))
    setPeriods((cur) => cur.filter((p) => periodNames.includes(p)))
    setWeeks((cur) => cur.filter((w) => weekOptions.includes(w)))
  }, [athletes, activityNames, positionNames, periodNames, weekOptions]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const weekSet = new Set(weeks.map((w) => Number(w.split('|')[0])))
    return byYear.filter(
      (r) =>
        (!athlete || r.athlete_name === athlete) &&
        (!activity || r.activity_name === activity) &&
        (positions.length === 0 || positions.includes(r.position_name)) &&
        (periods.length === 0 || periods.includes(r.period_name)) &&
        (weekSet.size === 0 || weekSet.has(r._week))
    )
  }, [byYear, athlete, activity, positions, periods, weeks])

  const xMetric = metrics.find((m) => m.key === xKey) || metrics[0]
  const yMetric = metrics.find((m) => m.key === yKey) || metrics[1] || metrics[0]

  // One point per athlete: their SUM over every row left after the slicers
  // (Power BI's default "Sum" aggregation). Rates are recomputed from sums.
  const points = useMemo(
    () =>
      groupAndAggregate(filtered, 'athlete_name', 'sum').map((r) => ({
        label: r.athlete_name,
        x: r[xMetric?.key],
        y: r[yMetric?.key],
      })),
    [filtered, xMetric, yMetric]
  )

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">⚡</div>
        <h2>No data yet</h2>
        <p>Fetch a date range to use the Athlete Drill view.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <span className="card-title card-title-accent">Athlete Drill w/ Period</span>
          <span className="field-hint">{points.length} athletes · {filtered.length} rows</span>
        </div>
        <div className="card-body">
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
            <div>
              <span className="sidebar-label" style={{ display: 'block', marginBottom: 6 }}>Year</span>
              <select className="config-select" value={year} onChange={(e) => setYear(e.target.value)} style={{ minWidth: 110 }}>
                <option value="">All</option>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <span className="sidebar-label" style={{ display: 'block', marginBottom: 6 }}>Athlete</span>
              <select className="config-select" value={athlete} onChange={(e) => setAthlete(e.target.value)} style={{ minWidth: 200 }}>
                <option value="">All</option>
                {athletes.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <span className="sidebar-label" style={{ display: 'block', marginBottom: 6 }}>Activity</span>
              <select className="config-select" value={activity} onChange={(e) => setActivity(e.target.value)} style={{ minWidth: 220 }}>
                <option value="">All</option>
                {activityNames.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <span className="sidebar-label" style={{ display: 'block', marginBottom: 6 }}>X axis</span>
              <select className="config-select" value={xMetric?.key} onChange={(e) => setXKey(e.target.value)} style={{ minWidth: 180 }}>
                {metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <span className="sidebar-label" style={{ display: 'block', marginBottom: 6 }}>Y axis</span>
              <select className="config-select" value={yMetric?.key} onChange={(e) => setYKey(e.target.value)} style={{ minWidth: 180 }}>
                {metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </div>
          </div>
          <ButtonSlicer label="Position" options={positionNames} selected={positions} onChange={setPositions} />
          <ButtonSlicer label="Period" options={periodNames} selected={periods} onChange={setPeriods} />
          {!hasExplosive && (
            <p className="field-hint" style={{ marginTop: 4 }}>
              This account didn't return Explosive Efforts / Explosive Distance parameters, so the chart defaults to
              HS Distance v Hard Accels. Pick any metric from the axis menus.
            </p>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '1 1 640px', minWidth: 0 }}>
          <div className="card-header">
            <span className="card-title card-title-accent">
              {yMetric?.label} v {xMetric?.label}
            </span>
          </div>
          <div className="card-body">
            <ScatterChart
              points={points}
              xLabel={xMetric?.label}
              yLabel={yMetric?.label}
              title={`${yMetric?.label} v ${xMetric?.label}`}
              xFormat={formatFor(xMetric)}
              yFormat={formatFor(yMetric)}
            />
          </div>
        </div>
        <div className="card" style={{ flex: '0 0 170px' }}>
          <div className="card-body">
            <ButtonSlicer
              label="Week"
              options={weekOptions}
              selected={weeks}
              onChange={setWeeks}
              vertical
              render={(w) => {
                const [wk, start] = w.split('|')
                return `Wk ${wk} · ${shortDate(start)}`
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
