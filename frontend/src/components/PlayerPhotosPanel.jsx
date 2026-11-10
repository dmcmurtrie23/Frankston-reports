import React, { useState } from 'react'
import { removePhoto, savePhotos, scanPhotos } from '../api.js'

// Sidebar panel: paste a team / squad web page, match its photos to the players in the app
// (by the names printed on the page, nicknames allowed), check the list, then save.
export default function PlayerPhotosPanel({ names, photos, onPhotos }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [scan, setScan] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [msg, setMsg] = useState(null)
  const [pick, setPick] = useState({})     // index -> {on, player}

  const doScan = async () => {
    setBusy(true); setError(null); setMsg(null); setScan(null)
    try {
      const out = await scanPhotos(url, names)
      setScan(out)
      setPick(Object.fromEntries(out.items.map((m, i) => [i, { on: m.status === 'match', player: m.player || '' }])))
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const doSave = async () => {
    const items = scan.items.map((m, i) => ({ ...m, ...pick[i] })).filter((m) => m.on && m.player)
      .map((m) => ({ player: m.player, image_url: m.image_url }))
    setBusy(true); setError(null)
    try {
      const out = await savePhotos(items, url)
      onPhotos(out.photos)
      setMsg(`Saved ${out.saved.length} photo${out.saved.length === 1 ? '' : 's'}${out.failed.length ? ` · ${out.failed.length} couldn't be downloaded` : ''}.`)
      setScan(null)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const n = Object.keys(photos || {}).length
  const allNames = [...new Set([...(names || []), ...(scan?.items || []).map((m) => m.player).filter(Boolean)])].sort()

  return (
    <div className="pp-panel">
      <button type="button" className="pp-panel-head" onClick={() => setOpen((o) => !o)}>
        <span className="sidebar-label" style={{ margin: 0 }}>Player photos</span>
        <span className="field-hint">{n} saved {open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          <p className="field-hint" style={{ marginBottom: 8 }}>
            Paste your club's team or squad page. Photos are matched to players by the names on the page.
          </p>
          <input className="config-input" placeholder="https://… team page" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button type="button" className="btn-start btn-teal btn-block" style={{ marginTop: 8 }} disabled={!url.trim() || busy} onClick={doScan}>
            {busy && !scan ? 'Reading page…' : 'Find photos'}
          </button>
          {error && <div className="field-hint" style={{ color: '#ff8a80', marginTop: 8 }}>{error}</div>}
          {msg && <div className="field-hint" style={{ color: '#4fc483', marginTop: 8 }}>{msg}</div>}

          {scan && (
            <div style={{ marginTop: 10 }}>
              <div className="field-hint" style={{ marginBottom: 6 }}>
                {scan.found_on_page} on the page · {scan.items.filter((m) => m.status === 'match').length} matched ·{' '}
                {scan.items.filter((m) => m.status === 'check').length} to check
              </div>
              <div className="pp-scan">
                {scan.items.map((m, i) => (
                  <div key={i} className={`pp-scan-row ${m.status}`}>
                    <input type="checkbox" checked={!!pick[i]?.on} onChange={(e) => setPick((p) => ({ ...p, [i]: { ...p[i], on: e.target.checked } }))} />
                    <img src={m.image_url} alt="" referrerPolicy="no-referrer" />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="pp-scan-name" title={m.page_name}>{m.page_name}</div>
                      <select className="config-select" value={pick[i]?.player || ''}
                        onChange={(e) => setPick((p) => ({ ...p, [i]: { on: !!e.target.value, player: e.target.value } }))}>
                        <option value="">— not in the app —</option>
                        {allNames.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" className="btn-start btn-teal btn-block" style={{ marginTop: 8 }} disabled={busy} onClick={doSave}>
                {busy ? 'Saving…' : `Save ${Object.values(pick).filter((p) => p.on && p.player).length} photos`}
              </button>
              {scan.players_without_photo?.length > 0 && (
                <p className="field-hint" style={{ marginTop: 8 }}>
                  No photo found for: {scan.players_without_photo.join(', ')}.
                </p>
              )}
            </div>
          )}

          {n > 0 && !scan && (
            <details style={{ marginTop: 10 }}>
              <summary className="field-hint" style={{ cursor: 'pointer' }}>Saved photos</summary>
              {Object.keys(photos).sort().map((p) => (
                <div key={p} className="pp-saved">
                  <span>{p}</span>
                  <button type="button" className="select-link" onClick={async () => onPhotos((await removePhoto(p)).photos)}>Remove</button>
                </div>
              ))}
            </details>
          )}
        </div>
      )}
    </div>
  )
}
