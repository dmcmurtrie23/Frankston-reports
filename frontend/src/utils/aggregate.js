// Small grouping/aggregation helpers. Kept dependency-free (no lodash) since
// the shapes here are simple: an array of flat row objects.
//
// deriveRow() ports the calculated-column logic from the provided Power
// Query (M) code: it takes one raw stats row (already summed by Catapult
// for a given activity/athlete/period/position/team) and adds the same
// derived fields the M code added, using the same source columns.

// Raw Catapult parameter names this app requests (must match
// backend/app/config.py STAT_PARAMETERS).
export const RAW_PARAMS = [
  'total_distance', 'total_duration', 'total_player_load',
  'max_effort_acceleration', 'max_effort_deceleration',
  'acceleration_density', 'total_acceleration_load',
  'percentage_max_velocity', 'max_vel',
  'velocity_band1_total_distance', 'velocity_band2_total_distance', 'velocity_band3_total_distance',
  'velocity_band4_total_distance', 'velocity_band5_total_distance', 'velocity_band6_total_distance',
  'velocity_band7_total_distance', 'velocity_band8_total_distance',
  'velocity2_band7_total_distance', 'velocity2_band8_total_distance',
  'gen2_acceleration_band1_total_effort_count', 'gen2_acceleration_band2_total_effort_count',
  'gen2_acceleration_band3_total_effort_count', 'gen2_acceleration_band6_total_effort_count',
  'gen2_acceleration_band7_total_effort_count', 'gen2_acceleration_band8_total_effort_count',
]

export const MAX_PLAUSIBLE_KMH = 40

function num(row, key) {
  const n = Number(row[key])
  return Number.isFinite(n) ? n : 0
}

/**
 * Adds every derived column from the M code to one raw row. Safe to call
 * on rows that are missing some raw columns (missing values are treated
 * as 0). The four "/min" rate fields computed here are only used as a
 * fallback for un-grouped rows — groupAndAggregate() below recomputes
 * them properly from the grouped totals rather than summing/averaging
 * these per-row values (see the note on RATE_PARAMS).
 */
export function deriveRow(row) {
  const totalDuration = num(row, 'total_duration')
  const minutes = totalDuration / 60

  const hsDistance =
    num(row, 'velocity_band4_total_distance') +
    num(row, 'velocity_band5_total_distance') +
    num(row, 'velocity_band6_total_distance') +
    num(row, 'velocity_band7_total_distance') +
    num(row, 'velocity_band8_total_distance')

  const sprintDistance =
    num(row, 'velocity_band5_total_distance') +
    num(row, 'velocity_band6_total_distance') +
    num(row, 'velocity_band7_total_distance') +
    num(row, 'velocity_band8_total_distance')

  const pct80Distance =
    num(row, 'velocity2_band7_total_distance') + num(row, 'velocity2_band8_total_distance')

  const hardAccels =
    num(row, 'gen2_acceleration_band7_total_effort_count') +
    num(row, 'gen2_acceleration_band8_total_effort_count')

  const hardDecels =
    num(row, 'gen2_acceleration_band1_total_effort_count') +
    num(row, 'gen2_acceleration_band2_total_effort_count')

  const perMin = (v) => (minutes > 0 ? v / minutes : null)

  return {
    ...row,
    total_distance: num(row, 'total_distance'),
    total_duration: totalDuration,
    total_player_load: num(row, 'total_player_load'),
    max_effort_acceleration: num(row, 'max_effort_acceleration'),
    max_effort_deceleration: num(row, 'max_effort_deceleration'),
    acceleration_density: num(row, 'acceleration_density'),
    total_acceleration_load: num(row, 'total_acceleration_load'),
    percentage_max_velocity: num(row, 'max_vel') > MAX_PLAUSIBLE_KMH ? null : num(row, 'percentage_max_velocity'),
    // Speeds over MAX_PLAUSIBLE_KMH are GPS spikes, not running: left out, so a player's max
    // velocity is their fastest real speed (the next-highest period), never an impossible one.
    max_vel: num(row, 'max_vel') > MAX_PLAUSIBLE_KMH ? null : num(row, 'max_vel'),

    hs_distance: hsDistance,
    sprint_distance: sprintDistance,
    pct80_distance: pct80Distance,
    hard_accels: hardAccels,
    hard_decels: hardDecels,
    hs_cod: hardAccels + hardDecels,

    m_min: perMin(num(row, 'total_distance')),
    hs_min: perMin(hsDistance),
    sprint_min: perMin(sprintDistance),
    accels_decels_min: perMin(hardAccels + hardDecels),
  }
}

