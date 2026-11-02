import { useState } from 'react'
import { calculate, createProfile, scorecard, definitionFor } from './model'
import type { Profile, Rating } from './model'
import { useProfiles } from './useProfiles'
import BackupPanel from './BackupPanel'
import CustomizationEditor from './CustomizationEditor'
import './App.css'

function App() {
  const store = useProfiles()
  const profile = store.profile
  const [message, setMessage] = useState('')
  const [copyText, setCopyText] = useState('')
  const [busy, setBusy] = useState(false)
  if (!store.ready || !profile) return <main><h1>Dating compatibility</h1><p role={store.loadError ? 'alert' : 'status'}>{store.loadError || 'Loading saved profiles…'}</p>{store.loadError && <button onClick={store.retryLoad}>Retry loading</button>}</main>
  const result = calculate(profile)
  const template = definitionFor(profile)
  const checklist = template.checklist
  const answer = profile.checklists[checklist.id] ?? { assessed: false, checkedIds: [] }
  function update(changes: Partial<Profile>) {
    if (!profile) return
    store.change({ ...profile, ...changes, updatedAt: new Date().toISOString() })
    setMessage('')
    setCopyText('')
  }
  async function copy() {
    if (!profile) return
    const text = scorecard(profile)
    try { await navigator.clipboard.writeText(text); setMessage('Scorecard copied.'); setCopyText('') }
    catch { setCopyText(text); setMessage('Select and copy the scorecard below.') }
  }
  return (
    <main aria-busy={busy}>
      <header><span className="eyebrow">A little clarity, at your pace</span><h1>Dating compatibility</h1><p>Notice what connects you. Leave room for what you don’t know yet.</p></header>
      <fieldset className="calculator-controls" disabled={busy}>
      <section className="card" aria-label="Profiles">
        <label className="field-label" htmlFor="profile-select">Your profiles</label>
        <div className="profile-tools">
          <select id="profile-select" value={profile.id} onChange={(event) => { store.select(event.target.value); setMessage(''); setCopyText('') }}>
            {store.profiles.map((item, index) => <option key={item.id} value={item.id}>{item.name.trim() || `Unnamed profile ${index + 1}`}</option>)}
          </select>
          <button onClick={() => { store.add(); setMessage('New profile created.'); setCopyText('') }}>New profile</button>
          <button className="secondary" onClick={() => { if (window.confirm(`Delete ${profile.name.trim() || 'this profile'} and its saved answers?`)) { store.remove(); setMessage('Profile deleted.'); setCopyText('') } }}>Delete profile</button>
        </div>
        <p className="hint" role="status">{store.saveStatus}</p>
        {store.saveFailed && <button className="secondary" onClick={store.retrySave}>Retry saving</button>}
        <p className="hint">Edit “Their name” below to rename a profile. Use one calculator tab at a time.</p>
        <p className="hint">This profile uses {template.name || 'Original scoring system'} · version {template.version}. New profiles use {store.defaultDefinition.name || 'Original scoring system'} · version {store.defaultDefinition.version}.</p>
      </section>
      <section className="summary" aria-label="Score summary">
        <div><span className="metric-label">Compatibility</span><strong>{result.score === null ? '—' : `${result.score.toFixed(1)}%`}</strong><span>{result.score === null ? 'Start with what you know' : `${result.earned.toFixed(2)} of ${result.assessed} assessed points`}</span></div>
        <div><span className="metric-label">Coverage</span><strong>{result.coverage.toFixed(0)}%</strong><progress value={result.coverage} max="100" aria-label="Assessment coverage" /><span>{result.assessed} of {result.total} possible points assessed</span></div>
      </section>
      <section className="card"><label className="field-label" htmlFor="name">Their name</label><input id="name" value={profile.name} onChange={(event) => update({ name: event.target.value })} placeholder="Who are you getting to know?" />
        <p className="hint">Rate each category from 0 (no alignment) to 5 (strong alignment). Unknown is excluded; zero counts. A high score with low coverage is still an early picture.</p>
      </section>
      {template.groups.map((group, index) => <section className="card" key={group.id} aria-labelledby={group.id}>
        <div className="section-heading"><div><span className="eyebrow">{String(index + 1).padStart(2, '0')}</span><h2 id={group.id}>{group.label}</h2></div><span className="weight">{group.categories.reduce((sum, category) => sum + category.weight, 0)} points</span></div>
        {group.categories.map((category) => <div className="rating-row" key={category.id}>
          <label htmlFor={category.id}>{category.label}<span>{category.weight} points</span>{category.description && <span className="criterion-description">{category.description}</span>}</label>
          <div className="rating-control">
            <div className="rating-meta">
              <output htmlFor={category.id}>{profile.ratings[category.id] == null ? 'Unknown' : `${profile.ratings[category.id]} / 5`}</output>
              <label className="unknown-toggle"><input type="checkbox" checked={profile.ratings[category.id] == null} onChange={(event) => update({ ratings: { ...profile.ratings, [category.id]: event.target.checked ? null : 0 } })} aria-label={`${category.label}: Unknown`} />Unknown</label>
            </div>
            <input type="range" id={category.id} min="0" max="5" step="1" disabled={profile.ratings[category.id] == null} value={profile.ratings[category.id] ?? 0} onChange={(event) => update({ ratings: { ...profile.ratings, [category.id]: Number(event.target.value) as Rating } })} />
            <div className="range-labels" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((rating) => <span key={rating}>{rating}</span>)}</div>
          </div>
        </div>)}
      </section>)}
      <section className="card" aria-labelledby="additional"><div className="section-heading"><div><span className="eyebrow">{String(template.groups.length + 1).padStart(2, '0')}</span><h2 id="additional">{checklist.label}</h2></div><span className="weight">{checklist.weight} points</span></div>
        <label className="assessed"><input type="checkbox" checked={answer.assessed} onChange={(event) => update({ checklists: { ...profile.checklists, [checklist.id]: { ...answer, assessed: event.target.checked } } })} />I’ve assessed these shared interests</label>
        <p className="hint">Mark assessed to include this section. No checks then means 0 points. All {checklist.items.length} means {checklist.weight} points.</p>
        <fieldset disabled={!answer.assessed}><legend className="sr-only">Shared interests checklist</legend><div className="checklist">{checklist.items.map((item) => <label key={item.id}><input type="checkbox" checked={answer.checkedIds.includes(item.id)} onChange={(event) => update({ checklists: { ...profile.checklists, [checklist.id]: { ...answer, checkedIds: event.target.checked ? [...answer.checkedIds, item.id] : answer.checkedIds.filter((id) => id !== item.id) } } })} />{item.label}</label>)}</div></fieldset>
        <p className="hint">{answer.assessed ? `${answer.checkedIds.length} of ${checklist.items.length} shared · ${(answer.checkedIds.length / checklist.items.length * checklist.weight).toFixed(2)} / ${checklist.weight} points` : 'Unknown · excluded from score and coverage'}</p>
      </section>
      <section className="card"><label className="field-label" htmlFor="notes">Notes & reflections</label><textarea id="notes" rows={5} value={profile.notes} onChange={(event) => update({ notes: event.target.value })} placeholder="What felt good? What would you like to learn more about?" /></section>
      <div className="actions"><button onClick={copy}>Copy scorecard</button><button className="secondary" onClick={() => { if (window.confirm('Clear this profile’s name, ratings, checklist, and notes? This also updates the saved profile.')) { store.change({ ...createProfile(template), id: profile.id, createdAt: profile.createdAt }); setMessage('Scorecard cleared.'); setCopyText('') } }}>Clear</button></div>
      <p role="status">{message}</p>
      {copyText && <label className="field-label">Scorecard to copy<textarea readOnly rows={12} value={copyText} onFocus={(event) => event.target.select()} /></label>}
      <details className="backup-disclosure">
        <summary>Backup &amp; restore</summary>
        <BackupPanel profiles={store.profiles} templates={store.templates} defaultDefinition={store.defaultDefinition} restore={store.restore} setBusy={setBusy} onRestored={() => { setMessage(''); setCopyText('') }} />
      </details>
      <CustomizationEditor templates={store.templates} current={store.defaultDefinition} save={store.setDefault} setBusy={setBusy} />
      </fieldset>
      <footer>Profiles are saved on this device in this browser, at this site address. Keep exported Excel backups somewhere safe. Clearing browser site data removes local profiles and the recovery copy. Wait for “Saved in this browser” before closing.</footer>
    </main>
  )
}
export default App
