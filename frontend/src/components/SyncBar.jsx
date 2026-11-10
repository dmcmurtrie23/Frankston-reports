import React, { useCallback, useEffect, useRef, useState } from 'react'
import { fetchThisWeekSyncStatus, startThisWeekSync } from '../api.js'

// The "Pull from Catapult now" bar shared by the sport-science pages (This Week,
// Speed Exposure). The pull runs on the backend; this just starts it and polls.
export default function SyncBar({ token, region, onDone, extra }) {
  const [sync, setSync] = useState(null)
  const [error, setError] = useState(null)
  const pollRef = useRef(null)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  const poll = useCallback(async () => {
    try {
      const s = await fetchThisWeekSyncStatus()
      setSync(s)
      if (!s.running && pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
        doneRef.current && doneRef.current()
      }
    } catch (e) {
      /* backend restarting — keep polling */
    }
  }, [])

  useEffect(() => {
    fetchThisWeekSyncStatus()
      .then((s) => {
        setSync(s)
        if (s.running && !pollRef.current) pollRef.current = setInterval(poll, 2000)
      })
      .catch(() => {})
    return () => pollRef.current && clearInterval(pollRef.current)
  }, [poll])

  const pull = async () => {
    setError(null)
    try {
      const s = await startThisWeekSync({ token, region })
      setSync(s)
      if (!pollRef.current) pollRef.current = setInterval(poll, 2000)
    } catch (e) {
      setError(e.message)
    }
  }

  const fmt = (iso, opts) => new Date(iso).toLocaleString('en-AU', opts)
  const line = sync?.running
    ? `Pulling from Catapult… ${sync.message || ''}`
    : sync?.last_check
      ? `Last checked ${fmt(sync.last_check, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`
      : 'Not pulled from Catapult yet'

  return (
    <>
      <div className="tw-sync">
        <span className={`tw-dot ${sync?.running ? 'run' : sync?.last_error ? 'err' : sync?.last_check ? 'ok' : ''}`} />
        <span>{line}</span>
        {extra && <span className="field-hint">· {extra}</span>}
        {sync?.token_expires && (
          <span className="field-hint">
            · token expires {new Date(`${sync.token_expires}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}
          </span>
        )}
        <button type="button" className="toggle-btn" onClick={pull} disabled={!token || sync?.running} style={{ marginLeft: 'auto' }}>
          {sync?.running ? 'Pulling…' : 'Pull from Catapult now'}
        </button>
      </div>
      {sync?.last_error && !sync?.running && <div className="tw-error">Last pull failed: {sync.last_error}</div>}
      {error && <div className="tw-error">{error}</div>}
    </>
  )
}
