import React, { useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { PhotoContext } from '../photos.jsx'
import { BASE_URL } from '../api.js'

// Dependency-free scatter plot with scroll-to-zoom and drag-to-pan.
// points: [{ label, x, y }]. xFormat/yFormat format ticks + tooltips.
export default function ScatterChart({
  points,
  xLabel,
  yLabel,
  title,
  xThreshold = null,
  yThreshold = null,
  xFormat = (v) => String(v),
  yFormat = (v) => String(v),
}) {
  const photos = useContext(PhotoContext)
  const uid = useId()
  const pts = useMemo(
    () =>
      points.filter(
        (p) => typeof p.x === 'number' && Number.isFinite(p.x) && typeof p.y === 'number' && Number.isFinite(p.y)
      ),
    [points]
  )

  const W = 780
  const H = 460
  const padL = 74
  const padR = 90
  const padT = 20
  const padB = 60
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const hasXT = typeof xThreshold === 'number' && Number.isFinite(xThreshold)
  const hasYT = typeof yThreshold === 'number' && Number.isFinite(yThreshold)

  // Default view: include the data AND the benchmark lines (with margin) so all
  // four quadrants are always visible, and start Y at 0 like the source chart.
  const base = useMemo(() => {
    if (pts.length === 0) return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 }
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    let xlo = Math.min(...xs)
    let xhi = Math.max(...xs)
    let yhi = Math.max(...ys)
    if (hasXT) { xlo = Math.min(xlo, xThreshold); xhi = Math.max(xhi, xThreshold) }
    if (hasYT) { yhi = Math.max(yhi, yThreshold) }
    const xpad = (xhi - xlo || 1) * 0.15
    const ypad = (yhi || 1) * 0.1
    return { xMin: xlo - xpad, xMax: xhi + xpad, yMin: 0, yMax: yhi + ypad }
  }, [pts, xThreshold, yThreshold, hasXT, hasYT])

  const [view, setView] = useState(null)
  const [hovered, setHovered] = useState(null)
  useEffect(() => setView(null), [base]) // reset zoom when the data/metrics change

  const dom = view || base
  const { xMin, xMax, yMin, yMax } = dom
  const svgRef = useRef(null)
  const drag = useRef(null)

  const xAt = (v) => padL + (plotW * (v - xMin)) / (xMax - xMin || 1)
  const yAt = (v) => padT + plotH * (1 - (v - yMin) / (yMax - yMin || 1))
  const toData = (clientX, clientY) => {
    const rect = svgRef.current.getBoundingClientRect()
    const vbX = ((clientX - rect.left) / rect.width) * W
    const vbY = ((clientY - rect.top) / rect.height) * H
    return {
      x: xMin + ((vbX - padL) / plotW) * (xMax - xMin),
      y: yMin + (1 - (vbY - padT) / plotH) * (yMax - yMin),
    }
  }

  // Scroll to zoom, centred on the cursor. Non-passive so we can preventDefault.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return undefined
    const onWheel = (e) => {
      e.preventDefault()
      const { x: dx, y: dy } = toData(e.clientX, e.clientY)
      const f = e.deltaY < 0 ? 0.85 : 1 / 0.85
      setView({
        xMin: dx - (dx - xMin) * f,
        xMax: dx + (xMax - dx) * f,
        yMin: dy - (dy - yMin) * f,
        yMax: dy + (yMax - dy) * f,
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [xMin, xMax, yMin, yMax]) // eslint-disable-line

  const onMouseDown = (e) => {
    drag.current = { x: e.clientX, y: e.clientY, dom }
  }
  const onMouseMove = (e) => {
    if (!drag.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const d = drag.current.dom
    const dxData = ((e.clientX - drag.current.x) / rect.width) * W / plotW * (d.xMax - d.xMin)
    const dyData = ((e.clientY - drag.current.y) / rect.height) * H / plotH * (d.yMax - d.yMin)
    setView({
      xMin: d.xMin - dxData,
      xMax: d.xMax - dxData,
      yMin: d.yMin + dyData,
      yMax: d.yMax + dyData,
    })
  }
  const endDrag = () => {
    drag.current = null
  }

  const ticks = 5
  const xTicks = Array.from({ length: ticks + 1 }, (_, k) => xMin + ((xMax - xMin) * k) / ticks)
  const yTicks = Array.from({ length: ticks + 1 }, (_, k) => yMin + ((yMax - yMin) * k) / ticks)
  const inView = (p) => p.x >= xMin && p.x <= xMax && p.y >= yMin && p.y <= yMax
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  const rightX = hasXT ? clamp(xAt(xThreshold), padL, padL + plotW) : null // shade x >= threshold
  const topY = hasYT ? clamp(yAt(yThreshold), padT, padT + plotH) : null // shade y >= threshold

  if (pts.length === 0) {
    return <div className="field-hint" style={{ padding: '12px 0' }}>No data to plot for these two metrics.</div>
  }

  return (
    <div>
      {title && (
        <div style={{ textAlign: 'center', fontWeight: 700, color: 'var(--cat-text-bright)', marginBottom: 6 }}>
          {title}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span className="field-hint">Scroll to zoom · drag to pan · green zones beat the benchmark lines</span>
        <button
          type="button"
          className="toggle-btn"
          style={{ fontSize: 12, padding: '4px 10px' }}
          onClick={() => setView(null)}
        >
          Reset zoom
        </button>
      </div>
      <div className="summary-table-wrap">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          style={{ cursor: drag.current ? 'grabbing' : 'grab', touchAction: 'none' }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
        >
          <defs>
            <clipPath id="scatter-clip">
              <rect x={padL} y={padT} width={plotW} height={plotH} />
            </clipPath>
          </defs>

          {/* "good" zones: above the Y benchmark and/or right of the X benchmark */}
          <g clipPath="url(#scatter-clip)">
            {hasYT && (
              <rect x={padL} y={padT} width={plotW} height={topY - padT} fill="rgba(55,200,113,0.12)" />
            )}
            {hasXT && (
              <rect x={rightX} y={padT} width={padL + plotW - rightX} height={plotH} fill="rgba(55,200,113,0.12)" />
            )}
            {hasYT && (
              <line x1={padL} y1={topY} x2={padL + plotW} y2={topY} stroke="rgba(55,200,113,0.7)" strokeWidth="1.5" strokeDasharray="6 5" />
            )}
            {hasXT && (
              <line x1={rightX} y1={padT} x2={rightX} y2={padT + plotH} stroke="rgba(55,200,113,0.7)" strokeWidth="1.5" strokeDasharray="6 5" />
            )}
          </g>

          {yTicks.map((t, i) => (
            <g key={`y${i}`}>
              <line x1={padL} y1={yAt(t)} x2={W - padR} y2={yAt(t)} stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
              <text x={padL - 8} y={yAt(t) + 4} textAnchor="end" fontSize="11" fill="var(--cat-text-dim)">
                {yFormat(t)}
              </text>
            </g>
          ))}
          {xTicks.map((t, i) => (
            <g key={`x${i}`}>
              <line x1={xAt(t)} y1={padT} x2={xAt(t)} y2={padT + plotH} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
              <text
                x={xAt(t)}
                y={padT + plotH + 18}
                textAnchor="end"
                fontSize="11"
                fill="var(--cat-text-dim)"
                transform={`rotate(-35 ${xAt(t)} ${padT + plotH + 18})`}
              >
                {xFormat(t)}
              </text>
            </g>
          ))}

          <text x={padL + plotW / 2} y={H - 6} textAnchor="middle" fontSize="12" fill="var(--cat-text)">
            {xLabel}
          </text>
          <text
            x={16}
            y={padT + plotH / 2}
            textAnchor="middle"
            fontSize="12"
            fill="var(--cat-text)"
            transform={`rotate(-90 16 ${padT + plotH / 2})`}
          >
            {yLabel}
          </text>

          <g clipPath="url(#scatter-clip)">
            {pts.filter(inView).map((p, i) => {
              const photo = photos?.[p.label]
              const cx = xAt(p.x)
              const cy = yAt(p.y)
              const on = hovered && hovered.label === p.label
              const r = photo ? (on ? 15 : 12) : (on ? 6 : 4.5)
              const cid = `${uid}-ph${i}`.replace(/:/g, '')
              return (
                <g key={i} onMouseEnter={() => setHovered(p)} onMouseLeave={() => setHovered(null)} style={{ cursor: 'pointer' }}>
                  {photo ? (
                    <>
                      <clipPath id={cid}><circle cx={cx} cy={cy} r={r} /></clipPath>
                      <circle cx={cx} cy={cy} r={r + 1.5} fill="#E31B23" />
                      <image href={`${BASE_URL}${photo}`} x={cx - r} y={cy - r} width={r * 2} height={r * 2}
                        preserveAspectRatio="xMidYMin slice" clipPath={`url(#${cid})`} />
                    </>
                  ) : (
                    <circle cx={cx} cy={cy} r={r} fill="#E31B23" stroke="var(--cat-surface)" strokeWidth="1.5" />
                  )}
                  <text x={cx + r + 3} y={cy + 3} fontSize="10" fill="var(--cat-text-dim)">
                    {p.label}
                  </text>
                </g>
              )
            })}
          </g>

          {/* hover tooltip */}
          {hovered && (() => {
            const px = xAt(hovered.x)
            const py = yAt(hovered.y)
            const lines = [hovered.label, `${xLabel}: ${xFormat(hovered.x)}`, `${yLabel}: ${yFormat(hovered.y)}`]
            const w = Math.max(...lines.map((l) => l.length)) * 6.3 + 16
            const h = lines.length * 15 + 10
            let tx = px + 12
            let ty = py - h - 8
            if (tx + w > W) tx = px - w - 12
            if (ty < padT) ty = py + 12
            return (
              <g pointerEvents="none">
                <rect x={tx} y={ty} width={w} height={h} rx="5" fill="#0d1b24" stroke="var(--cat-border-md)" />
                {lines.map((l, i) => (
                  <text
                    key={i}
                    x={tx + 8}
                    y={ty + 16 + i * 15}
                    fontSize="11"
                    fontWeight={i === 0 ? 700 : 400}
                    fill={i === 0 ? 'var(--cat-text-bright)' : 'var(--cat-text-dim)'}
                  >
                    {l}
                  </text>
                ))}
              </g>
            )
          })()}
        </svg>
      </div>
    </div>
  )
}
