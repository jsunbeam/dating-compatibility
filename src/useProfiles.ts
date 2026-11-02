import { useEffect, useRef, useState } from 'react'
import { createProfile, template } from './model'
import type { Profile, ScorecardTemplate, BackupData } from './model'
import { loadProfiles, writeProfile, restoreProfiles, loadSystems, saveDefaultDefinition } from './storage'
import type { Write, RestoreMode } from './storage'

export function useProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [templates, setTemplates] = useState<ScorecardTemplate[]>([template])
  const [defaultDefinition, setDefaultDefinition] = useState(template)
  const [activeId, setActiveId] = useState('')
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saveStatus, setSaveStatus] = useState('Loading saved profiles…')
  const [saveFailed, setSaveFailed] = useState(false)
  const queue = useRef<Write[]>([])
  const writing = useRef<Promise<boolean> | null>(null)
  const failed = useRef(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [saved, systems] = await Promise.all([loadProfiles(), loadSystems()])
        if (cancelled) return
        const initial = saved.length ? saved : [createProfile(systems.defaultDefinition)]
        setTemplates(systems.templates)
        setDefaultDefinition(systems.defaultDefinition)
        setProfiles(initial)
        setActiveId(initial[0].id)
        setSaveStatus(saved.length ? 'Saved in this browser' : 'Ready · changes save automatically')
        setLoadError('')
        setReady(true)
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not open local storage.')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [attempt])

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (queue.current.length) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  function flush(): Promise<boolean> {
    if (writing.current) return writing.current
    setSaveFailed(false)
    setSaveStatus('Saving…')
    const task = async () => {
      try {
        while (queue.current.length) {
          await writeProfile(queue.current[0])
          queue.current.shift()
        }
        failed.current = false
        setSaveStatus('Saved in this browser')
        return true
      } catch {
        failed.current = true
        setSaveFailed(true)
        setSaveStatus('Not saved. Keep this page open and retry, or export an Excel backup.')
        return false
      }
    }
    writing.current = task()
    // Even an empty queue must release the promise after the task returns.
    void writing.current.then(() => { writing.current = null })
    return writing.current
  }
  async function restore(incoming: BackupData, mode: RestoreMode) {
    if (!await flush()) throw new Error('Save pending changes before restoring. Use Retry saving first.')
    // Persist the initial blank profile so the recovery copy includes it too.
    for (const profile of profiles) await writeProfile({ type: 'put', profile })
    const restored = await restoreProfiles(incoming, mode)
    const systems = await loadSystems()
    setTemplates(systems.templates)
    setDefaultDefinition(systems.defaultDefinition)
    setProfiles(restored)
    setActiveId(restored[0].id)
    setSaveStatus('Saved in this browser')
  }
  function enqueue(write: Write) {
    queue.current.push(write)
    if (!failed.current) void flush()
  }
  function change(profile: Profile) {
    setProfiles((current) => current.map((item) => item.id === profile.id ? profile : item))
    enqueue({ type: 'put', profile })
  }
  function add() {
    // Preserve the initial blank profile too, even before its first edit.
    const current = profiles.find((item) => item.id === activeId)
    if (current) enqueue({ type: 'put', profile: current })
    const profile = createProfile(defaultDefinition)
    setProfiles((current) => [...current, profile])
    setActiveId(profile.id)
    enqueue({ type: 'put', profile })
  }
  function remove() {
    const remaining = profiles.filter((item) => item.id !== activeId)
    enqueue({ type: 'delete', id: activeId })
    if (!remaining.length) {
      const replacement = createProfile(defaultDefinition)
      remaining.push(replacement)
      enqueue({ type: 'put', profile: replacement })
    }
    setProfiles(remaining)
    setActiveId(remaining[0].id)
  }
  async function setDefault(definition: ScorecardTemplate) {
    await saveDefaultDefinition(definition)
    const systems = await loadSystems()
    setTemplates(systems.templates)
    setDefaultDefinition(systems.defaultDefinition)
  }
  return { profiles, templates, defaultDefinition, setDefault, profile: profiles.find((item) => item.id === activeId), ready, loadError,
    saveStatus, saveFailed, change, add, remove, restore, select: setActiveId,
    retrySave: () => void flush(), retryLoad: () => setAttempt((value) => value + 1) }
}
