import { calculate, template } from './model'
import type { Profile, Rating } from './model'
import { validateProfile } from './storage'
import { readXlsx, writeXlsx } from './xlsx'
import type { Scalar, Tables } from './xlsx'

const categories = template.groups.flatMap((group) => group.categories)
const profileHeaders = ['Profile ID', 'Name', 'Notes', 'Created at (UTC ISO)', 'Updated at (UTC ISO)']
const ratingHeaders = ['Profile ID', 'Category ID', 'Category', 'Rating (0–5 or Unknown)']
const detailedRatingHeaders = [...ratingHeaders, 'Maximum points', 'Weighted points', 'Assessed weight']
const checklistHeaders = ['Profile ID', 'Assessed', ...template.checklist.items.map((item) => item.label)]
const sharedHeaders = [...checklistHeaders, 'Checked count', 'Weighted points', 'Assessed weight']
const descriptions: Record<string, string> = {
  curiosity: 'Shows curiosity about your thoughts, experiences, and interests.',
  communication: 'Communicates clearly, listens, and handles emotions and disagreements constructively.',
  consistency: 'Follows through and behaves consistently over time.',
  therapy: 'Takes responsibility for mental health and personal growth, including therapy when relevant.',
  initiative: 'Takes initiative in planning, connecting, and pursuing the relationship.',
  finances: 'Financial habits and stability fit your needs and expectations.',
  children: 'Alignment with your preference for a partner without children.',
  marriages: 'Alignment with your preference for a partner without prior marriages.',
  sexuality: 'Communicates a clear understanding of their sexuality and its fit with the relationship.',
  monogamy: 'Shares your expectations for a monogamous relationship.',
  politics: 'Political beliefs and their practical effects fit your values.',
  religion: 'Religious beliefs and practices fit your expectations.',
  attraction: 'You experience physical attraction toward this person.',
  gaming: 'Shares your interest in tabletop and computer gaming.',
  music: 'Shares your interest in music and classical concerts.',
  food: 'Shares your interest in food and culinary exploration.',
  stories: 'Shares your enjoyment of character-driven stories.',
  health: 'Shares your priorities around health-conscious habits.',
}
function interests(profile: Profile) {
  const answer = profile.checklists[template.checklist.id]
  const count = template.checklist.items.filter((item) => answer?.checkedIds.includes(item.id)).length
  return { assessed: answer?.assessed ?? false, count, points: count / template.checklist.items.length * template.checklist.weight }
}
export function backupTables(profiles: Profile[]): Tables {
  if (!profiles.length || profiles.length > 1000) throw new Error('A backup must contain between 1 and 1,000 profiles.')
  profiles.forEach(validateProfile)
  if (new Set(profiles.map((p) => p.id)).size !== profiles.length) throw new Error('Profile IDs must be unique.')
  return {
    'Profile Comparison': [
      ['Criterion / metric', 'Category group', 'Maximum points', ...profiles.map((p, i) => p.name.trim() || `Unnamed profile ${i + 1}`)],
      ['Compatibility score', '', null, ...profiles.map((p) => { const score = calculate(p); return score.score === null ? 'Unknown' : score.score / 100 })],
      ['Coverage', '', null, ...profiles.map((p) => calculate(p).coverage / 100)],
      ['Earned points', '', 100, ...profiles.map((p) => calculate(p).earned)],
      ['Assessed weight', '', 100, ...profiles.map((p) => calculate(p).assessed)],
      ...template.groups.flatMap((group) => group.categories.map((c) => [c.label, group.label, c.weight, ...profiles.map((p) => p.ratings[c.id] ?? 'Unknown')])),
      [template.checklist.label, 'Additional shared interests', template.checklist.weight, ...profiles.map((p) => { const a = interests(p); return a.assessed ? a.points : 'Unknown' })],
      [], ['Reading this comparison', 'Ratings are 0–5. Additional shared interests shows points out of 10. Unknown is excluded.'],
      ['Calculation', 'Compatibility = earned points / assessed weight. Coverage = assessed weight / 100.'],
      ['Workbook use', 'Scores and weighted points are snapshots at export. Use the app to edit and recalculate.'],
    ],
    Profiles: [profileHeaders, ...profiles.map((p) => [p.id, p.name, p.notes, p.createdAt, p.updatedAt])],
    Ratings: [detailedRatingHeaders, ...profiles.flatMap((p) => categories.map((c) => {
      const rating = p.ratings[c.id]
      return [p.id, c.id, c.label, rating ?? 'Unknown', c.weight, rating == null ? null : rating / 5 * c.weight, rating == null ? 0 : c.weight]
    }))],
    Criteria: [
      ['Criterion ID', 'Criterion', 'Category group', 'Maximum points', 'What to assess', 'Scoring description'],
      ...template.groups.flatMap((group) => group.categories.map((c) => [c.id, c.label, group.label, c.weight, descriptions[c.id], 'Rate 0–5: 0 = no alignment, 5 = strong alignment. Points = rating / 5 × maximum points. Unknown is excluded; 0 counts as assessed.'])),
      [template.checklist.id, template.checklist.label, 'Additional shared interests', template.checklist.weight, 'The 11 shared interests listed on Shared Interests.', 'If assessed: checked count / 11 × 10 points. If unassessed: excluded. No checked items when assessed = 0 points.'],
    ],
    'Shared Interests': [sharedHeaders, ...profiles.map((p) => {
      const answer = p.checklists[template.checklist.id]
      const a = interests(p)
      return [p.id, a.assessed, ...template.checklist.items.map((item) => answer?.checkedIds.includes(item.id) ?? false), a.count, a.assessed ? a.points : null, a.assessed ? template.checklist.weight : 0]
    })],
    Settings: [['Key', 'Value'], ['Application', 'dating-compatibility'], ['Backup version', 2],
      ['Template ID', template.id], ['Template version', template.version], ['Exported at (UTC ISO)', new Date().toISOString()],
      ['Profile count', profiles.length], ['Template definition', JSON.stringify(template)],
      ['Rating scale', '0–5; Unknown is excluded and is different from zero.'],
      ['Compatibility calculation', 'Earned points / assessed weight × 100.'],
      ['Coverage calculation', 'Assessed weight / total maximum points × 100.'],
      ['Restore instructions', 'Use Restore Excel backup in the app. Review Merge or Replace, then Apply restore.'],
      ['Data sheets', 'Profiles, Ratings, and Shared Interests contain the original answers. Comparison, weighted points, and counts are calculated snapshots.'],
      ['Customization', 'This version restores only the exact template definition above. Change criteria in the app when customization is available.'],
    ],
  }
}

