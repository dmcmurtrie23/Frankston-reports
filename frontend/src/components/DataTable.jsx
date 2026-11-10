import React, { useMemo, useState } from 'react'

function fmt(v) {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? v : v.toFixed(2)
  return v
}

function formatDuration(totalSeconds) {
  const n = Number(totalSeconds)
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(n)) return '—'
  const secs = Math.max(0, Math.round(n))
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  const pad = (x) => String(x).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

function formatCell(col, value) {
  if (col.format === 'duration') return formatDuration(value)
  if (typeof col.decimals === 'number') {
    if (value === null || value === undefined) return '—'
    const n = Number(value)
    return Number.isFinite(n) ? n.toFixed(col.decimals) : '—'
  }
  return fmt(value)
}

function compareValues(a, b) {
  const aNull = a === null || a === undefined || a === ''
  const bNull = b === null || b === undefined || b === ''
  if (aNull && bNull) return 0
  if (aNull) return 1
  if (bNull) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

// columns: [{ key, label, format?, bold? }] — format: 'duration' renders
// HH:MM:SS; bold: true renders that column's cells in bold (e.g. athlete
// or period names). cellClassName(row, col) is optional and lets the
// caller add an extra class per cell (used for average-comparison
// highlighting). rowClassName(row) / onRowClick(row) are optional and let
// the caller make whole rows clickable/highlightable. Every column header
// is clickable to sort by that column (toggling ascending/descending);
// sorting always uses the raw value (e.g. Duration sorts by seconds, not
// the HH:MM:SS text).
export default function DataTable({ columns, rows, emptyLabel = 'No data.', cellClassName, rowClassName, onRowClick }) {
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  const sortedRows = useMemo(() => {
    if (!rows || rows.length === 0 || !sortKey) return rows
    const copy = [...rows]
    copy.sort((a, b) => {
      const cmp = compareValues(a[sortKey], b[sortKey])
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [rows, sortKey, sortDir])

  if (!rows || rows.length === 0) {
    return <div className="field-hint" style={{ padding: '12px 0' }}>{emptyLabel}</div>
  }

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  return (
    <div className="summary-table-wrap">
      <table className="summary-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className="sortable-th" onClick={() => handleSort(c.key)}>
                {c.label}
                <span className="sort-indicator">
                  {sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, i) => {
            const rowExtra = rowClassName ? rowClassName(row) : ''
            return (
              <tr
                key={i}
                className={rowExtra || undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: 'pointer' } : undefined}
              >
                {columns.map((c) => {
                  const extra = cellClassName ? cellClassName(row, c) : ''
                  const cls = [c.bold ? 'cell-bold' : '', extra].filter(Boolean).join(' ')
                  return (
                    <td key={c.key} className={cls}>
                      {formatCell(c, row[c.key])}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