// Decimal precision per field: distances round to whole numbers, rates
// (the "/min" columns) and velocity values keep one decimal place. Applied
// uniformly to every table's column list below.
const DECIMALS_BY_KEY = {
  total_distance: 0,
  hs_distance: 0,
  sprint_distance: 0,
  pct80_distance: 0,
  m_min: 1,
  hs_min: 1,
  sprint_min: 1,
  accels_decels_min: 1,
  max_vel: 1,
  percentage_max_velocity: 1,
  total_acceleration_load: 0,
  total_player_load: 0,
}

function withDecimals(params, overrides = {}) {
  return params.map((p) => {
    const decimals = p.key in overrides ? overrides[p.key] : DECIMALS_BY_KEY[p.key]
    return decimals !== undefined ? { ...p, decimals } : p
  })
}

// The columns the Averages tab (Training/Match builders) displays. Change
// this one list to change both of those tables at once.
export const DISPLAY_PARAMS = withDecimals([
  { key: 'total_duration', label: 'Duration', format: 'duration' },
  { key: 'total_distance', label: 'Total Distance' },
  { key: 'm_min', label: 'M/min' },
  { key: 'hs_distance', label: 'HS Distance' },
  { key: 'hs_min', label: 'HS/min' },
  { key: 'sprint_distance', label: 'Sprint Distance' },
  { key: 'sprint_min', label: 'Sprint/Min' },
  { key: 'accels_decels_min', label: 'Accels + Decels/Min' },
  { key: 'hard_accels', label: 'Hard Accels' },
  { key: 'hard_decels', label: 'Hard Decels' },
  { key: 'pct80_distance', label: '80% Distance' },
  { key: 'max_vel', label: 'Max Velocity' },
  { key: 'percentage_max_velocity', label: '% of Max Velocity' },
])

// Reporting tab's Period Averages table. Hard Accels/Decels get 1 decimal
// here specifically since these are means across athletes for a period
// (e.g. 2.3 average hard accels), unlike the whole-number per-athlete
// totals in ATHLETE_PARAMS below.
export const PERIOD_PARAMS = withDecimals(
  [
    { key: 'total_duration', label: 'Ave Duration', format: 'duration' },
    { key: 'total_distance', label: 'Ave Distance (m)' },
    { key: 'm_min', label: 'Ave M/min' },
    { key: 'hs_distance', label: 'Ave HS Distance' },
    { key: 'hs_min', label: 'Ave HS/min' },
    { key: 'pct80_distance', label: 'Ave 80% Distance' },
    { key: 'hard_accels', label: 'Ave Hard Accels' },
    { key: 'hard_decels', label: 'Ave Hard Decels' },
    { key: 'accels_decels_min', label: 'Ave Hard A+D/min' },
  ],
  { hard_accels: 1, hard_decels: 1 }
)

// Reporting tab's Athlete Totals table.
export const ATHLETE_PARAMS = withDecimals([
  { key: 'total_duration', label: 'Duration', format: 'duration' },
  { key: 'total_distance', label: 'Total Distance (m)' },
  { key: 'm_min', label: 'M/min' },
  { key: 'hs_distance', label: 'HS Distance' },
  { key: 'hs_min', label: 'HS/min' },
  { key: 'sprint_distance', label: 'Sprint Distance' },
  { key: 'pct80_distance', label: '80% Distance' },
  { key: 'max_vel', label: 'Max Vel' },
  { key: 'percentage_max_velocity', label: 'Max Vel %' },
  { key: 'hard_accels', label: 'Hard Accels' },
  { key: 'hard_decels', label: 'Hard Decels' },
])