function rows(tables: Tables, name: string, headers: string[]): Scalar[][] {
  const table = tables[name]
  if (!table || JSON.stringify(table[0]) !== JSON.stringify(headers)) throw new Error(`Missing or changed headers on ${name}. Choose an original app backup.`)
  const data: Scalar[][] = []
  for (let i = 1; i < table.length; i++) {
    const row = table[i]
    if (!row || row.every((value) => value === null || value === '')) continue
    if (row.length > headers.length) throw new Error(`Unexpected columns on ${name}.`)
    data.push(row)
  }
  return data
}
function text(value: Scalar | undefined, label: string, allowBlank = false): string {
  if (allowBlank && (value == null || value === '')) return ''
  if (typeof value !== 'string' || (!allowBlank && !value.length)) throw new Error(`Invalid ${label}.`)
  return value
}
function bool(value: Scalar | undefined): boolean {
  if (typeof value !== 'boolean') throw new Error('Checklist cells must be Excel TRUE or FALSE values.')
  return value
}
export function parseTables(tables: Tables): Profile[] {
  const metadata = new Map<string, Scalar>()
  const settingsSheet = tables.Settings ? 'Settings' : 'Metadata'
  for (const row of rows(tables, settingsSheet, ['Key', 'Value'])) {
    const key = text(row[0], 'metadata key')
    if (metadata.has(key)) throw new Error('Duplicate metadata key.')
    metadata.set(key, row[1])
  }
  const version = metadata.get('Backup version')
  if (metadata.get('Application') !== 'dating-compatibility' || (version !== 1 && version !== 2)) throw new Error('Unsupported backup format. Select a backup exported by this app.')
  if (metadata.get('Template ID') !== template.id || metadata.get('Template version') !== template.version || metadata.get('Template definition') !== JSON.stringify(template)) throw new Error('This backup uses different categories or weights. Existing profiles have not changed.')
  const profiles = new Map<string, Profile>()
  for (const row of rows(tables, 'Profiles', profileHeaders)) {
    const id = text(row[0], 'profile ID')
    if (profiles.has(id)) throw new Error('Duplicate profile ID in backup.')
    const profile: Profile = { schemaVersion: 1, id, templateId: template.id, templateVersion: template.version,
      name: text(row[1], 'name', true), notes: text(row[2], 'notes', true), createdAt: text(row[3], 'creation timestamp'),
      updatedAt: text(row[4], 'update timestamp'), ratings: {}, checklists: {} }
    profiles.set(id, profile)
  }
  if (!profiles.size || profiles.size > 1000 || metadata.get('Profile count') !== profiles.size) throw new Error('Profile count is missing, changed, or outside the supported range (1–1,000).')
  const seenRatings = new Set<string>()
  for (const row of rows(tables, 'Ratings', version === 2 ? detailedRatingHeaders : ratingHeaders)) {
    const id = text(row[0], 'rating profile ID')
    const categoryId = text(row[1], 'category ID')
    const profile = profiles.get(id)
    const category = categories.find((c) => c.id === categoryId)
    const key = `${id}\u0000${categoryId}`
    if (!profile || !category || row[2] !== category.label || seenRatings.has(key)) throw new Error('Unknown, changed, or duplicate rating reference.')
    const value = row[3]
    if (value !== 'Unknown' && (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 5)) throw new Error('Ratings must be whole numbers 0–5 or the word Unknown. Blank is not zero.')
    profile.ratings[categoryId] = value === 'Unknown' ? null : value as Rating
    seenRatings.add(key)
  }
  if (seenRatings.size !== profiles.size * categories.length) throw new Error('Backup is missing ratings. No profiles have changed.')
  const seenChecklists = new Set<string>()
  for (const row of rows(tables, version === 2 ? 'Shared Interests' : 'Shared interests', version === 2 ? sharedHeaders : checklistHeaders)) {
    const id = text(row[0], 'checklist profile ID')
    const profile = profiles.get(id)
    if (!profile || seenChecklists.has(id)) throw new Error('Unknown or duplicate checklist profile ID.')
    profile.checklists[template.checklist.id] = { assessed: bool(row[1]), checkedIds: template.checklist.items.filter((_, i) => bool(row[i + 2])).map((item) => item.id) }
    seenChecklists.add(id)
  }
  if (seenChecklists.size !== profiles.size) throw new Error('Backup is missing shared-interest assessments.')
  return [...profiles.values()].map(validateProfile)
}
export async function exportBackup(profiles: Profile[]) { return writeXlsx(backupTables(profiles)) }
export async function importBackup(buffer: ArrayBuffer) { return parseTables(await readXlsx(buffer)) }
export function downloadBackup(bytes: Uint8Array<ArrayBuffer>, prefix = 'dating-compatibility') {
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${prefix}-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}.xlsx`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
