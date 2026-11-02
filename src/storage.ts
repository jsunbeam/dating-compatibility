import { template, definitionFor, validateDefinition } from './model'
import type { Profile, ScorecardTemplate, BackupData } from './model'

let connection: Promise<IDBDatabase> | undefined
function openDatabase() {
  if (!connection) connection = new Promise<IDBDatabase>((resolve, reject) => {
    let abandoned = false
    const request = indexedDB.open('dating-compatibility', 3)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('profiles')) db.createObjectStore('profiles', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('templates')) db.createObjectStore('templates', { keyPath: ['id', 'version'] })
      if (!db.objectStoreNames.contains('backups')) db.createObjectStore('backups')
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings')
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => { abandoned = true; reject(new Error('Close other calculator tabs, then retry.')) }
    request.onsuccess = () => {
      const db = request.result
      if (abandoned) { db.close(); return }
      db.onversionchange = () => { db.close(); connection = undefined }
      resolve(db)
    }
  }).catch((error: unknown) => { connection = undefined; throw error })
  return connection
}

// Unknown is null or an absent answer; never coerce it into zero on load.
export function validateProfile(value: unknown): Profile {
  if (!value || typeof value !== 'object') throw new Error('Invalid saved profile.')
  const p = value as Profile
  if (p.schemaVersion !== 1 || (!p.definition && (p.templateId !== template.id || p.templateVersion !== template.version)))
    throw new Error('A saved profile uses an unsupported version. Its data has been left untouched.')
  const definition = validateDefinition(definitionFor(p))
  if (p.templateId !== definition.id || p.templateVersion !== definition.version) throw new Error('Profile scoring-system reference does not match its saved definition.')
  if (typeof p.id !== 'string' || !p.id || typeof p.name !== 'string' || typeof p.notes !== 'string' ||
    typeof p.createdAt !== 'string' || typeof p.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(p.createdAt)) || !Number.isFinite(Date.parse(p.updatedAt)) ||
    !p.ratings || typeof p.ratings !== 'object' || Array.isArray(p.ratings) ||
    !p.checklists || typeof p.checklists !== 'object' || Array.isArray(p.checklists)) throw new Error('Invalid saved profile. Data has been left untouched.')
  for (const rating of Object.values(p.ratings)) {
    if (rating !== null && (!Number.isInteger(rating) || rating < 0 || rating > 5)) throw new Error('Invalid saved rating.')
  }
  for (const answer of Object.values(p.checklists)) {
    if (!answer || typeof answer.assessed !== 'boolean' || !Array.isArray(answer.checkedIds) || answer.checkedIds.some((id) => typeof id !== 'string')) throw new Error('Invalid saved checklist.')
  }
  return p
}

export async function loadProfiles(): Promise<Profile[]> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('profiles', 'readonly')
    const request = transaction.objectStore('profiles').getAll()
    transaction.oncomplete = () => {
      try { resolve((request.result as unknown[]).map(validateProfile)) } catch (error) { reject(error) }
    }
    transaction.onabort = () => reject(transaction.error ?? new Error('Could not read saved profiles.'))
  })
}

export type Write = { type: 'put'; profile: Profile } | { type: 'delete'; id: string }
export async function writeProfile(write: Write): Promise<void> {
  if (write.type === 'put') validateProfile(write.profile)
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['profiles', 'templates'], 'readwrite')
    if (write.type === 'put') transaction.objectStore('templates').put(definitionFor(write.profile))
    const store = transaction.objectStore('profiles')
    if (write.type === 'put') store.put(write.profile)
    else store.delete(write.id)
    // Success means the whole transaction committed, not just a request succeeded.
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('Could not save your changes.'))
  })
}