// Reporting tab's Goalkeeper Report table.
export const GOALKEEPER_PARAMS = withDecimals([
  { key: 'total_duration', label: 'Duration', format: 'duration' },
  { key: 'total_distance', label: 'Distance' },
  { key: 'm_min', label: 'M/min' },
  { key: 'hard_accels', label: 'Hard Accels' },
  { key: 'hard_decels', label: 'Hard Decels' },
  { key: 'accels_decels_min', label: 'Hard A+D/min' },
  { key: 'total_acceleration_load', label: 'Acceleration Load' },
  { key: 'acceleration_density', label: 'Acceleration Density' },
  { key: 'total_player_load', label: 'Total Player Load' },
])

// Every "/min" column is a rate, not a plain quantity — it should never be
// summed or averaged directly across grouped rows (summing several
// periods' M/min, for example, produces a meaningless inflated number).
// Instead each is recomputed from the GROUP's already-aggregated totals:
// numerator / (grouped total_duration / 60). Because numerator and
// total_duration are aggregated the same way (both summed, or both
// averaged) over the same set of rows, the ratio comes out identical
// either way — so this is correct whether the table sums or averages
// everything else.
const RATE_PARAMS = {
  m_min: 'total_distance',
  hs_min: 'hs_distance',
  sprint_min: 'sprint_distance',
  explosive_min: 'explosive_efforts',
  // accels_decels_min is handled separately below (two-column numerator)
}

// Max Velocity and % of Max Velocity are peak-effort values, not additive
// quantities — summing them across periods (e.g. for an athlete's totals)
// or averaging them produces a number that was never actually hit. Both
// always take the highest value seen across the grouped rows, regardless
// of whether the table is otherwise summing or averaging everything else.
const MAX_PARAMS = ['max_vel', 'percentage_max_velocity']

// Every raw/derived field any table in the app might display, used to
// decide what groupAndAggregate() actually needs to sum/average/max.
// Add a key here (and to whichever table's *_PARAMS list above) to make a
// new field available anywhere.
const ALL_PARAM_KEYS = [
  'total_duration', 'total_distance', 'hs_distance', 'sprint_distance', 'pct80_distance',
  'hard_accels', 'hard_decels', 'max_vel', 'percentage_max_velocity',
  'acceleration_density', 'total_acceleration_load', 'total_player_load',
  // Optional — only present when the account has these parameters (see
  // backend find_explosive_parameters). Used by the Athlete Drill tab.
  'explosive_efforts', 'explosive_distance',
  // Session Report tab: per-band distances and (optional) band effort counts.
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `velocity_band${i}_total_distance`),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `gen2_velocity_band${i}_total_effort_count`),
]

const BASE_PARAMS = ALL_PARAM_KEYS.filter((k) => !MAX_PARAMS.includes(k))

function round2(n) {
  return Math.round(n * 100) / 100
}

/**
 * Core aggregation over rows that are ALREADY in "derived" shape (i.e. have
 * gone through deriveRow(), or are themselves the output of a previous
 * aggregateDerivedRows() call — see aggregateActivityLevelAverage below).
 * Groups by one field (a string) or several at once (an array of strings)
 * and aggregates every BASE_PARAMS/MAX_PARAMS/RATE_PARAMS column. `mode`
 * controls the "plain quantity" columns: 'sum' totals them across the
 * group, 'mean' averages them. The "/min" rate columns always use the
 * grouped-totals ratio, regardless of `mode`.
 */
