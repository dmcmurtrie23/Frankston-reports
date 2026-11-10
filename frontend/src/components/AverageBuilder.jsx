import React, { useEffect, useMemo, useRef, useState } from 'react'
import DataTable from './DataTable.jsx'
import { DISPLAY_PARAMS, aggregateActivityLevelAverage, uniqueSorted, uniqueTags } from '../utils/aggregate.js'

// One self-contained "pick tags -> pick activities -> pick periods -> average
// by athlete" panel. Used twice (Training / Match) with independent state,
// since which tags mean "training" vs "match" is entirely up to the tags
// your Catapult account actually uses — nothing is hard-coded here.
//
// Activities and periods default to "all selected" whenever the available
// pool changes (e.g. you toggle a tag, or pick different activities) —
// Select All / Select None below let you override that.
//
// The average is calculated at the ACTIVITY level: each selected activity
// is first reduced to its own per-athlete totals using only its selected
// periods, and THEN those per-activity results are averaged across the
// selected activities — so deselecting a period shrinks that activity's
// contribution rather than just removing rows from one flat average.
export default function AverageBuilder({ activities, rows, label, defaultTags, defaultPeriods, onComputed }) {
  const normalizeTag = (s) => String(s || '').toLowerCase().replace(/\s+/g, '')

  const [selectedTags, setSelectedTags] = useState(() => {
    if (!defaultTags || defaultTags.length === 0) return []
    const normalizedDefaults = defaultTags.map(normalizeTag)
    return uniqueTags(activities).filter((t) => normalizedDefaults.includes(normalizeTag(t)))
  })
  const [selectedActivityIds, setSelectedActivityIds] = useState([])
  const [selectedPeriods, setSelectedPeriods] = useState([])
  const [computed, setComputed] = useState(null)

  const allTags = useMemo(() => uniqueTags(activities), [activities])

  const filteredActivities = useMemo(() => {
    if (selectedTags.length === 0) return activities
    return activities.filter((a) => (a.tags || []).some((t) => selectedTags.includes(t)))
  }, [activities, selectedTags])

  // Default to "all selected" whenever the pool of available activities
  // actually changes (e.g. a tag filter is toggled) — but leave the
  // selection alone if the pool is the same and the person just used
  // Select All / Select None themselves.
  const prevActivityPoolRef = useRef(null)
  useEffect(() => {
    const ids = filteredActivities.map((a) => a.id)
    const signature = ids.join(',')
    if (prevActivityPoolRef.current !== signature) {
      prevActivityPoolRef.current = signature
      setSelectedActivityIds(ids)
    }
  }, [filteredActivities])

  const periodOptions = useMemo(() => {
    if (selectedActivityIds.length === 0) return []
    const activityIdSet = new Set(selectedActivityIds)
    return uniqueSorted(
      rows.filter((r) => activityIdSet.has(String(r.activity_id))).map((r) => r.period_name)
    )
  }, [rows, selectedActivityIds])

  // Default to "all selected" whenever the pool changes — unless
  // defaultPeriods (from the startup config file) names periods that
  // actually exist in this pool, in which case those are pre-selected
  // instead.
  const prevPeriodPoolRef = useRef(null)
  useEffect(() => {
    const signature = periodOptions.join(',')
    if (prevPeriodPoolRef.current !== signature) {
      prevPeriodPoolRef.current = signature
      if (defaultPeriods && defaultPeriods.length > 0) {
        const normalizedDefaults = defaultPeriods.map(normalizeTag)
        const matched = periodOptions.filter((p) => normalizedDefaults.includes(normalizeTag(p)))
        setSelectedPeriods(matched.length > 0 ? matched : periodOptions)
      } else {
        setSelectedPeriods(periodOptions)
      }
    }
  }, [periodOptions])

  const toggleTag = (tag) => {
    setSelectedTags((cur) => (cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]))
  }

  const toggleActivity = (id) => {
    setSelectedActivityIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  const togglePeriod = (p) => {
    setSelectedPeriods((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))
  }

  const canCalculate = selectedActivityIds.length > 0 && selectedPeriods.length > 0

  const handleCalculate = () => {
    const activityIdSet = new Set(selectedActivityIds)
    const periodSet = new Set(selectedPeriods)
    const filteredRows = rows.filter(
      (r) => activityIdSet.has(String(r.activity_id)) && periodSet.has(r.period_name)
    )
    const result = aggregateActivityLevelAverage(filteredRows)
    setComputed(result)
    onComputed?.(result)
  }

  // Calculate automatically once the default activity/period selections
  // have settled, so the table is already populated rather than requiring
  // an initial manual click. Subsequent selection changes still require
  // pressing "Calculate" again, same as before.
  useEffect(() => {
    if (computed === null && canCalculate) {
      handleCalculate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCalculate])

  const athleteColumns = [
    { key: 'athlete_name', label: 'Athlete' },
    ...DISPLAY_PARAMS,
    { key: 'row_count', label: 'Activities Averaged' },
  ]

  return (
    <div className="card avg-builder" style={{ marginBottom: 24 }}>
      <div className="card-header">
        <span className="card-title card-title-accent">{label} Average</span>
      </div>
      <div className="card-body">
        <span className="sidebar-label" style={{ display: 'block', marginBottom: 8 }}>
          Filter activities by tag {allTags.length === 0 && '(no tags found on any activity)'}
        </span>
        {allTags.length > 0 && (
          <div className="toggle-grid" style={{ marginBottom: 20 }}>
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`toggle-btn ${selectedTags.includes(tag) ? 'active' : ''}`}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        <div className="select-all-row">
          <span className="sidebar-label" style={{ marginBottom: 0 }}>
            Activities ({selectedActivityIds.length}/{filteredActivities.length} selected)
          </span>
          <button
            type="button"
            className="select-link"
            onClick={() => setSelectedActivityIds(filteredActivities.map((a) => a.id))}
          >
            Select all
          </button>
          <span className="select-sep">·</span>
          <button type="button" className="select-link" onClick={() => setSelectedActivityIds([])}>
            Select none
          </button>
        </div>
        <div className="activity-grid" style={{ marginBottom: 20 }}>
          {filteredActivities.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`activity-btn ${selectedActivityIds.includes(a.id) ? 'active' : ''}`}
              onClick={() => toggleActivity(a.id)}
            >
              <span className="activity-btn-name">{a.name}</span>
              {a.date && <span className="activity-btn-date">{a.date}</span>}
            </button>
          ))}
          {filteredActivities.length === 0 && (
            <div className="field-hint">No activities match the selected tag(s).</div>
          )}
        </div>

        <div className="select-all-row">
          <span className="sidebar-label" style={{ marginBottom: 0 }}>
            Periods ({selectedPeriods.length}/{periodOptions.length} selected)
            {selectedActivityIds.length === 0 && ' — select at least one activity first'}
          </span>
          {periodOptions.length > 0 && (
            <>
              <button type="button" className="select-link" onClick={() => setSelectedPeriods(periodOptions)}>
                Select all
              </button>
              <span className="select-sep">·</span>
              <button type="button" className="select-link" onClick={() => setSelectedPeriods([])}>
                Select none
              </button>
            </>
          )}
        </div>
        {periodOptions.length > 0 && (
          <div className="toggle-grid" style={{ marginBottom: 20 }}>
            {periodOptions.map((p) => (
              <button
                key={p}
                type="button"
                className={`toggle-btn ${selectedPeriods.includes(p) ? 'active' : ''}`}
                onClick={() => togglePeriod(p)}
              >
                {p}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
          <button className="btn-start" disabled={!canCalculate} onClick={handleCalculate}>
            Rebuild {label} Average
          </button>
        </div>

        {computed && (
          <DataTable columns={athleteColumns} rows={computed} emptyLabel="No rows matched that selection." />
        )}
      </div>
    </div>
  )
}
