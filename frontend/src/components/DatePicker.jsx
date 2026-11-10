import React, { useEffect, useRef, useState } from 'react'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function pad(n) {
  return String(n).padStart(2, '0')
}

function toISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function fromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function buildGrid(viewDate) {
  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const firstOfMonth = new Date(year, month, 1)
  const startOffset = firstOfMonth.getDay() // 0=Sun
  const gridStart = new Date(year, month, 1 - startOffset)
  const days = []
  for (let i = 0; i < 42; i++) {
    days.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i))
  }
  return days
}

export default function DatePicker({ value, onChange, disabled, markedDates, className }) {
  const selected = value ? fromISO(value) : new Date()
  const [open, setOpen] = useState(false)
  const [viewDate, setViewDate] = useState(new Date(selected.getFullYear(), selected.getMonth(), 1))
  const wrapRef = useRef(null)
  const today = new Date()
  const markedSet = markedDates instanceof Set ? markedDates : new Set(markedDates || [])

  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const openPicker = () => {
    if (disabled) return
    setViewDate(new Date(selected.getFullYear(), selected.getMonth(), 1))
    setOpen((o) => !o)
  }

  const pick = (day) => {
    onChange(toISO(day))
    setOpen(false)
  }

  const shiftMonth = (delta) => {
    setViewDate((v) => new Date(v.getFullYear(), v.getMonth() + delta, 1))
  }

  const days = buildGrid(viewDate)
  const displayLabel = selected
    ? `${pad(selected.getDate())} ${MONTHS[selected.getMonth()].slice(0, 3)} ${selected.getFullYear()}`
    : 'Select date'

  return (
    <div className={`datepicker-wrap ${className || ''}`} ref={wrapRef}>
      <button
        type="button"
        className="config-input datepicker-trigger"
        onClick={openPicker}
        disabled={disabled}
      >
        <span>{displayLabel}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="8" y1="3" x2="8" y2="7" />
          <line x1="16" y1="3" x2="16" y2="7" />
        </svg>
      </button>

      {open && (
        <div className="datepicker-popover">
          <div className="dp-header">
            <button type="button" className="dp-nav-btn" onClick={() => shiftMonth(-1)}>
              ‹
            </button>
            <span className="dp-month-label">
              {MONTHS[viewDate.getMonth()]} {viewDate.getFullYear()}
            </span>
            <button type="button" className="dp-nav-btn" onClick={() => shiftMonth(1)}>
              ›
            </button>
          </div>
          <div className="dp-grid">
            {WEEKDAYS.map((w, i) => (
              <div key={i} className="dp-weekday">
                {w}
              </div>
            ))}
            {days.map((day, i) => {
              const inMonth = day.getMonth() === viewDate.getMonth()
              const isSelected = sameDay(day, selected)
              const isToday = sameDay(day, today)
              const hasActivity = markedSet.has(toISO(day))
              return (
                <button
                  type="button"
                  key={i}
                  className={`dp-day ${inMonth ? '' : 'other-month'} ${isSelected ? 'selected' : ''} ${
                    isToday && !isSelected ? 'today' : ''
                  } ${hasActivity ? 'has-activity' : ''}`}
                  onClick={() => pick(day)}
                >
                  {day.getDate()}
                  {hasActivity && <span className="dp-day-dot" />}
                </button>
              )
            })}
          </div>
          <button type="button" className="dp-today-btn" onClick={() => pick(today)}>
            Today
          </button>
        </div>
      )}
    </div>
  )
}
