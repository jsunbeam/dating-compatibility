import { useState } from 'react'
import { template, validateDefinition } from './model'
import type { ScorecardTemplate, Group } from './model'

interface Props {
  templates: ScorecardTemplate[]
  current: ScorecardTemplate
  save: (definition: ScorecardTemplate) => Promise<void>
  setBusy: (busy: boolean) => void
}
function move<T>(items: T[], index: number, direction: number): T[] {
  const copy = [...items]
  const next = index + direction
  if (next >= 0 && next < copy.length) [copy[index], copy[next]] = [copy[next], copy[index]]
  return copy
}
export default function CustomizationEditor({ templates, current, save, setBusy }: Props) {
  const [draft, setDraft] = useState<ScorecardTemplate | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  const [saving, setSaving] = useState(false)
  const total = draft?.groups.flatMap((g) => g.categories).reduce((sum, c) => sum + c.weight, draft.checklist.weight) ?? 100
  const count = draft?.groups.flatMap((g) => g.categories).length ?? 0
  function groupChange(index: number, changes: Partial<Group>) {
    if (!draft) return
    setDraft({ ...draft, groups: draft.groups.map((g, i) => i === index ? { ...g, ...changes } : g) })
  }
  async function commit(definition: ScorecardTemplate, editing: boolean) {
    if (saving) return
    setSaving(true); setBusy(true); setError(false); setMessage('Saving scoring system…')
    try {
      validateDefinition(definition)
      await save(definition)
      if (editing) setDraft(null)
      setMessage('Saved in this browser. New profiles will use this system. Existing profiles keep their original system.')
    } catch (error) { setError(true); setMessage(error instanceof Error ? error.message : 'Could not save. Your draft is still here.') }
    finally { setSaving(false); setBusy(false) }
  }
  return <details className="backup-disclosure customization-editor">
    <summary>Customize scoring</summary>
    <section className="card" aria-label="Scoring customization">
      <p>New profiles use <strong>{current.name || 'Original scoring system'} · version {current.version}</strong>.</p>
      <p className="hint">Edit a copy and save a new version. Existing profiles and their scores stay unchanged. Create a new profile to use your saved changes.</p>
      <label className="field-label" htmlFor="default-system">Default system for new profiles</label>
      <select id="default-system" value={`${current.id}:${current.version}`} onChange={(event) => {
        const selected = templates.find((d) => `${d.id}:${d.version}` === event.target.value)
        if (selected) void commit(selected, false)
      }}>{templates.map((d) => <option key={`${d.id}:${d.version}`} value={`${d.id}:${d.version}`}>{d.name || 'Original scoring system'} · version {d.version}</option>)}</select>
      {!draft && <div className="backup-actions"><button className="secondary" onClick={() => { setDraft(structuredClone(current)); setMessage('') }}>Edit a copy</button><button className="secondary" onClick={() => { setDraft(structuredClone(template)); setMessage('') }}>Start from original</button></div>}
      <p role={error ? 'alert' : 'status'}>{message}</p>
      {draft && <div className="editor-draft">
        <label className="field-label">Scoring system name<input maxLength={80} value={draft.name ?? ''} placeholder="My compatibility priorities" onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
        <p className={total === 100 ? 'editor-total' : 'backup-error'} aria-live="polite">Total weight: {Number.isFinite(total) ? total : '—'} / 100 points</p>
        <p className="hint">Use whole-number weights. A weight of 0 keeps a criterion visible without affecting the score. Include 1–40 rated criteria and 1–30 checklist interests.</p>
        {draft.groups.map((group, gi) => <fieldset className="editor-group" key={group.id}>
          <legend>Group {gi + 1}</legend>
          <label>Group name<input maxLength={80} value={group.label} onChange={(e) => groupChange(gi, { label: e.target.value })} /></label>
          <div className="editor-actions"><button className="secondary" disabled={gi === 0} onClick={() => setDraft({ ...draft, groups: move(draft.groups, gi, -1) })}>Move group up</button><button className="secondary" disabled={gi === draft.groups.length - 1} onClick={() => setDraft({ ...draft, groups: move(draft.groups, gi, 1) })}>Move group down</button><button className="secondary" disabled={draft.groups.length === 1} onClick={() => setDraft({ ...draft, groups: draft.groups.filter((_, i) => i !== gi) })}>Remove group</button></div>
          {group.categories.map((c, ci) => <div className="editor-criterion" key={c.id}>
            <label>Criterion name<input maxLength={120} value={c.label} onChange={(e) => groupChange(gi, { categories: group.categories.map((item, i) => i === ci ? { ...item, label: e.target.value } : item) })} /></label>
            <label>Points<input type="number" min={0} max={100} step={1} value={Number.isNaN(c.weight) ? '' : c.weight} onChange={(e) => groupChange(gi, { categories: group.categories.map((item, i) => i === ci ? { ...item, weight: e.target.value === '' ? NaN : Number(e.target.value) } : item) })} /></label>
            <label className="editor-description">Scoring description<textarea rows={2} maxLength={200} value={c.description ?? ''} placeholder="What does alignment look like for you?" onChange={(e) => groupChange(gi, { categories: group.categories.map((item, i) => i === ci ? { ...item, description: e.target.value } : item) })} /></label>
            <div className="editor-actions"><button className="secondary" disabled={ci === 0} aria-label={`Move ${c.label || 'criterion'} up`} onClick={() => groupChange(gi, { categories: move(group.categories, ci, -1) })}>Up</button><button className="secondary" disabled={ci === group.categories.length - 1} aria-label={`Move ${c.label || 'criterion'} down`} onClick={() => groupChange(gi, { categories: move(group.categories, ci, 1) })}>Down</button><button className="secondary" onClick={() => groupChange(gi, { categories: group.categories.filter((_, i) => i !== ci) })}>Remove criterion</button></div>
          </div>)}
          <button className="secondary" disabled={count >= 40} onClick={() => groupChange(gi, { categories: [...group.categories, { id: crypto.randomUUID(), label: '', weight: 0, description: '' }] })}>Add criterion</button>
        </fieldset>)}
        <button className="secondary" disabled={draft.groups.length >= 10} onClick={() => setDraft({ ...draft, groups: [...draft.groups, { id: crypto.randomUUID(), label: '', categories: [] }] })}>Add group</button>
        <fieldset className="editor-group"><legend>Shared-interest checklist</legend>
          <label>Checklist name<input maxLength={120} value={draft.checklist.label} onChange={(e) => setDraft({ ...draft, checklist: { ...draft.checklist, label: e.target.value } })} /></label>
          <label>Checklist points<input type="number" min={0} max={100} step={1} value={Number.isNaN(draft.checklist.weight) ? '' : draft.checklist.weight} onChange={(e) => setDraft({ ...draft, checklist: { ...draft.checklist, weight: e.target.value === '' ? NaN : Number(e.target.value) } })} /></label>
          {draft.checklist.items.map((item, i) => <div className="editor-interest" key={item.id}>
            <label>Interest {i + 1}<input maxLength={80} value={item.label} onChange={(e) => setDraft({ ...draft, checklist: { ...draft.checklist, items: draft.checklist.items.map((entry, j) => j === i ? { ...entry, label: e.target.value } : entry) } })} /></label>
            <div className="editor-actions"><button className="secondary" disabled={i === 0} aria-label={`Move ${item.label || 'interest'} up`} onClick={() => setDraft({ ...draft, checklist: { ...draft.checklist, items: move(draft.checklist.items, i, -1) } })}>Up</button><button className="secondary" disabled={i === draft.checklist.items.length - 1} aria-label={`Move ${item.label || 'interest'} down`} onClick={() => setDraft({ ...draft, checklist: { ...draft.checklist, items: move(draft.checklist.items, i, 1) } })}>Down</button><button className="secondary" disabled={draft.checklist.items.length === 1} onClick={() => setDraft({ ...draft, checklist: { ...draft.checklist, items: draft.checklist.items.filter((_, j) => j !== i) } })}>Remove interest</button></div>
          </div>)}
          <button className="secondary" disabled={draft.checklist.items.length >= 30} onClick={() => setDraft({ ...draft, checklist: { ...draft.checklist, items: [...draft.checklist.items, { id: crypto.randomUUID(), label: '' }] } })}>Add interest</button>
        </fieldset>
        <div className="backup-actions"><button disabled={saving || total !== 100} onClick={() => void commit({ ...structuredClone(draft), id: crypto.randomUUID(), version: draft.version + 1, name: draft.name?.trim() || 'My scoring system' }, true)}>Save new version</button><button className="secondary" onClick={() => { setDraft(null); setMessage('Draft discarded. Saved systems and profiles were not changed.') }}>Discard draft</button></div>
        <p className="hint">Draft edits are saved only when you choose Save new version. Export an Excel backup after saving to keep a separate copy.</p>
      </div>}
    </section>
  </details>
}
