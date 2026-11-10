import React, { useEffect, useMemo, useState } from 'react'
import DataTable from './DataTable.jsx'
import ButtonSlicer from './ButtonSlicer.jsx'
import { groupAndAggregate, uniqueSorted } from '../utils/aggregate.js'

// Port of the "Session Report Vel" page from the Michigan Power BI report:
// Year / Month / Date / Position / Period slicers, an athlete table of max
// velocity + distance in velocity bands 1-8, a Total Distance column chart
// by athlete, and a "Band Efforts" bar chart (velocity band 2-8 effort
// counts) by activity.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const BANDS = [1, 2, 3, 4, 5, 6, 7, 8]
const EFFORT_BANDS = [2, 3, 4, 5, 6, 7, 8]
const TEAL = '#E31B23' // Frankston red

function prettyDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

const fmt0 = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)).toLocaleString('en-AU') : '—')

function useTooltip() {
  const [tip, setTip] = useState(null)
  const show = (e, lines) => {
    const box = e.currentTarget.ownerSVGElement.parentNode.getBoundingClientRect()
    setTip({ x: e.clientX - box.left + 12, y: e.clientY - box.top + 12, lines })
  }
  const node = tip ? (
    <div className="chart-tooltip" style={{ left: tip.x, top: tip.y }}>
      {tip.lines.map((l, i) => (
        <div key={i} style={i === 0 ? { fontWeight: 700, marginBottom: 2 } : undefined}>{l}</div>
      ))}
    </div>
  ) : null
  return { show, hide: () => setTip(null), node }
}

// Vertical bars, one per athlete, sorted high -> low, value on top.
function ColumnChart({ data }) {
  const { show, hide, node } = useTooltip()
  if (data.length === 0) return <p className="field-hint">No data for this selection.</p>
  const H = 340, padT = 22, padB = 96, padL = 52, padR = 10
  const slot = Math.max(22, Math.min(60, 900 / data.length))
  const W = padL + padR + slot * data.length
  const max = Math.max(1, ...data.map((d) => d.value))
  const plotH = H - padT - padB
  const y = (v) => padT + plotH * (1 - v / max)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f)
  const barW = Math.max(6, slot - 6)
  const showLabels = slot >= 26
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--cat-border)" />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--cat-text-muted)">{fmt0(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + i * slot + (slot - barW) / 2
          const top = y(d.value)
          const h = Math.max(0, padT + plotH - top)
          const r = Math.min(4, barW / 2, h)
          return (
            <g key={d.label} onMouseMove={(e) => show(e, [d.label, `Total Distance: ${fmt0(d.value)} m`])} onMouseLeave={hide}>
              <rect x={padL + i * slot} y={padT} width={slot} height={plotH} fill="transparent" />
              <path
                d={`M${x},${padT + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${padT + plotH} Z`}
                fill={TEAL}
              />
              {showLabels && (
                <text x={x + barW / 2} y={top - 5} textAnchor="middle" fontSize="9" fill="var(--cat-text)">{fmt0(d.value)}</text>
              )}
              <text
                x={x + barW / 2}
                y={padT + plotH + 10}
                textAnchor="end"
                fontSize="10"
                fill="var(--cat-text-dim)"
                transform={`rotate(-50 ${x + barW / 2} ${padT + plotH + 10})`}
              >
                {d.label}
              </text>
            </g>
          )
        })}
      </svg>
      {node}
    </div>
  )
}

