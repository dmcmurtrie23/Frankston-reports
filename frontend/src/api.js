export const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const data = await res.json()
      detail = data.detail || detail
    } catch (e) {
      /* ignore */
    }
    throw new Error(detail)
  }
  return res.json()
}

async function get(path) {
  const res = await fetch(`${BASE_URL}${path}`)
  if (!res.ok) {
    let detail = res.statusText
    try {
      const data = await res.json()
      detail = data.detail || detail
    } catch (e) {
      /* ignore */
    }
    throw new Error(detail)
  }
  return res.json()
}

export function fetchData({ token, region, startDate, endDate }) {
  return post('/api/fetch-data', { token, region, start_date: startDate, end_date: endDate })
}

export function fetchLastFetch() {
  return get('/api/last-fetch')
}

export function fetchRegions() {
  return get('/api/regions')
}

export function fetchDebugLastFetch() {
  return get('/api/debug/last-fetch')
}

export async function fetchAppConfigText() {
  const res = await fetch(`${BASE_URL}/api/app-config`)
  if (!res.ok) throw new Error('Could not load app-config.txt')
  return res.text()
}

// This Week (ported from Frankston Sport Science) — 10Hz pull + page data
export function startThisWeekSync({ token, region }) {
  return post('/api/this-week/sync', { token, region })
}

export function fetchThisWeekSyncStatus() {
  return get('/api/this-week/sync-status')
}

export function fetchThisWeek(asOf) {
  return get(`/api/this-week${asOf ? `?as_of=${asOf}` : ''}`)
}

export function fetchSpeedExposure(asOf) {
  return get(`/api/speed-exposure${asOf ? `?as_of=${asOf}` : ''}`)
}

// Game Report (ported from Frankston Sport Science)
export function fetchGames({ token, region }) {
  return post('/api/game-report/games', { token, region })
}
export function startGameDownload({ token, region, activityId }) {
  return post('/api/game-report/download', { token, region, activity_id: activityId })
}
export function fetchGameStatus(activityId) {
  return get(`/api/game-report/status?activity_id=${encodeURIComponent(activityId)}`)
}
export function fetchGameReport(activityId) {
  return get(`/api/game-report?activity_id=${encodeURIComponent(activityId)}`)
}

// Rehab (ported from Frankston Sport Science)
export function fetchRehab() {
  return get('/api/rehab')
}
export function saveRehab(rows) {
  return post('/api/rehab', { rows })
}

// Player Profile (ported from Frankston Sport Science)
export function fetchPlayerProfile(player) {
  return get(`/api/player-profile${player ? `?player=${encodeURIComponent(player)}` : ''}`)
}
export function fetchRotations({ token, region, activityId }) {
  return post('/api/game-report/rotations', { token, region, activity_id: activityId })
}
export function startWorkOutGames({ token, region }) {
  return post('/api/player-profile/work-out-games', { token, region })
}
export function fetchWorkOutGamesStatus() {
  return get('/api/player-profile/work-out-games')
}

// Drill Matrix (ported from Frankston Sport Science)
export function fetchDrillMatrix(phase, kind) {
  return get(`/api/drill-matrix?phase=${encodeURIComponent(phase)}&kind=${encodeURIComponent(kind)}`)
}
export function startDrillSync({ token, region }) {
  return post('/api/drill-matrix/sync', { token, region })
}
export function fetchDrillSyncStatus() {
  return get('/api/drill-matrix/sync')
}
export function saveDrillNames(rows) {
  return post('/api/drill-matrix/names', { rows })
}

// Running Prescription (ported from Frankston Sport Science)
export function fetchPrescriptionRunners() {
  return get('/api/running-prescription/runners')
}
export function fetchPrescription({ session, mode, roundTo }) {
  return post('/api/running-prescription', { session, mode, round_to: roundTo })
}
export function saveTimeTrials(rows) {
  return post('/api/running-prescription/time-trials', { rows })
}

// Player photos from a team web page
export function scanPhotos(url, names) {
  return post('/api/photos/scan', { url, names })
}
export function savePhotos(items, referer) {
  return post('/api/photos/save', { items, referer })
}
export function removePhoto(player) {
  return post('/api/photos/remove', { player })
}
export function fetchPhotos() {
  return get('/api/photos')
}
