import React, { useId } from 'react'

// Dependency-free multi-series SVG line chart.
// Props:
//   xLabels  : string[]  short x-axis tick labels (per week)
//   xFulls   : string[]  full week labels (for tooltips)
//   series   : [{ id, color, dashed, values:(number|null)[], tooltips:string[] }]
//   yFormat  : (v:number) => string   y-axis tick formatter

// Catmull-Rom -> cubic-bezier smoothing for one run of [x,y] points.
function smoothPath(pts, tension = 0.18) {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M ${pts[0][0]},${pts[0][1]}`
  let d = `M ${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    const c1x = p1[0] + (p2[0] - p0[0]) * tension
    const c1y = p1[1] + (p2[1] - p0[1]) * tension
    const c2x = p2[0] - (p3[0] - p1[0]) * tension
    const c2y = p2[1] - (p3[1] - p1[1]) * tension
    d += ` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}

// Break a series into runs of consecutive weeks that have values, so gaps
// (missing weeks) don't draw a misleading straight line across them.
function runsOf(values, xAt, yAt) {
  const segments = []
  let current = []
  values.forEach((v, i) => {
    if (typeof v === 'number' && Number.isFinite(v)) {
      current.push([xAt(i), yAt(v)])
    } else if (current.length) {
      segments.push(current)
      current = []
    }
  })
  if (current.length) segments.push(current)
  return segments
}

export default function WeeklyTrendChart({ xLabels, xFulls, series, yFormat = (v) => String(v), connectGaps = true }) {
  const uid = useId().replace(/[:]/g, '')
  const W = 860
  const H = 340
  const padL = 70
  const padR = 24
  const padT = 24
  const padB = 72
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const baseY = padT + plotH

  const allVals = series.flatMap((s) => s.values).filter((v) => typeof v === 'number' && Number.isFinite(v))
  if (!xLabels || xLabels.length === 0 || allVals.length === 0) {
    return <div className="field-hint" style={{ padding: '12px 0' }}>No data to plot.</div>
  }

  const rawMax = Math.max(...allVals, 0)
  const yMin = 0
  const niceMax = (m) => {
    if (m <= 0) return 1
    const pow = Math.pow(10, Math.floor(Math.log10(m)))
    const step = pow / 2
    return Math.ceil(m / step) * step
  }
  const yMax = niceMax(rawMax)
  const range = yMax - yMin || 1

  const n = xLabels.length
  const xAt = (i) => (n === 1 ? padL + plotW / 2 : padL + (plotW * i) / (n - 1))
  const yAt = (v) => padT + plotH * (1 - (v - yMin) / range)

  const ticks = 4
  const yTicks = Array.from({ length: ticks + 1 }, (_, k) => yMin + (range * k) / ticks)
  const labelEvery = n > 16 ? 3 : n > 9 ? 2 : 1

  // When connectGaps is on, each series is drawn as one continuous line
  // through every week it has data for (spanning weeks it sat out); otherwise
  // the line breaks at each missing week.
  const segmentsFor = (values) => {
    if (connectGaps) {
      const pts = []
      values.forEach((v, i) => {
        if (typeof v === 'number' && Number.isFinite(v)) pts.push([xAt(i), yAt(v)])
      })
      return pts.length ? [pts] : []
    }
    return runsOf(values, xAt, yAt)
  }

  const solidSeries = series.filter((s) => !s.dashed)
  const onlySolid = solidSeries.length === 1 ? solidSeries[0] : null

  return (
    <div className="summary-table-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" role="img">
        <defs>
          {onlySolid && (
            <linearGradient id={`area-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={onlySolid.color} stopOpacity="0.32" />
              <stop offset="55%" stopColor={onlySolid.color} stopOpacity="0.10" />
              <stop offset="100%" stopColor={onlySolid.color} stopOpacity="0" />
            </linearGradient>
          )}
          <filter id={`glow-${uid}`} x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={padL} y1={yAt(t)} x2={W - padR} y2={yAt(t)} stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
            <text x={padL - 12} y={yAt(t) + 4} textAnchor="end" fontSize="12" fill="var(--cat-text-dim)">
              {yFormat(t)}
            </text>
          </g>
        ))}

        {/* area fill only when a single solid line is shown */}
        {onlySolid &&
          segmentsFor(onlySolid.values).map((seg, i) => {
            const line = smoothPath(seg)
            const area = `${line} L ${seg[seg.length - 1][0].toFixed(1)},${baseY} L ${seg[0][0].toFixed(1)},${baseY} Z`
            return <path key={`a${i}`} d={area} fill={`url(#area-${uid})`} stroke="none" />
          })}

        {/* lines */}
        {series.map((s) =>
          segmentsFor(s.values).map((seg, i) => (
            <path
              key={`${s.id}-${i}`}
              d={smoothPath(seg)}
              fill="none"
              stroke={s.color}
              strokeWidth={s.dashed ? 2 : 3}
              strokeDasharray={s.dashed ? '7 6' : undefined}
              strokeOpacity={s.dashed ? 0.85 : 1}
              strokeLinejoin="round"
              strokeLinecap="round"
              filter={s.dashed ? undefined : `url(#glow-${uid})`}
            />
          ))
        )}

        {/* points on solid lines */}
        {series
          .filter((s) => !s.dashed)
          .map((s) =>
            s.values.map((v, i) =>
              typeof v === 'number' && Number.isFinite(v) ? (
                <circle key={`${s.id}-p${i}`} cx={xAt(i)} cy={yAt(v)} r="4" fill={s.color} stroke="#0d1b24" strokeWidth="2">
                  <title>{s.tooltips?.[i] || ''}</title>
                </circle>
              ) : null
            )
          )}

        {/* x labels */}
        {xLabels.map((lab, i) =>
          i % labelEvery === 0 ? (
            <text
              key={`x${i}`}
              x={xAt(i)}
              y={baseY + 22}
              textAnchor="end"
              fontSize="11"
              fill="var(--cat-text-dim)"
              transform={`rotate(-40 ${xAt(i)} ${baseY + 22})`}
            >
              {lab}
            </text>
          ) : null
        )}
      </svg>
    </div>
  )
}
