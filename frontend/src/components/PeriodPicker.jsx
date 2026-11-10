import React, { useEffect, useRef, useState } from 'react'

// A dropdown trigger (styled like the DatePicker button) that opens a
// checklist of periods. Selecting/deselecting doesn't close the popover,
// so multiple periods can be toggled in one go; Select All / Select None
// are also available inside it.
export default function PeriodPicker({ periods, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const toggle = (p) => {
    if (selected.includes(p)) {
      onChange(selected.filter((x) => x !== p))
    } else {
      onChange([...selected, p])
    }
  }

  const label =
    periods.length === 0
      ? 'No periods'
      : selected.length === periods.length
      ? 'All periods'
      : selected.length === 0
      ? 'No periods selected'
      : `${selected.length}/${periods.length} periods`

  return (
    <div className="datepicker-wrap" ref={wrapRef}>
      <button
        type="button"
        className="config-input datepicker-trigger"
        onClick={() => setOpen((o) => !o)}
        disabled={periods.length === 0}
      >
        <span>{label}</span>
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
          <path d="M0 0l5 6 5-6z" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <div className="datepicker-popover period-popover">
          <div className="select-all-row" style={{ marginBottom: 8 }}>
            <span className="sidebar-label" style={{ marginBottom: 0 }}>Periods</span>
            <button type="button" className="select-link" onClick={() => onChange(periods)}>
              Select all
            </button>
            <span className="select-sep">·</span>
            <button type="button" className="select-link" onClick={() => onChange([])}>
              Select none
            </button>
          </div>
          <div className="period-checklist">
            {periods.map((p) => (
              <label key={p} className="period-check-row">
                <input type="checkbox" checked={selected.includes(p)} onChange={() => toggle(p)} />
                <span>{p}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
