import React, { useEffect, useMemo, useState } from 'react'
import DataTable from './DataTable.jsx'
import { groupAndAggregate, buildComparisonMap, buildOverAverageList } from '../utils/aggregate.js'

// Five sortable lists of "who's above their own average today": Total
// Distance %, HS Distance %, Sprint Distance %, Hard Accels %, and Hard
// Decels % — each its own list. The % shown is how far above average
// they are (120% of average -> shown as 20%), against whichever compare
// mode (Training/Match Average) is active up in the top bar.
//
// Clicking any player's row selects them: that row highlights, and so does
// their row in every other list they appear in. Clicking the same player
// again (in any list) clears the selection.
export default function PlayerHighlightsTab({ rows, compareMode, trainingAverage, matchAverage }) {
  const [selectedAthlete, setSelectedAthlete] = useState(null)

  const currentPerAthlete = useMemo(() => groupAndAggregate(rows, 'athlete_name', 'sum'), [rows])

  const comparisonMap = useMemo(
    () => buildComparisonMap(compareMode, trainingAverage, matchAverage),
    [compareMode, trainingAverage, matchAverage]
  )

  const distanceList = useMemo(
    () => buildOverAverageList(currentPerAthlete, comparisonMap, 'total_distance'),
    [currentPerAthlete, comparisonMap]
  )
  const hsList = useMemo(
    () => buildOverAverageList(currentPerAthlete, comparisonMap, 'hs_distance'),
    [currentPerAthlete, comparisonMap]
  )
  const sprintList = useMemo(
    () => buildOverAverageList(currentPerAthlete, comparisonMap, 'sprint_distance'),
    [currentPerAthlete, comparisonMap]
  )
  const hardAccelsList = useMemo(
    () => buildOverAverageList(currentPerAthlete, comparisonMap, 'hard_accels'),
    [currentPerAthlete, comparisonMap]
  )
  const hardDecelsList = useMemo(
    () => buildOverAverageList(currentPerAthlete, comparisonMap, 'hard_decels'),
    [currentPerAthlete, comparisonMap]
  )

  // Reset the selection whenever the underlying data changes (new
  // activity/periods/compare mode), since the selected player might not
  // even be in the lists anymore.
  useEffect(() => {
    setSelectedAthlete(null)
  }, [currentPerAthlete, comparisonMap])

  if (!compareMode) {
    return (
      <div className="empty-state">
        <div className="empty-icon">⚡</div>
        <h2>Pick a comparison average first</h2>
        <p>
          Select <strong>Training Average</strong> or <strong>Match Average</strong> next to the Periods picker
          above to see who's above their average right now.
        </p>
      </div>
    )
  }

  const handleRowClick = (row) => {
    setSelectedAthlete((cur) => (cur === row.athlete_name ? null : row.athlete_name))
  }

  const rowClassName = (row) => (row.athlete_name === selectedAthlete ? 'row-selected' : '')

  const pctColumns = (label) => [
    { key: 'athlete_name', label: 'Athlete', bold: true },
    { key: 'pct', label, decimals: 1 },
  ]

  const lists = [
    { title: 'Total Distance %', rows: distanceList },
    { title: 'HS Distance %', rows: hsList },
    { title: 'Sprint Distance %', rows: sprintList },
    { title: 'Hard Accels %', rows: hardAccelsList },
    { title: 'Hard Decels %', rows: hardDecelsList },
  ]

  return (
    <div className="highlight-grid">
      {lists.map((l) => (
        <div className="card" key={l.title}>
          <div className="card-header">
            <span className="card-title card-title-accent">{l.title}</span>
          </div>
          <div className="card-body">
            <DataTable
              columns={pctColumns('% Above Avg')}
              rows={l.rows}
              emptyLabel="No one is above their average right now."
              onRowClick={handleRowClick}
              rowClassName={rowClassName}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
