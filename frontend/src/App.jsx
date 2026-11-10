import React, { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import Sidebar from './components/Sidebar.jsx'
import TopBar from './components/TopBar.jsx'
import ReportingTab from './components/ReportingTab.jsx'
import AveragesTab from './components/AveragesTab.jsx'
import PlayerHighlightsTab from './components/PlayerHighlightsTab.jsx'
import LongitudinalTab from './components/LongitudinalTab.jsx'
import AthleteDrillTab from './components/AthleteDrillTab.jsx'
import SessionReportTab from './components/SessionReportTab.jsx'
import DrillReportTab from './components/DrillReportTab.jsx'
import DrillReportSelectTab from './components/DrillReportSelectTab.jsx'
import ThisWeekTab from './components/ThisWeekTab.jsx'
import SpeedExposureTab from './components/SpeedExposureTab.jsx'
import GameReportTab from './components/GameReportTab.jsx'
import RehabTab from './components/RehabTab.jsx'
import PlayerProfileTab from './components/PlayerProfileTab.jsx'
import DrillMatrixTab from './components/DrillMatrixTab.jsx'
import PrescriptionTab from './components/PrescriptionTab.jsx'
import PlayerPhotosPanel from './components/PlayerPhotosPanel.jsx'
import { PhotoContext } from './photos.jsx'
import { fetchPhotos } from './api.js'
import { fetchData, fetchLastFetch } from './api.js'
import { uniqueSorted } from './utils/aggregate.js'
import { loadAppConfig, parseConfigDate, parseConfigList } from './utils/appConfig.js'
import { captureElementToCanvas, buildPdfFromCanvases } from './utils/exportPdf.js'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

const TABS = [
  { key: 'reporting', label: 'Reporting' },
  { key: 'highlights', label: 'Player Highlights' },
  { key: 'averages', label: 'Averages' },
  { key: 'longitudinal', label: 'Longitudinal' },
  { key: 'athleteDrill', label: 'Athlete Drill' },
  { key: 'sessionReport', label: 'Session Report' },
  { key: 'drillReport', label: 'Drill Report' },
  { key: 'drillReportSelect', label: 'Drill Report Select' },
  { key: 'thisWeek', label: 'This Week' },
  { key: 'speedExposure', label: 'Speed Exposure' },
  { key: 'gameReport', label: 'Game Report' },
  { key: 'rehab', label: 'Rehab' },
  { key: 'playerProfile', label: 'Player Profile' },
  { key: 'drillMatrix', label: 'Drill Matrix' },
  { key: 'prescription', label: 'Running Prescription' },
]

export default function App() {
  const [token, setToken] = useState('')
  const [photos, setPhotos] = useState({})
  useEffect(() => { fetchPhotos().then(setPhotos).catch(() => {}) }, [])
  const [region, setRegion] = useState('APAC')
  const [startDate, setStartDate] = useState(todayISO())
  const [endDate, setEndDate] = useState(todayISO())

  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const [activities, setActivities] = useState([])
  const [rows, setRows] = useState([])

  const reportingSectionRef = useRef(null)
  const highlightsSectionRef = useRef(null)

  const [selectedDate, setSelectedDate] = useState(null)
  const [selectedActivityId, setSelectedActivityId] = useState(null)
  const [selectedPeriods, setSelectedPeriods] = useState([])
  const [activeTab, setActiveTab] = useState('reporting')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [compareMode, setCompareMode] = useState(null)
  const [trainingAverage, setTrainingAverage] = useState(null)
  const [matchAverage, setMatchAverage] = useState(null)

  // Loaded from /app-config.txt (frontend/public/app-config.txt) — see
  // that file for the editable defaults. configLoaded gates mounting the
  // Averages builders so their one-time "default tag" selection always
  // sees the real config values, never a race against the fetch.
  const [configLoaded, setConfigLoaded] = useState(false)
  const [defaultTrainingTags, setDefaultTrainingTags] = useState([])
  const [defaultTrainingPeriods, setDefaultTrainingPeriods] = useState([])
  const [defaultMatchTags, setDefaultMatchTags] = useState([])
  const [defaultMatchPeriods, setDefaultMatchPeriods] = useState([])

  useEffect(() => {
    let cancelled = false
    loadAppConfig().then((cfg) => {
      if (cancelled) return
      const startFromConfig = parseConfigDate(cfg.default_start_date)
      const endFromConfig = parseConfigDate(cfg.default_end_date)
      if (startFromConfig) setStartDate(startFromConfig)
      if (endFromConfig) setEndDate(endFromConfig)
      setDefaultTrainingTags(parseConfigList(cfg.default_training_tag))
      setDefaultMatchTags(parseConfigList(cfg.default_match_tag))
      setDefaultTrainingPeriods(parseConfigList(cfg.default_training_periods))
      setDefaultMatchPeriods(parseConfigList(cfg.default_match_periods))
      setConfigLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleFetchData = async () => {
    setError(null)
    setLoading(true)
    try {
      const data = await fetchData({ token, region, startDate, endDate })
      if (!data.activities || data.activities.length === 0) {
        setError('No activities were found in that date range.')
        setLoading(false)
        return
      }
      applyData(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Put a fetch result on screen (a new fetch, or the saved one on page open)
  const applyData = (data) => {
    setActivities(data.activities)
    setRows(data.rows)
    setConnected(true)

    const withTimes = data.activities.filter((a) => a.start_time !== null && a.start_time !== undefined)
    const mostRecent =
      withTimes.length > 0
        ? withTimes.reduce((latest, a) => (a.start_time > latest.start_time ? a : latest))
        : data.activities[data.activities.length - 1]

    setSelectedDate(mostRecent.date || null)
    setSelectedActivityId(mostRecent.id)
  }

  // On open, reload the last fetch the backend saved to disk, so a restart or
  // closing the laptop does not lose the data. Waits for app-config so the
  // config's default dates never overwrite the restored ones.
  const restoredRef = useRef(false)
  useEffect(() => {
    if (!configLoaded || restoredRef.current) return
    restoredRef.current = true
    fetchLastFetch().then((saved) => {
      const data = saved && saved.data
      if (!data || !data.activities || data.activities.length === 0) return
      if (saved.token) setToken(saved.token)
      if (saved.region) setRegion(saved.region)
      if (saved.start_date) setStartDate(saved.start_date)
      if (saved.end_date) setEndDate(saved.end_date)
      applyData(data)
    }).catch(() => {})
  }, [configLoaded])

  const handleReset = () => {
    setConnected(false)
    setActivities([])
    setRows([])
    setSelectedDate(null)
    setSelectedActivityId(null)
    setSelectedPeriods([])
    setError(null)
    setActiveTab('reporting')
    setCompareMode(null)
    setTrainingAverage(null)
    setMatchAverage(null)
  }

  const handleExportPdf = async ({ includeReport, includeHighlights }) => {
    const originalTab = activeTab
    let reportCanvas = null
    let highlightsCanvas = null
    try {
      // flushSync forces the tab switch's DOM update to complete before we
      // proceed, so html2canvas always captures the section actually
      // visible on screen rather than racing a still-hidden element.
      if (includeReport) {
        flushSync(() => setActiveTab('reporting'))
        reportCanvas = await captureElementToCanvas(reportingSectionRef.current)
      }
      if (includeHighlights) {
        flushSync(() => setActiveTab('highlights'))
        highlightsCanvas = await captureElementToCanvas(highlightsSectionRef.current)
      }
      await buildPdfFromCanvases({ reportCanvas, highlightsCanvas })
    } finally {
      flushSync(() => setActiveTab(originalTab))
    }
  }

  const selectedActivity = useMemo(
    () => activities.find((a) => a.id === selectedActivityId) || null,
    [activities, selectedActivityId]
  )

  const activityRows = useMemo(
    () => (selectedActivityId ? rows.filter((r) => String(r.activity_id) === String(selectedActivityId)) : []),
    [rows, selectedActivityId]
  )

  const periodOptions = useMemo(
    () => uniqueSorted(activityRows.map((r) => r.period_name)),
    [activityRows]
  )

  // Default to "all periods selected" whenever the selected activity's
  // available periods actually change (e.g. switching activities) — but
  // leave the selection alone if it's the same pool and the person just
  // used Select All / Select None themselves.
  const prevPeriodPoolRef = useRef(null)
  useEffect(() => {
    const signature = periodOptions.join(',')
    if (prevPeriodPoolRef.current !== signature) {
      prevPeriodPoolRef.current = signature
      setSelectedPeriods(periodOptions)
    }
  }, [periodOptions])

  const reportingRows = useMemo(
    () => activityRows.filter((r) => selectedPeriods.includes(r.period_name)),
    [activityRows, selectedPeriods]
  )

  return (
    <PhotoContext.Provider value={photos}>
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <img src="/cat-vertical-logo.png" alt="Catapult" className="header-logo" />
        </div>
        <div className="header-center" />
        <div className="header-right">
          <img src="/frankston-logo.jpg" alt="Frankston Football Club" className="header-logo" />
        </div>
      </header>

      <div className="app-body">
        <Sidebar
          token={token}
          setToken={setToken}
          region={region}
          setRegion={setRegion}
          startDate={startDate}
          setStartDate={setStartDate}
          endDate={endDate}
          setEndDate={setEndDate}
          connected={connected}
          loading={loading}
          onFetchData={handleFetchData}
          onReset={handleReset}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
        >
          <PlayerPhotosPanel
            names={[...new Set(rows.map((r) => r.athlete_name).filter(Boolean))]}
            photos={photos}
            onPhotos={setPhotos}
          />
        </Sidebar>

        <main className="main-content">
          <div className="page-title">
            <h2>Activity &amp; Athlete Reporting</h2>
            <div className="rule" />
          </div>

          {error && <div className="error-bar" style={{ marginBottom: 18 }}>{error}</div>}

          {!connected && !loading && (
            <div className="empty-state">
              <div className="empty-icon">⚡</div>
              <h2>Ready to connect</h2>
              <p>
                Enter your OpenField token, region, and a date range in the sidebar, then press{' '}
                <strong>Fetch Data</strong> to begin.
              </p>
            </div>
          )}

          {connected && (
            <>
              <TopBar
                activities={activities}
                selectedDate={selectedDate}
                setSelectedDate={setSelectedDate}
                selectedActivityId={selectedActivityId}
                setSelectedActivityId={setSelectedActivityId}
                periodOptions={periodOptions}
                selectedPeriods={selectedPeriods}
                setSelectedPeriods={setSelectedPeriods}
                compareMode={compareMode}
                setCompareMode={setCompareMode}
                hasTrainingAverage={!!trainingAverage}
                hasMatchAverage={!!matchAverage}
                onExportPdf={handleExportPdf}
              />

              <div className="tab-bar" style={{ marginBottom: 20 }}>
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className={`tab-btn ${activeTab === t.key ? 'active' : ''}`}
                    onClick={(e) => {
                      setActiveTab(t.key)
                      e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div ref={reportingSectionRef} style={{ display: activeTab === 'reporting' ? 'block' : 'none' }}>
                {selectedActivity && (
                  <div className="activity-banner">
                    <span className="activity-banner-name">{selectedActivity.name}</span>
                    <img src="/frankston-logo.jpg" alt="Frankston Football Club" className="activity-banner-logo" />
                  </div>
                )}
                <ReportingTab
                  rows={reportingRows}
                  activityName={selectedActivity?.name}
                  compareMode={compareMode}
                  trainingAverage={trainingAverage}
                  matchAverage={matchAverage}
                />
              </div>
              <div style={{ display: activeTab === 'averages' ? 'block' : 'none' }}>
                {selectedActivity && (
                  <div className="activity-banner">
                    <span className="activity-banner-name">{selectedActivity.name}</span>
                    <img src="/frankston-logo.jpg" alt="Frankston Football Club" className="activity-banner-logo" />
                  </div>
                )}
                {configLoaded && (
                  <AveragesTab
                    activities={activities}
                    rows={rows}
                    onTrainingComputed={setTrainingAverage}
                    onMatchComputed={setMatchAverage}
                    defaultTrainingTags={defaultTrainingTags}
                    defaultTrainingPeriods={defaultTrainingPeriods}
                    defaultMatchTags={defaultMatchTags}
                    defaultMatchPeriods={defaultMatchPeriods}
                  />
                )}
              </div>
              <div style={{ display: activeTab === 'prescription' ? 'block' : 'none' }}>
                {activeTab === 'prescription' && <PrescriptionTab />}
              </div>
              <div style={{ display: activeTab === 'drillMatrix' ? 'block' : 'none' }}>
                {activeTab === 'drillMatrix' && <DrillMatrixTab token={token} region={region} />}
              </div>
              <div style={{ display: activeTab === 'playerProfile' ? 'block' : 'none' }}>
                {activeTab === 'playerProfile' && <PlayerProfileTab token={token} region={region} />}
              </div>
              <div style={{ display: activeTab === 'rehab' ? 'block' : 'none' }}>
                {activeTab === 'rehab' && <RehabTab />}
              </div>
              <div style={{ display: activeTab === 'gameReport' ? 'block' : 'none' }}>
                {activeTab === 'gameReport' && <GameReportTab token={token} region={region} />}
              </div>
              <div style={{ display: activeTab === 'speedExposure' ? 'block' : 'none' }}>
                {activeTab === 'speedExposure' && <SpeedExposureTab token={token} region={region} />}
              </div>
              <div style={{ display: activeTab === 'thisWeek' ? 'block' : 'none' }}>
                {activeTab === 'thisWeek' && <ThisWeekTab token={token} region={region} />}
              </div>
              <div style={{ display: activeTab === 'drillReportSelect' ? 'block' : 'none' }}>
                <DrillReportSelectTab rows={rows} />
              </div>
              <div style={{ display: activeTab === 'drillReport' ? 'block' : 'none' }}>
                <DrillReportTab rows={rows} />
              </div>
              <div style={{ display: activeTab === 'sessionReport' ? 'block' : 'none' }}>
                <SessionReportTab rows={rows} />
              </div>
              <div style={{ display: activeTab === 'athleteDrill' ? 'block' : 'none' }}>
                <AthleteDrillTab rows={rows} />
              </div>
              <div style={{ display: activeTab === 'longitudinal' ? 'block' : 'none' }}>
                <LongitudinalTab rows={rows} activities={activities} />
              </div>
              <div ref={highlightsSectionRef} style={{ display: activeTab === 'highlights' ? 'block' : 'none' }}>
                {selectedActivity && (
                  <div className="activity-banner">
                    <span className="activity-banner-name">{selectedActivity.name}</span>
                    <img src="/frankston-logo.jpg" alt="Frankston Football Club" className="activity-banner-logo" />
                  </div>
                )}
                <PlayerHighlightsTab
                  rows={reportingRows}
                  compareMode={compareMode}
                  trainingAverage={trainingAverage}
                  matchAverage={matchAverage}
                />
              </div>
            </>
          )}
        </main>
      </div>
    </div>
    </PhotoContext.Provider>
  )
}
