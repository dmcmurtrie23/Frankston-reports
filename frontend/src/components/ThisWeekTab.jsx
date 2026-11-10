import React, { useCallback, useEffect, useState } from 'react'
import { fetchThisWeek } from '../api.js'
import SyncBar from './SyncBar.jsx'
import { Avatar } from '../photos.jsx'

// "This Week" — ported from the Frankston Sport Science app. What to act on:
// load spikes / under-loading last week, this week so far vs each player's usual
// week, players returning from time out, and who's due a speed exposure.
// Runs on Catapult 10Hz data pulled into Frankston_Reports/sport_science_data/.

export const TONES = { flag: '#ff5147', warn: '#f2b33d', ok: '#4fc483', red: '#E31B23', none: '#8a8a90' }

export const fmtDay = (iso, opts = { weekday: 'short', day: '2-digit', month: 'short' }) => {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-AU', { ...opts, timeZone: 'UTC' })
}
export const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`)
const signedPct = (v) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`)

export function Tile({ label, value, sub, tone, unit = 'players' }) {
  return (
    <div className="tw-tile" style={{ '--c': tone ? TONES[tone] : 'var(--cat-border-md)' }}>
      <div className="tw-tile-label">{label}</div>
      <div className={`tw-tile-value${typeof value === 'string' && Number.isNaN(Number(value.replace(/,/g, ''))) && value !== '–' ? ' txt' : ''}`}>{value}{unit && <span> {unit}</span>}</div>
      {sub && <div className="tw-tile-sub">{sub}</div>}
    </div>
  )
}

export function Cards({ items }) {
  return (
    <div className="tw-cards">
      {items.map((c, i) => (
        <div key={`${c.who}-${i}`} className="tw-card" style={{ '--c': TONES[c.tone] || TONES.none }}>
          <div className="tw-card-top">
            <div className="who-wrap"><Avatar name={c.who} size={34} /><div className="tw-who">{c.who}</div></div>
            {c.num !== null && c.num !== undefined ? (
              <div className="tw-num">{c.num}<span> {c.unit}</span></div>
            ) : c.pill ? (
              <span className="tw-pill">{c.pill}</span>
            ) : null}
          </div>
          {c.num !== null && c.num !== undefined && c.pill && <span className="tw-pill" style={{ marginBottom: 6 }}>{c.pill}</span>}
          {c.meta && <div className="tw-meta">{c.meta}</div>}
          {c.act && <div className="tw-act">{c.act}</div>}
        </div>
      ))}
    </div>
  )
}

export function AllClear({ children }) {
  return <div className="tw-clear">{children}</div>
}

export function Fold({ title, count, note, open, children }) {
  return (
    <details className="tw-fold" open={open}>
      <summary>
        <span className="tw-fold-title">{title}</span>
        <span className="tw-fold-count">{count}</span>
      </summary>
      {note && <p className="tw-fold-note">{note}</p>}
      <div>{children}</div>
    </details>
  )
}

function PctBar({ v }) {
  if (v === null || v === undefined) return <span className="field-hint">—</span>
  const w = Math.max(0, Math.min(150, v * 100)) / 1.5
  const tone = v > 1.2 ? TONES.flag : v < 0.5 ? TONES.warn : '#9a9a9a'
  return (
    <div className="tw-pctbar">
      <div style={{ width: `${w}%`, background: tone }} />
      <span>{pct(v)}</span>
    </div>
  )
}