function aggregateDerivedRows(derivedRows, groupKey, mode = 'mean') {
  const keys = Array.isArray(groupKey) ? groupKey : [groupKey]
  const groups = new Map()

  for (const row of derivedRows) {
    const keyValues = keys.map((k) => row[k] ?? '(unknown)')
    const mapKey = keyValues.join('\u0000')
    if (!groups.has(mapKey)) {
      const sums = {}
      const counts = {}
      for (const p of BASE_PARAMS) {
        sums[p] = 0
        counts[p] = 0
      }
      const maxes = {}
      for (const p of MAX_PARAMS) {
        maxes[p] = null
      }
      const base = { row_count: 0, _sums: sums, _counts: counts, _maxes: maxes }
      keys.forEach((k, i) => {
        base[k] = keyValues[i]
      })
      groups.set(mapKey, base)
    }
    const g = groups.get(mapKey)
    g.row_count += 1
    for (const p of BASE_PARAMS) {
      const val = row[p]
      if (val !== null && val !== undefined && Number.isFinite(Number(val))) {
        g._sums[p] += Number(val)
        g._counts[p] += 1
      }
    }
    for (const p of MAX_PARAMS) {
      const val = row[p]
      if (val !== null && val !== undefined && Number.isFinite(Number(val))) {
        g._maxes[p] = g._maxes[p] === null ? Number(val) : Math.max(g._maxes[p], Number(val))
      }
    }
  }

  const out = []
  for (const g of groups.values()) {
    const result = { row_count: g.row_count }
    keys.forEach((k) => {
      result[k] = g[k]
    })
    for (const p of BASE_PARAMS) {
      const sum = g._sums[p]
      const count = g._counts[p]
      if (count === 0) {
        result[p] = null
      } else if (mode === 'sum') {
        result[p] = round2(sum)
      } else {
        result[p] = round2(sum / count)
      }
    }
    for (const p of MAX_PARAMS) {
      result[p] = g._maxes[p] === null ? null : round2(g._maxes[p])
    }

    const minutes = result.total_duration ? result.total_duration / 60 : null
    for (const [rateKey, numeratorKey] of Object.entries(RATE_PARAMS)) {
      result[rateKey] = minutes ? round2(result[numeratorKey] / minutes) : null
    }
    const accelsDecelsSum = (result.hard_accels || 0) + (result.hard_decels || 0)
    result.accels_decels_min = minutes ? round2(accelsDecelsSum / minutes) : null

    out.push(result)
  }
  return out
}

/**
 * Standard entry point: derives raw Catapult rows, then aggregates them.
 * Used everywhere except the Training/Match average builder (see
 * aggregateActivityLevelAverage).
 */
export function groupAndAggregate(rows, groupKey, mode = 'mean') {
  return aggregateDerivedRows(rows.map(deriveRow), groupKey, mode)
}

/**
 * The Training/Match average is an average OF ACTIVITIES, not a flat
 * average of every underlying period/position row: each selected activity
 * is first reduced to its own per-athlete totals using only the selected
 * periods within it (so deselecting a period shrinks that activity's
 * contribution before anything else happens), and THEN those per-activity
 * results are averaged across the selected activities, per athlete.
 */
export function aggregateActivityLevelAverage(rawRows) {
  const perActivityAthlete = aggregateDerivedRows(rawRows.map(deriveRow), ['activity_id', 'athlete_name'], 'sum')
  return aggregateDerivedRows(perActivityAthlete, 'athlete_name', 'mean')
}

export function uniqueSorted(values) {
  return Array.from(new Set(values.filter((v) => v !== null && v !== undefined && v !== ''))).sort()
}

export function uniqueTags(activities) {
  const set = new Set()
  for (const a of activities) {
    for (const t of a.tags || []) set.add(t)
  }
  return Array.from(set).sort()
}

// Maps athlete_name -> that athlete's average row from whichever compare
// mode is active ('training' | 'match' | null). Shared between the
// Reporting tab's cell highlighting and the Player Highlights tab.
export function buildComparisonMap(compareMode, trainingAverage, matchAverage) {
  const source = compareMode === 'training' ? trainingAverage : compareMode === 'match' ? matchAverage : null
  if (!source) return null
  const map = new Map()
  for (const r of source) map.set(r.athlete_name, r)
  return map
}

// Every athlete in currentRows who is above their own average for
// metricKey, with the % they're over by (120% of average -> 20 here).
export function buildOverAverageList(currentRows, comparisonMap, metricKey) {
  if (!comparisonMap) return []
  const list = []
  for (const row of currentRows) {
    const avgRow = comparisonMap.get(row.athlete_name)
    if (!avgRow) continue
    const cur = row[metricKey]
    const avg = avgRow[metricKey]
    if (typeof cur !== 'number' || typeof avg !== 'number' || avg <= 0) continue
    if (cur > avg) {
      list.push({ athlete_name: row.athlete_name, pct: round2(((cur / avg) - 1) * 100) })
    }
  }
  list.sort((a, b) => b.pct - a.pct)
  return list
}
