import React, { useEffect, useState } from 'react'
import { fetchRehab, saveRehab } from '../api.js'
import { AllClear, fmtDay } from './ThisWeekTab.jsx'
import { Avatar } from '../photos.jsx'

// "Rehab" — ported from the Frankston Sport Science app. Return to play: the medical
// team keeps the rehab list here; each player's best session in the last 14 days is
// shown against their average game (white line) and peak game (grey line).

const blank = (stage) => ({ player: '', stage, injury: '', start_date: '', target_date: '', notes: '', active: true })

function RehabCard({ c, stages, recentDays }) {
  const [showSessions, setShowSessions] = useState(false)
  const n0 = (v) => (v === null || v === undefined ? '–' : Math.round(v).toLocaleString('en-AU'))
  return (
    <div className="rh-card">
      <div className="rh-top">
        <div className="rh-who-wrap">
          <Avatar name={c.player} size={56} />
          <div>
            <div className="rh-who">{c.player}</div>
            <div className="rh-sub">{c.sub}</div>
          </div>
        </div>
        <span className="tw-pill rh-stage">{c.stage}</span>
      </div>

      <div className="rh-track">
        {stages.map((s, k) => <div key={s} className={k < c.stage_index ? 'done' : k === c.stage_index ? 'now' : ''} />)}
      </div>
      <div className="rh-track-l">
        {stages.map((s, k) => <span key={s} className={k === c.stage_index ? 'now' : ''}>{s}</span>)}
      </div>

      {c.bars.length > 0 && (
        <>
          <div className="rh-bars">
            {c.bars.map((b) => {
              const pct = b.pct
              const width = pct === null || pct === undefined ? 0 : (Math.min(pct, 1.5) / 1.5) * 100
              const colour = pct === null || pct === undefined ? '#ff5147' : pct >= 1 ? '#4fc483' : pct >= 0.8 ? '#f2b33d' : '#ff5147'
              return (
                <div key={b.label} className="rh-bar">
                  <div className="l">{b.label}</div>
                  <div className="t">
                    <div className="f" style={{ width: `${width}%`, background: colour }} />
                    <div className="m" style={{ left: `${100 / 1.5}%` }} />
                    {b.peak_ratio ? <div className="m pk" style={{ left: `${(Math.min(b.peak_ratio, 1.5) / 1.5) * 100}%` }} /> : null}
                  </div>
                  <div className="v"><b>{b.best}</b> / {b.average}{b.unit ? ` ${b.unit}` : ''}</div>
                </div>
              )
            })}
          </div>
          <div className="rh-legend">
            <span><i />Average game</span><span><i className="pk" />Peak game</span><span>Bar: best session, last {recentDays} days</span>
          </div>
        </>
      )}

      {c.checks.length > 0 && (
        <div className="rh-checks">
          {c.checks.map((k) => <span key={k.label} className={k.ok ? 'ok' : ''}>{k.ok ? '✓' : '○'} {k.label}</span>)}
        </div>
      )}
      {c.next_step && <div className="rh-next">{c.next_step}</div>}

      {c.caution && (
        <div className="rh-caution">
          <div className="h">{c.caution.heading}</div>
          <div className="b">{c.caution.body}</div>
          {c.caution.limits.length > 0 && (
            <div className="lim">{c.caution.limits.map((l) => <span key={l.label}><i>{l.label}</i>{l.value}</span>)}</div>
          )}
        </div>
      )}
      {c.notes && <p className="field-hint" style={{ marginTop: 10 }}>Notes: {c.notes}</p>}

      {c.sessions.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button type="button" className="select-link" onClick={() => setShowSessions((v) => !v)}>
            {showSessions ? 'Hide' : 'Show'} sessions in the last {recentDays} days ({c.sessions.length})
          </button>
          {showSessions && (
            <div className="summary-table-wrap" style={{ marginTop: 8 }}>
              <table className="summary-table">
                <thead>
                  <tr>
                    <th>Date</th><th>Session</th><th>Distance (m)</th><th>HSR (m)</th><th>Sprint (m)</th>
                    <th>&gt;80% max (m)</th><th>Top speed (km/h)</th><th>Peak 1 min (m/min)</th><th>Accels</th><th>Decels</th>
                  </tr>
                </thead>
                <tbody>
                  {c.sessions.map((s, i) => (
                    <tr key={i}>
                      <td>{fmtDay(s.date)}</td><td>{s.session}</td><td>{n0(s.distance_m)}</td><td>{n0(s.hsr_m)}</td>
                      <td>{n0(s.sprint_m)}</td><td>{n0(s.z80_m)}</td>
                      <td>{s.top_kmh === null || s.top_kmh === undefined ? '–' : s.top_kmh.toFixed(1)}</td>
                      <td>{n0(s.peak_mpm_60s)}</td><td>{s.accels ?? '–'}</td><td>{s.decels ?? '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function RehabTab() {
  const [data, setData] = useState(null)
  const [rows, setRows] = useState([])
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [error, setError] = useState(null)

  const apply = (out) => {
    setData(out)
    setRows(out.list.map((r) => ({ ...r, start_date: r.start_date || '', target_date: r.target_date || '' })))
  }

  useEffect(() => {
    fetchRehab()
      .then((out) => { apply(out); setEditing(out.cards.length === 0) })
      .catch((e) => setError(e.message))
  }, [])

  const set = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      apply(await saveRehab(rows.filter((r) => r.player.trim())))
      setMsg('Rehab list saved.')
      setTimeout(() => setMsg(null), 2500)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const d = data
  const n = d?.cards.length ?? 0

  return (
    <div className="tw">
      <div className="tw-head">
        <div>
          <div className="tw-title">Rehab</div>
          <div className="tw-sub">Return to play · {n} player{n === 1 ? '' : 's'} · how far off game demands</div>
        </div>
      </div>
      {error && <div className="tw-error">{error}</div>}

      {d && (
        <details className="tw-fold" open={editing} onToggle={(e) => setEditing(e.currentTarget.open)}>
          <summary><span className="tw-fold-title">Edit the rehab list</span><span className="tw-fold-count">{d.list.length} on the list</span></summary>
          <p className="tw-fold-note">
            Medical team: add a player, set their stage, and update it as they progress. Untick Active when they're back playing.
          </p>
          <div className="summary-table-wrap">
            <table className="summary-table rh-edit">
              <thead>
                <tr><th>Player</th><th>Stage</th><th>Injury</th><th>Start</th><th>Target return</th><th>Notes</th><th>Active</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <select className="config-select" value={r.player} onChange={(e) => set(i, 'player', e.target.value)}>
                        <option value="">Choose…</option>
                        {d.players.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="config-select" value={r.stage} onChange={(e) => set(i, 'stage', e.target.value)}>
                        {d.stages.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td><input className="config-select" value={r.injury} onChange={(e) => set(i, 'injury', e.target.value)} /></td>
                    <td><input type="date" className="config-select" value={r.start_date} onChange={(e) => set(i, 'start_date', e.target.value)} /></td>
                    <td><input type="date" className="config-select" value={r.target_date} onChange={(e) => set(i, 'target_date', e.target.value)} /></td>
                    <td><input className="config-select" value={r.notes} onChange={(e) => set(i, 'notes', e.target.value)} /></td>
                    <td><input type="checkbox" checked={r.active} onChange={(e) => set(i, 'active', e.target.checked)} /></td>
                    <td><button type="button" className="select-link" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '10px 0 4px' }}>
            <button type="button" className="toggle-btn" onClick={() => setRows((rs) => [...rs, blank(d.stages[0])])}>+ Add player</button>
            <button type="button" className="toggle-btn active" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save rehab list'}</button>
            {msg && <span className="field-hint">{msg}</span>}
          </div>
        </details>
      )}

      {d && n === 0 && <AllClear>Nobody in rehab.</AllClear>}
      {d?.cards.map((c) => <RehabCard key={c.player} c={c} stages={d.stages} recentDays={d.recent_days} />)}

      {d && (
        <div className="tw-notes" style={{ marginTop: 12 }}>
          <p>
            <strong>Bar</strong> = best single session in the last {d.recent_days} days, against their <strong>average game</strong> (white line)
            and <strong>peak game</strong> (grey line). Green means at or above an average game, amber 80–99%, red under 80%.
          </p>
          <p>
            <strong>Game demands</strong> come from their own games this season (at least 3, leaving out games they only partly played),
            otherwise the squad's. Volume is per session vs per game; peak 1 and 5 min are the best rolling windows.
          </p>
          <p><strong>Top speed</strong> is held for 0.5 s. The medical team sets the stage; the numbers only show where the gaps are.</p>
        </div>
      )}
    </div>
  )
}
