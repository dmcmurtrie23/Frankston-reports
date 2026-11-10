import React, { useMemo } from 'react'
import DatePicker from './DatePicker.jsx'
import PeriodPicker from './PeriodPicker.jsx'
import ExportPdfButton from './ExportPdfButton.jsx'

export default function TopBar({
  activities,
  selectedDate,
  setSelectedDate,
  selectedActivityId,
  setSelectedActivityId,
  periodOptions,
  selectedPeriods,
  setSelectedPeriods,
  compareMode,
  setCompareMode,
  hasTrainingAverage,
  hasMatchAverage,
  onExportPdf,
}) {
  const markedDates = useMemo(
    () => new Set(activities.map((a) => a.date).filter(Boolean)),
    [activities]
  )

  const activitiesForDate = useMemo(
    () => activities.filter((a) => a.date === selectedDate),
    [activities, selectedDate]
  )

  const handleDateChange = (newDate) => {
    setSelectedDate(newDate)
    const firstOnDate = activities.find((a) => a.date === newDate)
    setSelectedActivityId(firstOnDate ? firstOnDate.id : null)
  }

  const toggleCompare = (mode) => {
    setCompareMode((cur) => (cur === mode ? null : mode))
  }

  return (
    <div className="card topbar-card" style={{ marginBottom: 24 }}>
      <div className="card-body" style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <span className="sidebar-label" style={{ display: 'block', marginBottom: 6 }}>Date</span>
          <DatePicker
            value={selectedDate}
            onChange={handleDateChange}
            markedDates={markedDates}
            className="topbar-datepicker"
          />
        </div>

        <div>
          <span className="sidebar-label" style={{ display: 'block', marginBottom: 6 }}>Activity</span>
          <select
            className="config-select"
            value={selectedActivityId || ''}
            onChange={(e) => setSelectedActivityId(e.target.value)}
          >
            {activitiesForDate.length === 0 && <option value="">No activities on this date</option>}
            {activitiesForDate.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        <div>
          <span className="sidebar-label" style={{ display: 'block', marginBottom: 6 }}>Periods</span>
          <PeriodPicker periods={periodOptions} selected={selectedPeriods} onChange={setSelectedPeriods} />
        </div>

        <div>
          <span className="sidebar-label" style={{ display: 'block', marginBottom: 6 }}>Compare Athletes To</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className={`toggle-btn ${compareMode === 'training' ? 'active' : ''}`}
              onClick={() => toggleCompare('training')}
              disabled={!hasTrainingAverage}
              title={hasTrainingAverage ? '' : 'Visit the Averages tab to calculate a Training Average first'}
            >
              Training Average
            </button>
            <button
              type="button"
              className={`toggle-btn ${compareMode === 'match' ? 'active' : ''}`}
              onClick={() => toggleCompare('match')}
              disabled={!hasMatchAverage}
              title={hasMatchAverage ? '' : 'Visit the Averages tab to calculate a Match Average first'}
            >
              Match Average
            </button>
          </div>
        </div>

        <div style={{ marginLeft: 'auto' }}>
          <span className="sidebar-label" style={{ display: 'block', marginBottom: 6 }}>&nbsp;</span>
          <ExportPdfButton onExport={onExportPdf} />
        </div>
      </div>
    </div>
  )
}