// Horizontal clustered bars: one group per activity, one bar per band.
function BandEffortsChart({ groups }) {
  const { show, hide, node } = useTooltip()
  if (groups.length === 0) return <p className="field-hint">No data for this selection.</p>
  const barH = 9, gap = 2, groupPad = 14, padL = 190, padR = 70, padT = 8
  const groupH = EFFORT_BANDS.length * (barH + gap) + groupPad
  const H = padT + groups.length * groupH + 24
  const W = 900
  const plotW = W - padL - padR
  const max = Math.max(1, ...groups.flatMap((g) => g.values))
  const x = (v) => padL + (plotW * v) / max
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f)
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={padT} y2={H - 20} stroke="var(--cat-border)" />
            <text x={x(t)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--cat-text-muted)">{fmt0(t)}</text>
          </g>
        ))}
        {groups.map((g, gi) => {
          const gy = padT + gi * groupH
          return (
            <g key={g.label}>
              <text x={padL - 10} y={gy + (groupH - groupPad) / 2 + 4} textAnchor="end" fontSize="11" fill="var(--cat-text)">
                {g.label.length > 28 ? `${g.label.slice(0, 27)}…` : g.label}
              </text>
              {g.values.map((v, i) => {
                const by = gy + i * (barH + gap)
                const w = Math.max(0, x(v) - padL)
                const r = Math.min(3, barH / 2, w)
                return (
                  <g
                    key={i}
                    onMouseMove={(e) => show(e, [g.label, `Band ${EFFORT_BANDS[i]} efforts: ${fmt0(v)}`])}
                    onMouseLeave={hide}
                  >
                    <rect x={padL} y={by - 1} width={plotW} height={barH + gap} fill="transparent" />
                    <path
                      d={`M${padL},${by} H${padL + w - r} Q${padL + w},${by} ${padL + w},${by + r} V${by + barH - r} Q${padL + w},${by + barH} ${padL + w - r},${by + barH} H${padL} Z`}
                      fill={TEAL}
                    />
                    <text x={padL + w + 4} y={by + barH - 1} fontSize="8.5" fill="var(--cat-text-dim)">
                      B{EFFORT_BANDS[i]} · {fmt0(v)}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>
      {node}
    </div>
  )
}

export default function SessionReportTab({ rows }) {
  const [year, setYear] = useState('')
  const [month, setMonth] = useState('')
  const [date, setDate] = useState('')
  const [positions, setPositions] = useState([])
  const [periods, setPeriods] = useState([])

  const dated = useMemo(() => rows.filter((r) => r.activity_date && r.activity_date !== '(no date)'), [rows])
  const years = useMemo(() => uniqueSorted(dated.map((r) => r.activity_date.slice(0, 4))), [dated])
  const byYear = useMemo(() => (year ? dated.filter((r) => r.activity_date.startsWith(year)) : dated), [dated, year])
  const months = useMemo(() => {
    const set = new Set(byYear.map((r) => Number(r.activity_date.slice(5, 7)) - 1))
    return MONTHS.filter((_, i) => set.has(i))
  }, [byYear])
  const byMonth = useMemo(
    () => (month ? byYear.filter((r) => MONTHS[Number(r.activity_date.slice(5, 7)) - 1] === month) : byYear),
    [byYear, month]
  )
  const dates = useMemo(() => uniqueSorted(byMonth.map((r) => r.activity_date)).reverse(), [byMonth])
  const byDate = useMemo(() => (date ? byMonth.filter((r) => r.activity_date === date) : byMonth), [byMonth, date])
  const positionNames = useMemo(() => uniqueSorted(byDate.map((r) => r.position_name)), [byDate])
  const periodNames = useMemo(() => uniqueSorted(byDate.map((r) => r.period_name)), [byDate])

  // Drop choices that no longer exist after a parent slicer changes.
  useEffect(() => { if (month && !months.includes(month)) setMonth('') }, [months, month])
  useEffect(() => { if (date && !dates.includes(date)) setDate('') }, [dates, date])
  useEffect(() => { setPositions((c) => c.filter((p) => positionNames.includes(p))) }, [positionNames])
  useEffect(() => { setPeriods((c) => c.filter((p) => periodNames.includes(p))) }, [periodNames])

  const filtered = useMemo(
    () =>
      byDate.filter(
        (r) =>
          (positions.length === 0 || positions.includes(r.position_name)) &&
          (periods.length === 0 || periods.includes(r.period_name))
      ),
    [byDate, positions, periods]
  )

  const athleteRows = useMemo(
    () =>
      groupAndAggregate(filtered, 'athlete_name', 'sum').sort(
        (a, b) => (b.velocity_band1_total_distance || 0) - (a.velocity_band1_total_distance || 0)
      ),
    [filtered]
  )

  const columns = [
    { key: 'athlete_name', label: 'Name', bold: true },
    { key: 'max_vel', label: 'Max Vel', decimals: 1 },
    ...BANDS.map((b) => ({ key: `velocity_band${b}_total_distance`, label: `B${b}`, decimals: 0 })),
  ]

  const distanceData = useMemo(
    () =>
      athleteRows
        .map((r) => ({ label: r.athlete_name, value: r.total_distance || 0 }))
        .sort((a, b) => b.value - a.value),
    [athleteRows]
  )

  const hasEfforts = useMemo(
    () => rows.some((r) => r.gen2_velocity_band2_total_effort_count !== undefined && r.gen2_velocity_band2_total_effort_count !== null),
    [rows]
  )
  const effortGroups = useMemo(() => {
    if (!hasEfforts) return []
    return groupAndAggregate(filtered, ['activity_id', 'activity_name', 'activity_date'], 'sum')
      .map((r) => ({
        label: `${r.activity_name}`,
        date: r.activity_date,
        values: EFFORT_BANDS.map((b) => r[`gen2_velocity_band${b}_total_effort_count`] || 0),
      }))
      .sort((a, b) => b.values[0] - a.values[0])
  }, [filtered, hasEfforts])

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">⚡</div>
        <h2>No data yet</h2>
        <p>Fetch a date range to use the Session Report.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <span className="card-title card-title-accent">Session Report</span>
          <span className="field-hint">{athleteRows.length} athletes · {filtered.length} rows</span>
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
              <span className="sidebar-label" style={{ display: 'block', marginBottom: 6 }}>Month</span>
              <select className="config-select" value={month} onChange={(e) => setMonth(e.target.value)} style={{ minWidth: 140 }}>
                <option value="">All</option>
                {months.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <span className="sidebar-label" style={{ display: 'block', marginBottom: 6 }}>Date</span>
              <select className="config-select" value={date} onChange={(e) => setDate(e.target.value)} style={{ minWidth: 200 }}>
                <option value="">All</option>
                {dates.map((d) => <option key={d} value={d}>{prettyDate(d)}</option>)}
              </select>
            </div>
          </div>
          <ButtonSlicer label="Position" options={positionNames} selected={positions} onChange={setPositions} />
          <ButtonSlicer label="Period" options={periodNames} selected={periods} onChange={setPeriods} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '1 1 520px', minWidth: 0 }}>
          <div className="card-header">
            <span className="card-title card-title-accent">Velocity Bands (m)</span>
          </div>
          <div className="card-body">
            <DataTable columns={columns} rows={athleteRows} emptyLabel="No data for this selection." />
          </div>
        </div>

        <div style={{ flex: '1 1 640px', minWidth: 0 }}>
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <span className="card-title card-title-accent">Total Distance</span>
            </div>
            <div className="card-body">
              <ColumnChart data={distanceData} />
            </div>
          </div>
          <div className="card">
            <div className="card-header">
              <span className="card-title card-title-accent">Band Efforts</span>
            </div>
            <div className="card-body">
              {hasEfforts ? (
                <BandEffortsChart groups={effortGroups} />
              ) : (
                <p className="field-hint">
                  This account didn't return the Gen2 velocity band effort-count parameters
                  (gen2_velocity_band2–8_total_effort_count), so Band Efforts can't be shown.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
