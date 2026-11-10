import React from 'react'
import DatePicker from './DatePicker.jsx'

const REGIONS = ['APAC', 'CHINA', 'EMEA', 'NAM']

export default function Sidebar({
  token, setToken,
  region, setRegion,
  startDate, setStartDate,
  endDate, setEndDate,
  connected,
  loading,
  onFetchData,
  onReset,
  collapsed,
  onToggleCollapsed,
  children,
}) {
  const handleSubmit = (e) => {
    e.preventDefault()
    onFetchData()
  }

  const canFetch = token.trim().length > 0 && startDate && endDate && startDate <= endDate

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <button
        type="button"
        className="sidebar-toggle-btn"
        onClick={onToggleCollapsed}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? '»' : '«'}
      </button>

      {!collapsed && (
        <div className="sidebar-content">
          <div className="sidebar-brand">Catapult Sports</div>
          <div className="sidebar-label" style={{ marginBottom: 16, color: 'var(--cat-text-muted)' }}>
            Activity &amp; Athlete Reporting
          </div>

          <form onSubmit={handleSubmit}>
            <div className="sidebar-section">
              <span className="sidebar-label">Token</span>
              <div className="sidebar-field">
                <input
                  className="config-input"
                  type="password"
                  placeholder="Paste bearer token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  disabled={connected}
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="sidebar-section">
              <span className="sidebar-label">Region</span>
              <select className="config-select" value={region} onChange={(e) => setRegion(e.target.value)} disabled={connected}>
                {REGIONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div className="sidebar-section">
              <span className="sidebar-label">Date Range</span>
              <div className="sidebar-field">
                <span className="field-hint" style={{ display: 'block', marginBottom: 4 }}>Start date</span>
                <DatePicker value={startDate} onChange={setStartDate} disabled={connected} className="sidebar-datepicker" />
              </div>
              <div className="sidebar-field">
                <span className="field-hint" style={{ display: 'block', marginBottom: 4 }}>End date</span>
                <DatePicker value={endDate} onChange={setEndDate} disabled={connected} className="sidebar-datepicker" />
              </div>
            </div>

            {connected ? (
              <button type="button" className="btn-stop btn-block" onClick={onReset}>
                Reset
              </button>
            ) : (
              <button className="btn-start btn-teal btn-block" type="submit" disabled={!canFetch || loading}>
                {loading ? 'Fetching…' : 'Fetch Data'}
              </button>
            )}
          </form>

          <div className="sidebar-divider" />
          <div className="field-hint">
            Token, region, and dates lock once data is fetched — hit Reset to start a new pull.
          </div>
          {children}
        </div>
      )}
    </aside>
  )
}