export type RestoreMode = 'merge' | 'replace'
export async function restoreProfiles(bundle: BackupData, mode: RestoreMode): Promise<Profile[]> {
  const incoming = bundle.profiles
  incoming.forEach(validateProfile)
  const incomingSystems = checkSystems([...bundle.templates, bundle.defaultDefinition, ...incoming.map(definitionFor)])
  if (!incoming.length || new Set(incoming.map((p) => p.id)).size !== incoming.length) throw new Error('Backup must contain profiles with unique IDs.')
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['profiles', 'templates', 'backups', 'settings'], 'readwrite')
    const store = tx.objectStore('profiles')
    const read = store.getAll()
    const definitions = tx.objectStore('templates').getAll()
    const savedDefault = tx.objectStore('settings').get('default-template')
    let existing: Profile[] | undefined
    let restored: Profile[] = []
    const apply = () => {
      if (read.readyState !== 'done' || definitions.readyState !== 'done' || savedDefault.readyState !== 'done') return
      try {
        existing = (read.result as unknown[]).map(validateProfile)
        const systems = checkSystems([template, ...(definitions.result as unknown[]).map(validateDefinition), ...existing.map(definitionFor)])
        checkSystems([...systems, ...incomingSystems])
        // The recovery copy and restored profiles commit together or not at all.
        tx.objectStore('backups').put({ createdAt: new Date().toISOString(), profiles: existing, templates: systems, defaultDefinition: savedDefault.result ?? template }, 'before-restore')
        const collection = new Map((mode === 'merge' ? existing : []).map((p) => [p.id, p]))
        incoming.forEach((p) => collection.set(p.id, p))
        restored = [...collection.values()]
        store.clear()
        restored.forEach((p) => store.put(p))
        incomingSystems.forEach((d) => tx.objectStore('templates').put(d))
        tx.objectStore('settings').put(bundle.defaultDefinition, 'default-template')
      } catch { tx.abort() }
    }
    read.onsuccess = apply
    definitions.onsuccess = apply
    savedDefault.onsuccess = apply
    tx.oncomplete = () => resolve(restored)
    tx.onabort = () => reject(tx.error ?? new Error('Restore failed. Existing profiles were not changed.'))
  })
}

export async function loadRecovery(): Promise<BackupData | null> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('backups', 'readonly')
    const read = tx.objectStore('backups').get('before-restore')
    tx.oncomplete = () => {
      try {
        const backup = read.result as { profiles: unknown[]; templates?: unknown[]; defaultDefinition?: unknown } | undefined
        resolve(backup ? { profiles: backup.profiles.map(validateProfile), templates: (backup.templates ?? [template]).map(validateDefinition), defaultDefinition: validateDefinition(backup.defaultDefinition ?? template) } : null)
      } catch (error) { reject(error) }
    }
    tx.onabort = () => reject(tx.error ?? new Error('Could not read recovery copy.'))
  })
}

export function checkSystems(definitions: ScorecardTemplate[]): ScorecardTemplate[] {
  const unique = new Map<string, ScorecardTemplate>()
  for (const d of definitions) {
    validateDefinition(d)
    const key = `${d.id}:${d.version}`
    if (unique.has(key) && JSON.stringify(unique.get(key)) !== JSON.stringify(d)) throw new Error('Conflicting versions of a scoring system. Existing data has not been replaced.')
    unique.set(key, d)
  }
  if (unique.size > 100) throw new Error('Up to 100 saved scoring-system versions are supported.')
  return [...unique.values()]
}
export async function loadSystems(): Promise<{ templates: ScorecardTemplate[]; defaultDefinition: ScorecardTemplate }> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['templates', 'settings'], 'readonly')
    const all = tx.objectStore('templates').getAll()
    const selected = tx.objectStore('settings').get('default-template')
    tx.oncomplete = () => {
      try {
        const defaultDefinition = validateDefinition(selected.result ?? template)
        resolve({ templates: checkSystems([template, ...all.result.map(validateDefinition), defaultDefinition]), defaultDefinition })
      } catch (error) { reject(error) }
    }
    tx.onabort = () => reject(tx.error ?? new Error('Could not load scoring systems.'))
  })
}
export async function saveDefaultDefinition(definition: ScorecardTemplate): Promise<void> {
  validateDefinition(definition)
  const saved = await loadSystems()
  checkSystems([...saved.templates, definition])
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['templates', 'settings'], 'readwrite')
    const store = tx.objectStore('templates')
    const read = store.get([definition.id, definition.version])
    read.onsuccess = () => {
      if (read.result && JSON.stringify(read.result) !== JSON.stringify(definition)) { tx.abort(); return }
      store.put(definition)
      tx.objectStore('settings').put(definition, 'default-template')
    }
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('Could not save this scoring system. No existing version was changed.'))
  })
}
