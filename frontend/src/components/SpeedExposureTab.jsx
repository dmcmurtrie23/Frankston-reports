import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchSpeedExposure } from '../api.js'
import SyncBar from './SyncBar.jsx'
import { AllClear, Cards, Fold, TONES, Tile, fmtDay } from './ThisWeekTab.jsx'

// "Speed Exposure" — ported from the Frankston Sport Science app. Days since each
// player last hit >=90% of their max velocity (held for at least 0.5 s in the
// 10Hz data, so a GPS blip can't count), plus new top speeds and players who
// still need a max velocity test. Same pulled 10Hz data as the This Week tab.

const STATUS_TONE = { Flag: 'flag', 'Needs max test': 'warn', 'No data': 'none', OK: 'ok' }

export default function SpeedExposureTab({ token, region }) {
  const [asOf, setAsOf] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [sort, setSort] = useState({ key: null, dir: 1 })

  const load = useCallback(async (dt) => {
    setError(null)
    try {
      const out = await fetchSpeedExposure(dt)
      setData(out)
      if (!dt && out.as_of) setAsOf(out.as_of)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const d = data
  const pctTxt = (v) => (v === null || v === undefined ? '–' : `${(v * 100).toFixed(1)}%`)
  const days = d?.rules?.speed_days ?? 10

  const board = useMemo(() => {
    const rows = [...(d?.board || [])]
    if (!sort.key) return rows // server order: attention first
    return rows.sort((a, b) => {
      const x = a[sort.key], y = b[sort.key]
      if (x === y) return 0
      if (x === null || x === undefined) return 1
      if (y === null || y === undefined) return -1
      return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir
    })
  }, [d, sort])
  const sortBy = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'player' ? 1 : -1 }))
  const arrow = (key) => (sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : '')

  return (
    <div className="tw">
      <div className="tw-head">
        <div>
          <div className="tw-title">Speed Exposure</div>
          <div className="tw-sub">
            Days since ≥{Math.round((d?.rules?.speed_pct ?? 0.9) * 100)}% of max velocity · as of{' '}
            {fmtDay(d?.as_of, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
          </div>
        </div>
        <input
          type="date"
          className="config-select"
          value={asOf}
          onChange={(e) => { setAsOf(e.target.value); load(e.target.value || undefined) }}
          style={{ backgroundImage: 'none' }}
        />
      </div>

      <SyncBar token={token} region={region} onDone={() => load(asOf || undefined)} />
      {error && <div className="tw-error">{error}</div>}

      {d?.empty && (
        <div className="tw-clear" style={{ marginTop: 12 }}>
          No 10Hz data yet. Press <strong>Pull from Catapult now</strong> (this page uses the same pull as This Week).
        </div>
      )}

      {d && !d.empty && (
        <>
          <div className="tw-tiles">
            <Tile label="Flag" value={d.tiles.Flag} sub={`over ${days} days with a unit on`} tone="flag" />
            <Tile label="Needs max test" value={d.tiles['Needs max test']} unit="" sub="no registered max" tone="warn" />
            <Tile label="No data" value={d.tiles['No data']} unit="" sub="no unit lately" tone="none" />
            <Tile label="OK" value={d.tiles.OK} unit="" sub={`hit ≥90% in the last ${days} days`} tone="ok" />
          </div>

          {d.missing_uploads?.length > 0 && (
            <div className="tw-error">Some scheduled sessions have no GPS data yet ({d.missing_uploads.map((x) => fmtDay(x)).join(', ')}).</div>
          )}

          {d.new_max.length > 0 && (
            <Fold title="New top speeds" count={d.new_max.length}
              note="Faster than their stored max, held for the minimum time. Update their max velocity." open>
              <Cards items={d.new_max} />
            </Fold>
          )}

          <Fold
            title="Needs a speed exposure"
            count={d.flagged.length || 'none'}
            note={`Wore a unit but hasn't reached 90% of max in over ${days} days. Longest first.`}
            open={d.flagged.length > 0}
          >
            {d.flagged.length === 0
              ? <AllClear>Everyone with a unit on has hit 90% in the last {days} days.</AllClear>
              : <Cards items={d.flagged} />}
          </Fold>

          {d.tests.length > 0 && (
            <Fold title="Needs a max velocity test" count={d.tests.length}
              note="No registered max, so % of max can't be trusted yet.">
              <Cards items={d.tests} />
            </Fold>
          )}

          <Fold title="All players" count={`${d.board.length} players`} note="The whole squad, with those needing attention first. Click a heading to sort.">
            <div className="summary-table-wrap">
              <table className="summary-table">
                <thead>
                  <tr>
                    <th className="sortable-th" onClick={() => sortBy('player')}>Player{arrow('player')}</th>
                    <th className="sortable-th" onClick={() => sortBy('status')}>Status{arrow('status')}</th>
                    <th className="sortable-th" onClick={() => sortBy('days_since_90')}>Days since ≥90%{arrow('days_since_90')}</th>
                    <th className="sortable-th" onClick={() => sortBy('last_90_date')}>Last ≥90%{arrow('last_90_date')}</th>
                    <th className="sortable-th" onClick={() => sortBy('best_recent_pct')}>Best % (last {days}d){arrow('best_recent_pct')}</th>
                    <th>Units worn</th>
                    <th className="sortable-th" onClick={() => sortBy('max_kmh')}>Max (km/h){arrow('max_kmh')}</th>
                  </tr>
                </thead>
                <tbody>
                  {board.map((r) => (
                    <tr key={r.player}>
                      <td className="cell-bold">{r.player}</td>
                      <td>
                        <span className="tw-status" style={{ '--c': TONES[STATUS_TONE[r.status]] || TONES.none }}>{r.status}</span>
                      </td>
                      <td>{r.days_since_90 ?? '–'}</td>
                      <td>{r.last_90_date ? fmtDay(r.last_90_date) : '–'}</td>
                      <td>{pctTxt(r.best_recent_pct)}</td>
                      <td>{r.units}</td>
                      <td>{r.max_kmh === null || r.max_kmh === undefined ? '–' : r.max_kmh.toFixed(2)}{r.provisional ? ' *' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {board.some((r) => r.provisional) && <p className="field-hint" style={{ marginTop: 6 }}>* fastest recorded speed (not a tested max)</p>}
          </Fold>

          <div className="tw-notes">
            <p><strong>Source:</strong> {d.source}</p>
            <p>
              <strong>No data</strong> means no unit worn lately (or no GPS lock), so we can't say they missed out.{' '}
              <strong>Max velocity</strong> comes from an override, OpenField's stored max, the conditioning workbook (if added),
              or else their fastest recorded speed.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
