import React, { useState } from 'react'
import AverageBuilder from './AverageBuilder.jsx'

const SUB_TABS = [
  { key: 'training', label: 'Training Average' },
  { key: 'match', label: 'Match Average' },
]

// Both builders stay mounted at all times (just hidden via CSS when their
// sub-tab isn't active) so the Training/Match averages are ready for the
// Reporting tab's comparison feature as soon as data is fetched, without
// requiring a visit to this tab first.
export default function AveragesTab({
  activities,
  rows,
  onTrainingComputed,
  onMatchComputed,
  defaultTrainingTags,
  defaultTrainingPeriods,
  defaultMatchTags,
  defaultMatchPeriods,
}) {
  const [subTab, setSubTab] = useState('training')

  return (
    <div>
      <div className="tab-bar" style={{ marginBottom: 20 }}>
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tab-btn ${subTab === t.key ? 'active' : ''}`}
            onClick={() => setSubTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ display: subTab === 'training' ? 'block' : 'none' }}>
        <AverageBuilder
          activities={activities}
          rows={rows}
          label="Training"
          defaultTags={defaultTrainingTags}
          defaultPeriods={defaultTrainingPeriods}
          onComputed={onTrainingComputed}
        />
      </div>
      <div style={{ display: subTab === 'match' ? 'block' : 'none' }}>
        <AverageBuilder
          activities={activities}
          rows={rows}
          label="Match"
          defaultTags={defaultMatchTags}
          defaultPeriods={defaultMatchPeriods}
          onComputed={onMatchComputed}
        />
      </div>
    </div>
  )
}