export default function ThisWeekTab({ token, region }) {
  const [asOf, setAsOf] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [sortKey, setSortKey] = useState('hsr_m')

  const load = useCallback(async (d) => {
    setLoading(true)
    setError(null)
    try {
      const out = await fetchThisWeek(d)
      setData(out)
      if (!d && out.as_of) setAsOf(out.as_of)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const d = data
  const metrics = d?.metrics || {}
  const rows = [...(d?.so_far?.rows || [])].sort((a, b) =>
    sortKey === 'player' ? a.player.localeCompare(b.player) : (b[sortKey] ?? -1) - (a[sortKey] ?? -1)
  )
  const asOfDay = asOf ? new Date(`${asOf}T00:00:00Z`).getUTCDay() : 1
  const early = asOfDay >= 1 && asOfDay <= 4

  return (
    <div className="tw">
      <div className="tw-head">
        <div>
          <div className="tw-title">This Week</div>
          <div className="tw-sub">
            What to act on · week of {fmtDay(d?.this_mon)} · as of {fmtDay(d?.as_of)}
          </div>
        </div>
        <div className="tw-head-right">
          <input
            type="date"
            className="config-select"
            value={asOf}
            onChange={(e) => { setAsOf(e.target.value); load(e.target.value || undefined) }}
            style={{ backgroundImage: 'none' }}
          />
        </div>
      </div>

      <SyncBar
        token={token}
        region={region}
        onDone={() => load(asOf || undefined)}
        extra={d && !d.empty ? `${d.sessions_pulled} sessions · ${d.players} players · data to ${fmtDay(d.data_through)}` : null}
      />
      {error && <div className="tw-error">{error}</div>}
      {loading && !d && <p className="field-hint">Loading…</p>}

      {d?.empty && (
        <div className="tw-clear" style={{ marginTop: 12 }}>
          No 10Hz data yet. Press <strong>Pull from Catapult now</strong>. The first pull downloads every player's
          10Hz trace for every session since 1 March, so it can take a while (it keeps going if you switch tabs, and
          picks up where it left off if it's interrupted). After that, each pull only fetches new sessions.
        </div>
      )}

      {d && !d.empty && (
        <>
          <div className="tw-tiles">
            <Tile label="Load spikes" value={d.tiles.spikes} sub={`week of ${fmtDay(d.last_mon, { day: '2-digit', month: 'short' })}`} tone="flag" />
            <Tile label="Under-loaded" value={d.tiles.drops} sub={`week of ${fmtDay(d.last_mon, { day: '2-digit', month: 'short' })}`} tone="warn" />
            <Tile label="Speed exposure due" value={d.tiles.due} sub={`none ≥90% in ${d.rules.speed_days}+ days`} tone="red" />
            <Tile label="In rehab" value={d.tiles.rehab} sub="from the rehab list" />
          </div>

          <Fold
            title={`Load spikes · week of ${fmtDay(d.last_mon, { day: '2-digit', month: 'short' })}`}
            count={d.spikes.length || 'none'}
            note="Well above their usual week, and well beyond what the squad did. Talk to them before loading them up again."
            open={d.spikes.length > 0}
          >
            {d.has_last && (
              <p className="field-hint" style={{ marginBottom: 10 }}>
                Squad that week vs usual: {d.squad_change.map((c) => `${c.label} ${signedPct(c.pct)}`).join(' · ')} ({d.team_sessions_last} sessions).
              </p>
            )}
            {!d.has_last ? <AllClear>No GPS data for that week.</AllClear>
              : d.spikes.length === 0 ? <AllClear>No big jumps last week.</AllClear>
              : <Cards items={d.spikes} />}
          </Fold>

          <Fold
            title={`Under-loaded · week of ${fmtDay(d.last_mon, { day: '2-digit', month: 'short' })}`}
            count={d.drops.length || 'none'}
            note="Well below their usual week, despite wearing a unit at every session."
            open={d.drops.length > 0}
          >
            {d.drops.length === 0 ? <AllClear>Nobody dropped well below their usual week.</AllClear> : <Cards items={d.drops} />}
          </Fold>

          <Fold
            title={`This week so far · week of ${fmtDay(d.this_mon, { day: '2-digit', month: 'short' })}`}
            count={rows.length ? `${rows.length} players with sessions` : 'no sessions yet'}
            note={`Each player's week so far as a % of their usual week. Under ${pct(d.rules.top_up)} needs a top-up; over ${pct(d.rules.hold)} means hold back.`}
            open={rows.length > 0 && early}
          >
            {rows.length === 0 ? (
              <AllClear>No sessions yet this week.</AllClear>
            ) : (
              <>
                {d.so_far.late_week ? (
                  <p className="field-hint" style={{ marginBottom: 10 }}>
                    The week's mostly done, so no top-up or hold-back calls. Next week's spikes show here on Monday.
                  </p>
                ) : d.so_far.cards.length > 0 ? (
                  <Cards items={d.so_far.cards} />
                ) : null}
                <div className="summary-table-wrap" style={{ marginTop: 12 }}>
                  <table className="summary-table">
                    <thead>
                      <tr>
                        <th className="sortable-th" onClick={() => setSortKey('player')}>Player</th>
                        <th>Sessions</th>
                        {Object.entries(metrics).map(([k, label]) => (
                          <th key={k} className="sortable-th" onClick={() => setSortKey(k)}>
                            {label} %{sortKey === k ? ' ▼' : ''}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.player}>
                          <td className="cell-bold"><span className="tw-player-cell"><Avatar name={r.player} size={26} />{r.player}</span></td>
                          <td>{r.sessions}/{d.so_far.team_sessions}</td>
                          {Object.keys(metrics).map((k) => <td key={k}><PctBar v={r[k]} /></td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Fold>

          <Fold
            title="Returning from time out"
            count={d.returning.length || 'none'}
            note={`First ${d.rules.return_watch_weeks} weeks back after ${d.rules.return_gap_weeks}+ weeks without a unit, and rehab players close to returning. Compared with their usual week from before the time out.`}
            open={d.returning.length > 0}
          >
            {d.returning.length === 0 ? <AllClear>Nobody coming back from time out this week.</AllClear> : <Cards items={d.returning} />}
          </Fold>

          <Fold
            title="Speed exposure due"
            count={d.speed_due.length || 'none'}
            note={`No ≥${pct(d.rules.speed_pct)} of max in over ${d.rules.speed_days} days.`}
            open={d.speed_due.length > 0}
          >
            {d.speed_due.length === 0 ? <AllClear>Everyone with a unit on has hit 90% recently.</AllClear> : <Cards items={d.speed_due} />}
          </Fold>

          <div className="tw-notes">
            <p><strong>Usual week:</strong> each player's average over their last 4 weeks where they did every session. Weeks run Monday to Sunday.</p>
            <p>
              <strong>Spike / drop:</strong> one metric {d.rules.z_one}+ SD from their usual, or two metrics {d.rules.z_two}+ SD;
              a real change (e.g. {d.rules.min_change.hsr_m} m of HSR, {d.rules.min_change.sprint_m} m of sprint, {d.rules.min_change.accels} accels);
              and at least {pct(d.rules.beyond_team)} beyond what the squad did. Drops only count if they wore a unit at every session.
            </p>
            <p>
              <strong>Metrics:</strong> HSR &gt; 19.8 km/h, sprint &gt; 25.2 km/h, metres &gt; 80% of their own max, accels/decels beyond ±3 m/s².
              From Catapult 10Hz, whole session.
              {d.building.length > 0 && <> <strong>Still building a baseline:</strong> {d.building.join(', ')}.</>}
            </p>
          </div>
        </>
      )}
    </div>
  )
}
