import React, { useEffect, useState } from 'react'
import { fetchPrescription, fetchPrescriptionRunners, saveTimeTrials } from '../api.js'
import { AllClear, Fold, Tile } from './ThisWeekTab.jsx'

// "Running Prescription" — ported from the Frankston Sport Science app. Speed, pace and
// metres for a running session by MAS group or by player, and what the session targets.

const BASES = [['MAS', '% MAS'], ['ASR', 'MAS + % ASR'], ['MaxV', '% Max speed']]

function Num({ label, value, onChange, step = 1, min = 0, max = 600 }) {
  return (
    <div>
      <span className="sidebar-label" style={{ display: 'block', marginBottom: 6 }}>{label}</span>
      <input type="number" className="config-select" style={{ width: 96, backgroundImage: 'none' }} value={value} step={step} min={min} max={max}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
    </div>
  )
}

export default function PrescriptionTab() {
  const [base, setBase] = useState(null)
  const [preset, setPreset] = useState('')
  const [sess, setSess] = useState(null)
  const [mode, setMode] = useState('MAS Group')
  const [roundTo, setRoundTo] = useState(1)
  const [out, setOut] = useState(null)
  const [error, setError] = useState(null)
  const [tts, setTts] = useState([])
  const [saved, setSaved] = useState(null)

  const applyBase = (b) => {
    setBase(b)
    setTts(b.time_trials.map((r) => ({ ...r })))
  }
  useEffect(() => {
    fetchPrescriptionRunners().then((b) => {
      applyBase(b)
      const first = Object.keys(b.presets)[0]
      setPreset(first)
      setSess({ cod: 0, basis: 'MAS', ...b.presets[first], intensity: b.presets[first].intensity * 100 })
    }).catch((e) => setError(e.message))
  }, [])

  const pick = (name) => {
    setPreset(name)
    const p = base.presets[name]
    setSess({ cod: 0, basis: 'MAS', ...p, intensity: p.intensity * 100 })
  }
  const set = (k, v) => setSess((s) => ({ ...s, [k]: v }))

  useEffect(() => {
    if (!sess || Object.values(sess).some((v) => v === '')) return undefined
    const t = setTimeout(() => {
      fetchPrescription({ session: { ...sess, intensity: sess.intensity / 100 }, mode, roundTo })
        .then((o) => { setOut(o); setError(null) })
        .catch((e) => setError(e.message))
    }, 250)
    return () => clearTimeout(t)
  }, [sess, mode, roundTo, base])

  const saveTT = async () => {
    try {
      applyBase(await saveTimeTrials(tts.filter((r) => r.player)))
      setSaved('Saved.')
      setTimeout(() => setSaved(null), 2000)
    } catch (e) { setError(e.message) }
  }

  const downloadCsv = () => {
    const cols = ['player', 'mas', 'asr', 'group', 'kmh', 'pace', 'pct_max', 'rep_m', ...(out.cod ? ['shuttle_m'] : []), 'total_m']
    const lines = [cols.join(','), ...out.rows.map((r) => cols.map((c) => r[c] ?? '').join(','))]
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'prescription.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="tw">
      <div className="tw-head">
        <div>
          <div className="tw-title">Running Prescription</div>
          <div className="tw-sub">By MAS group or by player · km/h, pace and metres</div>
        </div>
      </div>
      {error && <div className="tw-error">{error}</div>}

      {base && sess && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body">
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
              <div>
                <span className="sidebar-label" style={{ display: 'block', marginBottom: 6 }}>Session</span>
                <select className="config-select" value={preset} onChange={(e) => pick(e.target.value)} style={{ minWidth: 380 }}>
                  {Object.keys(base.presets).map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
              <Num label="Sets" value={sess.sets} onChange={(v) => set('sets', v)} min={1} max={20} />
              <Num label="Reps" value={sess.reps} onChange={(v) => set('reps', v)} min={1} max={50} />
              <Num label="Work (s)" value={sess.work_s} onChange={(v) => set('work_s', v)} min={5} />
              <Num label="Rest (s)" value={sess.rest_s} onChange={(v) => set('rest_s', v)} />
              <div>
                <span className="sidebar-label" style={{ display: 'block', marginBottom: 6 }}>Basis</span>
                <select className="config-select" value={sess.basis} onChange={(e) => set('basis', e.target.value)} style={{ minWidth: 150 }}
                  title="% MAS for aerobic work. MAS + % ASR above MAS, so each player's top speed is accounted for. % max speed for speed and repeated-sprint work.">
                  {BASES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
              <Num label="Intensity %" value={sess.intensity} onChange={(v) => set('intensity', v)} step={2.5} max={200} />
              <Num label="CoD per rep" value={sess.cod} onChange={(v) => set('cod', v)} max={10} />
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <div className="tw-seg" style={{ marginBottom: 0 }}>
                {['MAS Group', 'Player'].map((m) => (
                  <button key={m} type="button" className={`tw-seg-btn ${mode === m ? 'active' : ''}`} onClick={() => setMode(m)}>By {m.toLowerCase()}</button>
                ))}
              </div>
              <select className="config-select" value={roundTo} onChange={(e) => setRoundTo(Number(e.target.value))} style={{ minWidth: 150 }}>
                <option value={1}>Nearest 1 m</option><option value={5}>Nearest 5 m</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {out?.empty && (
        <AllClear>
          No 2 km time trials yet, so there's no MAS to prescribe from. Add them in <strong>Time trials</strong> below
          (or add the conditioning workbook).
        </AllClear>
      )}

      {out && !out.empty && (
        <>
          <div className="pp-section-h">What this session targets <span>{out.label}</span></div>
          <div className="tw-clear" style={{ borderLeftColor: '#E31B23', marginBottom: 12 }}>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{out.target.type}</div>
            <div style={{ color: 'var(--cat-text-dim)', marginTop: 2 }}>{out.target.objective}</div>
            {out.target.notes.map((n, i) => <div key={i} className="field-hint" style={{ marginTop: 4 }}>{n}</div>)}
          </div>
          <div className="tw-tiles">{out.tiles.map((t) => <Tile key={t.label} label={t.label} value={t.value} unit={t.unit || ''} sub={t.sub} />)}</div>
          <p className="field-hint" style={{ marginTop: -6, marginBottom: 10 }}>
            {out.target.source !== 'estimate' ? `Expected responses: ${out.target.source}.` : "This session doesn't match a type, so no expected response is given."}
          </p>
          {out.warning && <div className="tw-error" style={{ background: 'rgba(242,179,61,.1)', borderColor: 'rgba(242,179,61,.45)', color: '#f2d08a' }}>{out.warning}</div>}

          <div className="pp-section-h">Targets <span>Speed, pace and distance for each group or player. Use the distance with a trundle wheel and the pace on a watch.</span></div>
          <div className="summary-table-wrap">
            <table className="summary-table">
              <thead>
                {mode === 'MAS Group' ? (
                  <tr><th>Group (m/s)</th>{out.basis !== 'MAS' && <th>Group ASR (m/s)</th>}<th>km/h</th><th>Pace /km</th><th>Rep (m)</th>
                    {out.cod ? <th>Shuttle (m)</th> : null}<th>Total (m)</th><th>Players</th><th>Who</th></tr>
                ) : (
                  <tr><th>Player</th><th>MAS (m/s)</th><th>ASR (m/s)</th><th>Group</th><th>km/h</th><th>Pace /km</th><th>% max speed</th>
                    <th>Rep (m)</th>{out.cod ? <th>Shuttle (m)</th> : null}<th>Total (m)</th></tr>
                )}
              </thead>
              <tbody>
                {out.rows.map((r, i) => (mode === 'MAS Group' ? (
                  <tr key={i}><td className="cell-bold">{r.group}</td>{out.basis !== 'MAS' && <td>{r.group_asr ?? '–'}</td>}<td>{r.kmh}</td><td>{r.pace}</td>
                    <td>{r.rep_m}</td>{out.cod ? <td>{r.shuttle_m}</td> : null}<td>{r.total_m}</td><td>{r.players}</td>
                    <td style={{ textAlign: 'left', whiteSpace: 'normal', maxWidth: 420 }}>{r.who || '–'}</td></tr>
                ) : (
                  <tr key={i}><td className="cell-bold">{r.player}</td><td>{r.mas}</td><td>{r.asr ?? '–'}</td><td>{r.group}</td><td>{r.kmh}</td>
                    <td>{r.pace}</td><td>{r.pct_max ?? '–'}</td><td>{r.rep_m}</td>{out.cod ? <td>{r.shuttle_m}</td> : null}<td>{r.total_m}</td></tr>
                )))}
              </tbody>
            </table>
          </div>
          {out.note && <p className="field-hint" style={{ marginTop: 6 }}>{out.note}</p>}
          {mode === 'Player' && out.rows.length > 0 && (
            <button type="button" className="toggle-btn" style={{ marginTop: 10 }} onClick={downloadCsv}>Download this table (CSV)</button>
          )}
        </>
      )}

      {base && (
        <details className="tw-fold" style={{ marginTop: 16 }} open={base.runners.length === 0}>
          <summary><span className="tw-fold-title">Time trials</span><span className="tw-fold-count">{base.runners.length} players with a MAS</span></summary>
          <p className="tw-fold-note">
            Each player's 2 km time trial (e.g. 7:05). MAS = 2000 m ÷ time. If the conditioning workbook is added, its times are used
            too; a time entered here wins for that player.
          </p>
          <div className="summary-table-wrap">
            <table className="summary-table rh-edit">
              <thead><tr><th>Player</th><th>2 km time (m:ss)</th><th>Date</th><th>MAS (m/s)</th><th /></tr></thead>
              <tbody>
                {tts.map((r, i) => {
                  const m = /^(\d+):(\d+(\.\d+)?)$/.exec(String(r.tt_2k).trim())
                  const secs = m ? Number(m[1]) * 60 + Number(m[2]) : Number(r.tt_2k)
                  return (
                    <tr key={i}>
                      <td>
                        <select className="config-select" value={r.player} onChange={(e) => setTts((x) => x.map((y, j) => (j === i ? { ...y, player: e.target.value } : y)))}>
                          <option value="">Choose…</option>
                          {[...new Set([...base.players, r.player].filter(Boolean))].sort().map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </td>
                      <td><input className="config-select" value={r.tt_2k} placeholder="7:05" onChange={(e) => setTts((x) => x.map((y, j) => (j === i ? { ...y, tt_2k: e.target.value } : y)))} /></td>
                      <td><input type="date" className="config-select" value={r.date} onChange={(e) => setTts((x) => x.map((y, j) => (j === i ? { ...y, date: e.target.value } : y)))} /></td>
                      <td>{secs > 0 ? (2000 / secs).toFixed(2) : '–'}</td>
                      <td><button type="button" className="select-link" onClick={() => setTts((x) => x.filter((_, j) => j !== i))}>Remove</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '10px 0 14px' }}>
            <button type="button" className="toggle-btn" onClick={() => setTts((x) => [...x, { player: '', tt_2k: '', date: '' }])}>+ Add time trial</button>
            <button type="button" className="toggle-btn active" onClick={saveTT}>Save time trials</button>
            {saved && <span className="field-hint">{saved}</span>}
          </div>
        </details>
      )}

      <div className="tw-notes" style={{ marginTop: 12 }}>
        <p><strong>Change of direction</strong> costs 0.7 m per m/s of MAS, as in the shuttle sheet.</p>
        <p><strong>MAS</strong> = 2000 m ÷ 2 km time trial. <strong>ASR</strong> = max speed − MAS (tested max from Speed Exposure). Players without a tested max are left out of ASR and max-speed sessions.</p>
      </div>
    </div>
  )
}
