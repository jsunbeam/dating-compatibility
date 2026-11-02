export type Rating = 0 | 1 | 2 | 3 | 4 | 5 | null
export interface Category { id: string; label: string; weight: number; description?: string }
export interface Group { id: string; label: string; categories: Category[] }
export interface ScorecardTemplate {
  id: string; version: number; name?: string; groups: Group[]
  checklist: { id: string; label: string; weight: number; items: { id: string; label: string }[] }
}
const categories = (entries: [string, string, number][]): Category[] => entries.map(([id, label, weight]) => ({ id, label, weight }))
export const template: ScorecardTemplate = {
  id: 'dating-compatibility', version: 1,
  groups: [
    { id: 'values', label: 'Relationship values', categories: categories([
      ['curiosity', 'Curiosity and Genuine Interest', 8],
      ['communication', 'Communication and Emotional Maturity', 8],
      ['consistency', 'Consistency and Dependability', 8],
      ['therapy', 'Mental Health Work and Therapy', 8],
      ['initiative', 'Initiative and Pursuit', 8],
    ]) },
    { id: 'core', label: 'Core compatibility', categories: categories([
      ['finances', 'Financial Stability', 4], ['children', 'No Children', 3],
      ['marriages', 'No Prior Marriages', 2], ['sexuality', 'Clarity About Sexuality', 3],
      ['monogamy', 'Monogamy', 5], ['politics', 'Political Compatibility', 5],
      ['religion', 'Religious Compatibility', 3], ['attraction', 'Physical Attraction', 5],
    ]) },
    { id: 'interests', label: 'High-priority shared interests', categories: categories([
      ['gaming', 'Tabletop and Computer Gaming', 4], ['music', 'Music and Classical Concerts', 4],
      ['food', 'Food and Culinary Exploration', 4], ['stories', 'Character-Driven Stories', 4],
      ['health', 'Health Consciousness', 4],
    ]) },
  ],
  checklist: { id: 'additional', label: 'Additional shared interests', weight: 10,
    items: ['Art', 'Museums', 'Exercise', 'Dance', 'Performing arts', 'Live theater', 'Crafts', 'State and national parks', 'Train travel', 'Books', 'Budgeting'].map((label) => ({ id: label.toLowerCase().replaceAll(' ', '-'), label })) },
}
export interface Profile {
  schemaVersion: 1; id: string; templateId: string; templateVersion: number
  name: string; notes: string; createdAt: string; updatedAt: string
  ratings: Record<string, Rating>
  checklists: Record<string, { assessed: boolean; checkedIds: string[] }>
  definition?: ScorecardTemplate
}
export function definitionFor(profile: Profile): ScorecardTemplate { return profile.definition ?? template }
export interface BackupData { profiles: Profile[]; templates: ScorecardTemplate[]; defaultDefinition: ScorecardTemplate }
export function createProfile(definition = template): Profile {
  const now = new Date().toISOString()
  return { schemaVersion: 1, id: crypto.randomUUID(), templateId: definition.id, templateVersion: definition.version, definition: structuredClone(definition),
    name: '', notes: '', createdAt: now, updatedAt: now,
    ratings: Object.fromEntries(definition.groups.flatMap((group) => group.categories.map((category) => [category.id, 0 as Rating]))),
    checklists: { [definition.checklist.id]: { assessed: true, checkedIds: [] } } }
}
export function calculate(profile: Profile, definition = definitionFor(profile)) {
  let earned = 0
  let assessed = 0
  for (const category of definition.groups.flatMap((group) => group.categories)) {
    const rating = profile.ratings[category.id]
    if (rating != null && rating >= 0 && rating <= 5) {
      earned += rating / 5 * category.weight
      assessed += category.weight
    }
  }
  const checklist = definition.checklist
  const answer = profile.checklists[checklist.id]
  if (answer?.assessed) {
    const count = checklist.items.filter((item) => answer.checkedIds.includes(item.id)).length
    earned += count / checklist.items.length * checklist.weight
    assessed += checklist.weight
  }
  const total = definition.groups.flatMap((group) => group.categories).reduce((sum, category) => sum + category.weight, checklist.weight)
  return { earned, assessed, total, score: assessed ? earned / assessed * 100 : null, coverage: assessed / total * 100 }
}
export function scorecard(profile: Profile) {
  const template = definitionFor(profile)
  const result = calculate(profile)
  const list = profile.checklists[template.checklist.id]
  return [
    `Dating compatibility — ${profile.name.trim() || 'Unnamed profile'}`,
    `Scoring system: ${template.name || 'Original scoring system'} · version ${template.version}`,
    `Score: ${result.score === null ? 'Not assessed' : result.score.toFixed(1) + '%'} | Coverage: ${result.coverage.toFixed(1)}%`,
    `Points: ${result.earned.toFixed(2)} / ${result.assessed} assessed (${result.total} total)`,
    ...template.groups.flatMap((group) => ['', group.label, ...group.categories.map((category) => `${category.label}: ${profile.ratings[category.id] ?? 'Unknown'}${profile.ratings[category.id] == null ? '' : '/5'} (weight ${category.weight})`)]),
    '', `${template.checklist.label}: ${list?.assessed ? 'Assessed' : 'Unknown'} (weight ${template.checklist.weight})`,
    ...template.checklist.items.map((item) => `${list?.checkedIds.includes(item.id) ? '[x]' : '[ ]'} ${item.label}`),
    '', `Notes: ${profile.notes.trim() || 'None'}`,
  ].join('\n')
}

