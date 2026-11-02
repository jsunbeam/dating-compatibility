import { calculate, definitionFor, template, validateDefinition } from './model'
import type { Profile, ScorecardTemplate, BackupData, Rating } from './model'
import { checkSystems, validateProfile } from './storage'
import { parseTables as parseLegacy } from './legacyBackup'
import { readXlsx, writeXlsx } from './xlsx'
import type { Scalar, Tables } from './xlsx'
export { downloadBackup } from './legacyBackup'

const profileHeaders = ['Profile ID', 'Name', 'Notes', 'Created at (UTC ISO)', 'Updated at (UTC ISO)', 'Template ID', 'Template version']
const ratingHeaders = ['Profile ID', 'Category ID', 'Category', 'Rating (0–5 or Unknown)', 'Maximum points', 'Weighted points', 'Assessed weight']
const interestHeaders = ['Profile ID', 'Checklist ID', 'Assessed', 'Interest ID', 'Interest', 'Shared', 'Checklist maximum points', 'Checked count', 'Checklist weighted points', 'Assessed weight']
const key = (d: ScorecardTemplate) => `${d.id}:${d.version}`
const title = (d: ScorecardTemplate) => `${d.name || 'Original scoring system'} · v${d.version}`
function checklistResult(p: Profile) {
  const d = definitionFor(p).checklist
  const a = p.checklists[d.id]
  const count = d.items.filter((item) => a?.checkedIds.includes(item.id)).length
  return { assessed: a?.assessed ?? false, count, points: count / d.items.length * d.weight }
}
export function backupTables(profiles: Profile[], templates: ScorecardTemplate[] = [], defaultDefinition = template): Tables {
  if (!profiles.length || profiles.length > 1000 || new Set(profiles.map((p) => p.id)).size !== profiles.length) throw new Error('A backup needs 1–1,000 profiles with unique IDs.')
  profiles.forEach(validateProfile)
  const systems = checkSystems([template, ...templates, ...profiles.map(definitionFor), defaultDefinition])
  if (systems.length > 100) throw new Error('A backup supports up to 100 saved scoring-system versions.')
  const used = systems.filter((d) => profiles.some((p) => key(definitionFor(p)) === key(d)))
  const comparison: Scalar[][] = [
    ['Criterion / metric', 'Scoring system / group', 'Maximum points', ...profiles.map((p, i) => p.name.trim() || `Unnamed profile ${i + 1}`)],
    ['Compatibility score', '', null, ...profiles.map((p) => { const r = calculate(p); return r.score === null ? 'Unknown' : r.score / 100 })],
    ['Coverage', '', null, ...profiles.map((p) => calculate(p).coverage / 100)],
    ['Scoring system', '', null, ...profiles.map((p) => title(definitionFor(p)))],
    ['Earned points', '', 100, ...profiles.map((p) => calculate(p).earned)],
    ['Assessed weight', '', 100, ...profiles.map((p) => calculate(p).assessed)],
  ]
  for (const d of used) {
    for (const g of d.groups) for (const c of g.categories) comparison.push([c.label, `${title(d)} / ${g.label}`, c.weight, ...profiles.map((p) => key(definitionFor(p)) === key(d) ? p.ratings[c.id] ?? 'Unknown' : 'Not in this system')])
    comparison.push([d.checklist.label, title(d), d.checklist.weight, ...profiles.map((p) => { if (key(definitionFor(p)) !== key(d)) return 'Not in this system'; const r = checklistResult(p); return r.assessed ? r.points : 'Unknown' })])
  }
  comparison.push([], ['Reading this comparison', 'Rated criteria are 0–5; checklists show earned points. Different scoring systems are listed separately.'], ['Calculation', 'Compatibility = earned / assessed points. Coverage = assessed / 100. Scores are export-time snapshots.'])
  return {
    'Profile Comparison': comparison,
    Profiles: [profileHeaders, ...profiles.map((p) => [p.id, p.name, p.notes, p.createdAt, p.updatedAt, p.templateId, p.templateVersion])],
    Ratings: [ratingHeaders, ...profiles.flatMap((p) => definitionFor(p).groups.flatMap((g) => g.categories.map((c) => {
      const r = p.ratings[c.id]
      return [p.id, c.id, c.label, r ?? 'Unknown', c.weight, r == null ? null : r / 5 * c.weight, r == null ? 0 : c.weight]
    })))],
    Criteria: [['Template ID', 'Template version', 'Scoring system', 'Criterion ID', 'Criterion', 'Group', 'Maximum points', 'Scoring description', 'Scoring rule'], ...systems.flatMap((d) => [
      ...d.groups.flatMap((g) => g.categories.map((c) => [d.id, d.version, title(d), c.id, c.label, g.label, c.weight, c.description ?? '', '0–5 rating / 5 × maximum points. Unknown excluded; zero assessed.'])),
      [d.id, d.version, title(d), d.checklist.id, d.checklist.label, 'Shared interests', d.checklist.weight, `${d.checklist.items.length} checklist items.`, `If assessed: checked count / ${d.checklist.items.length} × ${d.checklist.weight}. Unassessed excluded.`],
    ])],
    'Shared Interests': [interestHeaders, ...profiles.flatMap((p) => {
      const d = definitionFor(p).checklist
      const a = p.checklists[d.id]
      const r = checklistResult(p)
      return d.items.map((item) => [p.id, d.id, r.assessed, item.id, item.label, a?.checkedIds.includes(item.id) ?? false, d.weight, r.count, r.assessed ? r.points : null, r.assessed ? d.weight : 0])
    })],
    Settings: [['Key', 'Value'], ['Application', 'dating-compatibility'], ['Backup version', 3], ['Exported at (UTC ISO)', new Date().toISOString()], ['Profile count', profiles.length], ['Default template ID', defaultDefinition.id], ['Default template version', defaultDefinition.version], ['Template count', systems.length],
      ...systems.map((d) => [`Definition ${key(d)}`, JSON.stringify(d)]),
      ['Restore instructions', 'Restore this backup in the app with customization support. The default scoring system and all saved versions are included.'],
      ['Source data', 'Profiles, Ratings, Shared Interests, and definitions in Settings supply restored data. Other values are calculated snapshots.'],
    ],
  }
}
function dataRows(tables: Tables, name: string, headers: string[]) {
  const rows = tables[name]
  if (!rows || JSON.stringify(rows[0]) !== JSON.stringify(headers)) throw new Error(`Missing or changed ${name} headers.`)
  const result: Scalar[][] = []
  for (const row of rows.slice(1)) {
    if (!row || row.every((v) => v === null || v === '')) continue
    if (row.length > headers.length) throw new Error(`Unexpected columns on ${name}.`)
    result.push(row)
  }
  return result
}
function text(value: Scalar | undefined, blank = false): string {
  if (blank && value == null) return ''
  if (typeof value !== 'string' || (!blank && !value)) throw new Error('Expected text in backup data.')
  return value
}
function bool(value: Scalar | undefined): boolean {
  if (typeof value !== 'boolean') throw new Error('Checklist values must be Excel TRUE or FALSE.')
  return value
}
export function parseTables(tables: Tables): BackupData {
  const settings = new Map<string, Scalar>()
  for (const row of dataRows(tables, tables.Settings ? 'Settings' : 'Metadata', ['Key', 'Value'])) {
    const k = text(row[0]); if (settings.has(k)) throw new Error('Duplicate backup setting.'); settings.set(k, row[1])
  }
  if (settings.get('Backup version') !== 3) return { profiles: parseLegacy(tables), templates: [template], defaultDefinition: template }
  if (settings.get('Application') !== 'dating-compatibility') throw new Error('Not an app backup.')
  const definitions: ScorecardTemplate[] = []
  for (const [k, v] of settings) if (k.startsWith('Definition ')) {
    const d = validateDefinition(JSON.parse(text(v)))
    if (k !== `Definition ${key(d)}`) throw new Error('Scoring-system definition key does not match.')
    definitions.push(d)
  }
  const templates = checkSystems(definitions)
  if (!templates.length || templates.length > 100 || templates.length !== settings.get('Template count')) throw new Error('Missing, duplicate, or unsupported scoring-system definitions.')
  const defaultDefinition = templates.find((d) => d.id === settings.get('Default template ID') && d.version === settings.get('Default template version'))
  if (!defaultDefinition) throw new Error('Default scoring system is missing.')
  const profiles = new Map<string, Profile>()
  for (const row of dataRows(tables, 'Profiles', profileHeaders)) {
    const id = text(row[0])
    if (profiles.has(id)) throw new Error('Duplicate profile ID.')
    const d = templates.find((d) => d.id === row[5] && d.version === row[6])
    if (!d) throw new Error('A profile references a missing scoring system.')
    profiles.set(id, { schemaVersion: 1, id, name: text(row[1], true), notes: text(row[2], true), createdAt: text(row[3]), updatedAt: text(row[4]), templateId: d.id, templateVersion: d.version, definition: structuredClone(d), ratings: {}, checklists: {} })
  }
  if (!profiles.size || profiles.size > 1000 || profiles.size !== settings.get('Profile count')) throw new Error('Profile count is missing or outside the supported range.')
  const rated = new Set<string>()
  for (const row of dataRows(tables, 'Ratings', ratingHeaders)) {
    const p = profiles.get(text(row[0])); if (!p) throw new Error('Rating references an unknown profile.')
    const c = definitionFor(p).groups.flatMap((g) => g.categories).find((c) => c.id === row[1])
    const k = JSON.stringify([p.id, row[1]])
    if (!c || c.label !== row[2] || rated.has(k)) throw new Error('Invalid or duplicate criterion reference.')
    const rating = row[3]
    if (rating !== 'Unknown' && (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 0 || rating > 5)) throw new Error('Rating must be 0–5 or Unknown.')
    p.ratings[c.id] = rating === 'Unknown' ? null : rating as Rating
    rated.add(k)
  }
  const checked = new Set<string>()
  for (const row of dataRows(tables, 'Shared Interests', interestHeaders)) {
    const p = profiles.get(text(row[0])); if (!p) throw new Error('Checklist references an unknown profile.')
    const d = definitionFor(p).checklist
    const item = d.items.find((item) => item.id === row[3])
    const k = JSON.stringify([p.id, row[3]])
    if (row[1] !== d.id || !item || row[4] !== item.label || checked.has(k)) throw new Error('Invalid or duplicate interest reference.')
    const assessed = bool(row[2]); const shared = bool(row[5])
    const existing = p.checklists[d.id]
    if (existing && existing.assessed !== assessed) throw new Error('Checklist assessment values disagree within one profile.')
    const answer = existing ?? { assessed, checkedIds: [] }
    if (shared) answer.checkedIds.push(item.id)
    p.checklists[d.id] = answer
    checked.add(k)
  }
  const result = [...profiles.values()]
  const requiredRatings = result.reduce((sum, p) => sum + definitionFor(p).groups.flatMap((g) => g.categories).length, 0)
  const requiredInterests = result.reduce((sum, p) => sum + definitionFor(p).checklist.items.length, 0)
  if (rated.size !== requiredRatings || checked.size !== requiredInterests) throw new Error('Backup is missing ratings or checklist items.')
  result.forEach(validateProfile)
  return { profiles: result, templates, defaultDefinition }
}
export async function exportBackup(profiles: Profile[], templates: ScorecardTemplate[] = [], defaultDefinition = template) { return writeXlsx(backupTables(profiles, templates, defaultDefinition)) }
export async function importBackup(buffer: ArrayBuffer) { return parseTables(await readXlsx(buffer)) }
