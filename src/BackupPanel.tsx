import { useRef, useState } from 'react'
import { calculate } from './model'
import type { Profile, ScorecardTemplate, BackupData } from './model'
import { downloadBackup, exportBackup, importBackup } from './backup'
import { loadRecovery } from './storage'
import type { RestoreMode } from './storage'

interface Props {
  profiles: Profile[]
  templates: ScorecardTemplate[]
  defaultDefinition: ScorecardTemplate
  restore: (backup: BackupData, mode: RestoreMode) => Promise<void>
  setBusy: (value: boolean) => void
  onRestored: () => void
}
export default function BackupPanel({ profiles, templates, defaultDefinition, restore, setBusy, onRestored }: Props) {
  const [bundle, setBundle] = useState<BackupData | null>(null)
  const preview = bundle?.profiles ?? null
  const [source, setSource] = useState('')
  const [mode, setMode] = useState<RestoreMode>('merge')
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  const lock = useRef(false)
  async function run(action: () => Promise<void>) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(false)
    setMessage('Working…')
    try { await action() }
    catch (error) { setError(true); setMessage(error instanceof Error ? error.message : 'The operation failed. Your current profiles have not been replaced.') }
    finally { setBusy(false); lock.current = false }
  }
  const conflicts = preview?.filter((incoming) => profiles.some((p) => p.id === incoming.id)).length ?? 0
  return <section className="card" aria-labelledby="backup-heading">
    <h2 id="backup-heading">Backup & restore</h2>
    <p className="hint">Save all profiles to an Excel file, or bring back a backup. Files are processed on this device.</p>
    <div className="backup-actions">
      <button className="secondary" onClick={() => void run(async () => { downloadBackup(await exportBackup(profiles, templates, defaultDefinition)); setMessage(`Excel backup download requested for ${profiles.length} profile(s), including saved scoring systems. Check your Downloads.`) })}>Export Excel backup</button>
      <label className="file-picker">Restore Excel backup<input type="file" accept=".xlsx" onChange={(event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        setBundle(null)
        void run(async () => {
          if (!file.name.toLowerCase().endsWith('.xlsx') || file.size > 5_000_000) throw new Error('Choose an .xlsx app backup smaller than 5 MB.')
          const incoming = await importBackup(await file.arrayBuffer())
          setBundle(incoming); setSource(file.name); setMode('merge'); setMessage('Backup validated. Review below before restoring.')
        })
      }} /></label>
      <button className="secondary" onClick={() => { setBundle(null); void run(async () => {
        const recovery = await loadRecovery()
        if (!recovery?.profiles.length) throw new Error('No recovery copy is available yet. One is kept automatically when you restore a backup.')
        setBundle(recovery); setSource('Local recovery copy from before the last restore'); setMode('replace'); setMessage('Recovery copy loaded. Review below before restoring.')
      }) }}>Review recovery copy</button>
    </div>
    <p role={error ? 'alert' : 'status'} className={error ? 'backup-error' : 'hint'}>{message}</p>
    {preview && <div className="restore-preview">
      <h3>Review: {source}</h3>
      <p>{preview.length} profile(s) in backup. {conflicts} match existing profile IDs.</p>
      <p className="hint">Includes {bundle?.templates.length} scoring-system version(s). New profiles will use {bundle?.defaultDefinition.name || 'Original scoring system'} · version {bundle?.defaultDefinition.version} after restoring.</p>
      <fieldset className="restore-options"><legend>How would you like to restore?</legend>
        <label><input type="radio" name="restore-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />Merge: add {preview.length - conflicts}, update {conflicts}, keep other profiles.</label>
        <label><input type="radio" name="restore-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />Replace: replace all {profiles.length} current profile(s) with these {preview.length}.</label>
      </fieldset>
      <p className="hint">Matching uses profile IDs, so profiles with the same name can remain separate. An automatic local recovery copy is kept before applying either option.</p>
      <div className="preview-table"><table><thead><tr><th>Name</th><th>Score</th><th>Coverage</th><th>Merge action</th></tr></thead><tbody>{preview.map((p) => {
        const score = calculate(p)
        return <tr key={p.id}><td>{p.name.trim() || 'Unnamed profile'}</td><td>{score.score === null ? 'Unknown' : `${score.score.toFixed(1)}%`}</td><td>{score.coverage.toFixed(0)}%</td><td>{profiles.some((existing) => existing.id === p.id) ? 'Update' : 'Add'}</td></tr>
      })}</tbody></table></div>
      <div className="backup-actions"><button onClick={() => {
        if (bundle) void run(async () => { await restore(bundle, mode); setBundle(null); onRestored(); setMessage('Restore complete. Profiles and scoring systems are saved in this browser. The previous collection is available under Review recovery copy.') })
      }}>Apply restore</button><button className="secondary" onClick={() => { setBundle(null); setMessage('Restore cancelled. No profiles changed.') }}>Cancel</button></div>
    </div>}
  </section>
}