export function validateDefinition(value: unknown): ScorecardTemplate {
  if (!value || typeof value !== 'object') throw new Error('Invalid scoring system.')
  const d = value as ScorecardTemplate
  const label = (v: unknown, max = 120) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
  if (!label(d.id) || !Number.isInteger(d.version) || d.version < 1 || (d.name !== undefined && !label(d.name, 80)) || !Array.isArray(d.groups) || d.groups.length < 1 || d.groups.length > 10) throw new Error('Give the scoring system a name and 1–10 groups.')
  const ids = new Set<string>()
  const unique = (id: unknown) => { if (!label(id) || ids.has(id as string)) throw new Error('Scoring IDs must be unique.'); ids.add(id as string) }
  const weight = (n: unknown) => { if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 100) throw new Error('Weights must be whole numbers from 0 to 100.') }
  let total = 0
  let count = 0
  for (const group of d.groups) {
    if (!group || !label(group.label, 80) || !Array.isArray(group.categories)) throw new Error('Each group needs a name and criteria.')
    unique(group.id)
    for (const c of group.categories) {
      if (!c || !label(c.label) || (c.description !== undefined && (typeof c.description !== 'string' || c.description.length > 200))) throw new Error('Each criterion needs a name; descriptions can contain up to 200 characters.')
      unique(c.id); weight(c.weight); total += c.weight; count++
    }
  }
  if (count < 1 || count > 40) throw new Error('Include 1–40 rated criteria.')
  const list = d.checklist
  if (!list || !label(list.label) || !Array.isArray(list.items) || list.items.length < 1 || list.items.length > 30) throw new Error('Include a named checklist with 1–30 interests.')
  unique(list.id); weight(list.weight); total += list.weight
  for (const item of list.items) {
    if (!item || !label(item.label, 80)) throw new Error('Each checklist interest needs a name.')
    unique(item.id)
  }
  if (total !== 100) throw new Error(`Weights must total 100 points. Current total: ${total}.`)
  if (JSON.stringify(d).length > 32000) throw new Error('Scoring system is too large for an Excel backup.')
  if (d.id === template.id && d.version === template.version && JSON.stringify(d) !== JSON.stringify(template)) throw new Error('The original scoring system cannot be overwritten. Save a new version instead.')
  return d
}
