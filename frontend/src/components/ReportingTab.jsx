import React, { useMemo } from 'react'
import { Timer, MapPin, Footprints, Gauge } from 'lucide-react'
import DataTable from './DataTable.jsx'
import { PERIOD_PARAMS, ATHLETE_PARAMS, GOALKEEPER_PARAMS, groupAndAggregate, buildComparisonMap } from '../utils/aggregate.js'

const GK_POSITIONS = new Set(['goalkeeper', 'goal keeper', 'gk'])
function isGoalkeeper(positionName) {
  return GK_POSITIONS.has(String(positionName || '').trim().toLowerCase())
}

function formatDurationHMS(totalSeconds) {
  const n = Number(totalSeconds)
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(n)) return '—'
  const secs = Math.max(0, Math.round(n))
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  const pad = (x) => String(x).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

function fmtNumber(v, decimals = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return v.toFixed(decimals)
}

export default function ReportingTab({ rows, activityName, compareMode, trainingAverage, matchAverage }) {
  const periodAverages = useMemo(() => groupAndAggregate(rows, 'period_name', 'mean'), [rows])

  const nonGkRows = useMemo(() => rows.filter((r) => !isGoalkeeper(r.position_name)), [rows])
  const gkRows = useMemo(() => rows.filter((r) => isGoalkeeper(r.position_name)), [rows])

  // Per-athlete-only totals (ignoring position, all players) drive the KPI
  // strip, kept separate from the position-split table below it.
  const athletePerName = useMemo(() => groupAndAggregate(rows, 'athlete_name', 'sum'), [rows])
  const athleteTotals = useMemo(
    () => groupAndAggregate(nonGkRows, ['athlete_name', 'position_name'], 'sum'),
    [nonGkRows]
  )
  const goalkeeperTotals = useMemo(
    () => groupAndAggregate(gkRows, ['athlete_name', 'position_name'], 'sum'),
    [gkRows]
  )

  const kpis = useMemo(() => {
    const n = athletePerName.length
    if (n === 0) return null
    const avg = (key) => {
      const vals = athletePerName.map((r) => r[key]).filter((v) => v !== null && v !== undefined)
      if (vals.length === 0) return null
      return vals.reduce((a, b) => a + b, 0) / vals.length
    }
    return {
      duration: avg('total_duration'),
      distance: avg('total_distance'),
      hsDistance: avg('hs_distance'),
      mMin: avg('m_min'),
    }
  }, [athletePerName])

  // Comparison lookup: for the active compare mode, map athlete_name -> that
  // athlete's Training/Match average row (from the Averages tab), so each
  // Athlete Totals cell can check whether it's above that same athlete's
  // average for the same metric.
  const comparisonByAthlete = useMemo(
    () => buildComparisonMap(compareMode, trainingAverage, matchAverage),
    [compareMode, trainingAverage, matchAverage]
  )

  const compareCellClassName = (row, col) => {
    if (!comparisonByAthlete) return ''
    if (col.key === 'athlete_name' || col.key === 'position_name') return ''
    const avgRow = comparisonByAthlete.get(row.athlete_name)
    if (!avgRow) return ''
    const cur = row[col.key]
    const avgVal = avgRow[col.key]
    if (typeof cur !== 'number' || typeof avgVal !== 'number') return ''
    return cur > avgVal ? 'cell-above-average' : ''
  }

  const periodColumns = [
    { key: 'period_name', label: 'Period', bold: true },
    ...PERIOD_PARAMS,
  ]

  const athleteColumns = [
    { key: 'athlete_name', label: 'Athlete', bold: true },
    { key: 'position_name', label: 'Position' },
    ...ATHLETE_PARAMS,
  ]

  const goalkeeperColumns = [
    { key: 'athlete_name', label: 'Athlete', bold: true },
    { key: 'position_name', label: 'Position' },
    ...GOALKEEPER_PARAMS,
  ]

  return (
    <div>
      {kpis && (
        <div className="kpi-strip" style={{ marginTop: 0, marginBottom: 24 }}>
          <div className="kpi-card">
            <div className="kpi-label"><Timer size={13} className="kpi-icon" /> Avg Duration</div>
            <div className="kpi-value">{formatDurationHMS(kpis.duration)}</div>
            <div className="kpi-sub">per athlete</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label"><MapPin size={13} className="kpi-icon" /> Avg Distance</div>
            <div className="kpi-value">{fmtNumber(kpis.distance, 0)}</div>
            <div className="kpi-sub">per athlete</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label"><Footprints size={13} className="kpi-icon" /> Avg HS Distance</div>
            <div className="kpi-value">{fmtNumber(kpis.hsDistance, 0)}</div>
            <div className="kpi-sub">per athlete</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label"><Gauge size={13} className="kpi-icon" /> Avg M/min</div>
            <div className="kpi-value">{fmtNumber(kpis.mMin, 1)}</div>
            <div className="kpi-sub">per athlete</div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <span className="card-title card-title-accent">
            Period Averages{activityName ? ` — ${activityName}` : ''}
          </span>
        </div>
        <div className="card-body">
          <DataTable columns={periodColumns} rows={periodAverages} emptyLabel="Select an activity with data above." />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <span className="card-title card-title-accent">
            Athlete Totals{activityName ? ` — ${activityName}` : ''}
          </span>
          {comparisonByAthlete && (
            <span className="field-hint">
              Teal = above this athlete's {compareMode === 'training' ? 'Training' : 'Match'} Average
            </span>
          )}
        </div>
        <div className="card-body">
          <DataTable
            columns={athleteColumns}
            rows={athleteTotals}
            emptyLabel="Select an activity with data above."
            cellClassName={compareCellClassName}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title card-title-accent">
            Goalkeeper Report{activityName ? ` — ${activityName}` : ''}
          </span>
        </div>
        <div className="card-body">
          <DataTable
            columns={goalkeeperColumns}
            rows={goalkeeperTotals}
            emptyLabel="No goalkeeper rows for this activity/period selection."
            cellClassName={compareCellClassName}
          />
        </div>
      </div>
    </div>
  )
}
