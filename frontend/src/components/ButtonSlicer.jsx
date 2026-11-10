import React from 'react'

// Power BI-style multi-select slicer: nothing selected = everything.
export default function ButtonSlicer({ label, options, selected, onChange, vertical = false, render = (o) => o }) {
  const toggle = (o) =>
    onChange(selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o])
  return (
    <div style={{ marginBottom: vertical ? 0 : 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span className="sidebar-label">{label}</span>
        {selected.length > 0 && (
          <button type="button" className="select-link" onClick={() => onChange([])}>
            Clear
          </button>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: vertical ? 'column' : 'row',
          flexWrap: vertical ? 'nowrap' : 'wrap',
          gap: 6,
          maxHeight: vertical ? 470 : 120,
          overflowY: 'auto',
        }}
      >
        {options.length === 0 && <span className="field-hint">None in this data</span>}
        {options.map((o) => (
          <button
            key={o}
            type="button"
            className={`toggle-btn ${selected.includes(o) ? 'active' : ''}`}
            onClick={() => toggle(o)}
            style={{ fontSize: 12, padding: '5px 10px', textAlign: 'left' }}
          >
            {render(o)}
          </button>
        ))}
      </div>
    </div>
  )
}
