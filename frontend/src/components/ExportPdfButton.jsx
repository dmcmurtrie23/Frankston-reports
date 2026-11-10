import React, { useEffect, useRef, useState } from 'react'
import { FileDown } from 'lucide-react'

// Icon button that opens a small popover with two checkboxes (Reporting /
// Player Highlights) and an Export button. The actual capture-and-build
// work happens in the parent via onExport, since it needs refs to the
// live Reporting/Player Highlights DOM (and has to briefly switch tabs to
// make each one visible for capture).
export default function ExportPdfButton({ onExport }) {
  const [open, setOpen] = useState(false)
  const [includeReport, setIncludeReport] = useState(true)
  const [includeHighlights, setIncludeHighlights] = useState(true)
  const [exporting, setExporting] = useState(false)
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

  const canExport = (includeReport || includeHighlights) && !exporting

  const handleExportClick = async () => {
    if (!canExport) return
    setExporting(true)
    try {
      await onExport({ includeReport, includeHighlights })
      setOpen(false)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="datepicker-wrap" ref={wrapRef}>
      <button
        type="button"
        className="config-input datepicker-trigger"
        onClick={() => setOpen((o) => !o)}
        title="Export PDF"
      >
        <span>Export PDF</span>
        <FileDown size={14} />
      </button>

      {open && (
        <div className="datepicker-popover export-pdf-popover" style={{ right: 0, left: 'auto' }}>
          <span className="sidebar-label" style={{ display: 'block', marginBottom: 8 }}>
            Include in PDF
          </span>
          <label className="period-check-row">
            <input
              type="checkbox"
              checked={includeReport}
              onChange={(e) => setIncludeReport(e.target.checked)}
            />
            <span>Report</span>
          </label>
          <label className="period-check-row">
            <input
              type="checkbox"
              checked={includeHighlights}
              onChange={(e) => setIncludeHighlights(e.target.checked)}
            />
            <span>Player Highlights</span>
          </label>

          <button
            type="button"
            className="btn-start btn-teal btn-block"
            style={{ marginTop: 14 }}
            disabled={!canExport}
            onClick={handleExportClick}
          >
            {exporting ? 'Generating PDF…' : 'Export PDF'}
          </button>
          {exporting && (
            <div className="field-hint" style={{ marginTop: 8, textAlign: 'center' }}>
              This can take a few seconds — the app briefly switches tabs to capture each page.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
