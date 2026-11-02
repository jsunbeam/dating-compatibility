// A small, deliberately limited XLSX adapter for this app's tabular backups.
// JSZip is bundled (MIT license in vendor/) so installation needs no new packages.
import JSZip from './vendor/jszip.browser.js'

export type Scalar = string | number | boolean | null
export type Tables = Record<string, Scalar[][]>
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const relns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
function escape(value: string) {
  if (Array.from(value).some((char) => char.charCodeAt(0) < 32 && ![9, 10, 13].includes(char.charCodeAt(0)))) throw new Error('Text contains a control character Excel cannot store. Remove it and retry.')
  if (value.length > 32767) throw new Error('One text field exceeds Excel’s 32,767-character cell limit. Shorten it before exporting.')
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\r', '&#13;')
}
function column(index: number): string {
  let name = ''
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name
  return name
}
export async function writeXlsx(tables: Tables): Promise<Uint8Array<ArrayBuffer>> {
  const zip = new JSZip()
  const names = Object.keys(tables)
  const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  zip.file('[Content_Types].xml', declaration + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`)
  zip.file('_rels/.rels', declaration + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relns}/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  zip.file('xl/workbook.xml', declaration + `<workbook xmlns="${ns}" xmlns:r="${relns}"><sheets>${names.map((name, i) => `<sheet name="${escape(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', declaration + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${relns}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="styles" Type="${relns}/styles" Target="styles.xml"/></Relationships>`)
  zip.file('xl/styles.xml', declaration + `<styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF244B41"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`)
  names.forEach((name, sheetIndex) => {
    const rows = tables[name]
    const widths = (rows[0] ?? []).map((header, i) => {
      const width = name === 'Profile Comparison' ? (i === 0 ? 48 : i === 1 ? 32 : i === 2 ? 18 : 26) : name === 'Settings' ? (i === 0 ? 32 : 100) : /notes|what to assess|scoring description/i.test(String(header)) ? 65 : /id|at|definition/i.test(String(header)) ? 40 : Math.min(45, Math.max(20, String(header).length + 3))
      return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`
    }).join('')
    const data = rows.map((row, r) => `<row r="${r + 1}"${r === 0 ? ' ht="34" customHeight="1"' : name === 'Criteria' ? ' ht="64" customHeight="1"' : ''}>${row.map((value, c) => {
      const address = `${column(c)}${r + 1}`
      const style = r === 0 ? 1 : ((name === 'Profile Comparison' && (r === 1 || r === 2) && c >= 3) || (name === 'Summary' && (c === 1 || c === 2))) ? 2 : 0
      if (value === null) return ''
      if (typeof value === 'number') return `<c r="${address}" s="${style}"><v>${value}</v></c>`
      if (typeof value === 'boolean') return `<c r="${address}" s="${style}" t="b"><v>${value ? 1 : 0}</v></c>`
      // Inline string cells preserve literal text, including leading '=' or '+'.
      return `<c r="${address}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`
    }).join('')}</row>`).join('')
    zip.file(`xl/worksheets/sheet${sheetIndex + 1}.xml`, declaration + `<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${data}</sheetData></worksheet>`)
  })
  let expanded = 0
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue
    const text = await entry.async('string')
    if (text.length > 12_000_000) throw new Error('This backup is too large. Shorten long notes before exporting.')
    expanded += new TextEncoder().encode(text).byteLength
  }
  if (expanded > 20_000_000) throw new Error('This backup is too large. Shorten long notes before exporting.')
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  if (bytes.byteLength > 5_000_000) throw new Error('This backup exceeds the 5 MB restore limit. Shorten long notes before exporting.')
  return bytes
}

function xml(text: string): Document {
  if (text.length > 12_000_000 || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Unsupported or oversized workbook XML.')
  const document = new DOMParser().parseFromString(text, 'application/xml')
  if (document.getElementsByTagName('parsererror').length) throw new Error('The workbook contains invalid XML.')
  return document
}
function elements(node: Document | Element, localName: string) { return Array.from(node.getElementsByTagNameNS('*', localName)) }
export async function readXlsx(buffer: ArrayBuffer): Promise<Tables> {
  if (buffer.byteLength > 5_000_000) throw new Error('Choose a backup smaller than 5 MB.')
  // Check declared expanded size before JSZip extracts XML from the ZIP archive.
  const view = new DataView(buffer)
  let expanded = 0
  let entries = 0
  for (let i = 0; i + 46 <= buffer.byteLength; i++) {
    if (view.getUint32(i, true) === 0x02014b50) {
      expanded += view.getUint32(i + 24, true)
      entries++
      i += 45 + view.getUint16(i + 28, true) + view.getUint16(i + 30, true) + view.getUint16(i + 32, true)
    }
  }
  if (!entries || entries > 500 || expanded > 20_000_000) throw new Error('This workbook is too large or uses an unsupported ZIP format.')
  const zip = await JSZip.loadAsync(buffer)
  async function part(path: string) {
    const file = zip.file(path)
    if (!file) throw new Error(`Missing workbook part: ${path}`)
    return xml(await file.async('string'))
  }
  const book = await part('xl/workbook.xml')
  const relationships = await part('xl/_rels/workbook.xml.rels')
  const paths = new Map(elements(relationships, 'Relationship').filter((r) => r.getAttribute('TargetMode') !== 'External').map((r) => [r.getAttribute('Id'), r.getAttribute('Target')!]))
  const shared = zip.file('xl/sharedStrings.xml') ? elements(await part('xl/sharedStrings.xml'), 'si').map((si) => elements(si, 't').map((t) => t.textContent).join('')) : []
  const tables: Tables = Object.create(null) as Tables
  for (const sheet of elements(book, 'sheet')) {
    const name = sheet.getAttribute('name')!
    // Summary is for reading; only these sheets supply restored data.
    if (!['Metadata', 'Settings', 'Profiles', 'Ratings', 'Shared interests', 'Shared Interests'].includes(name)) continue
    if (tables[name]) throw new Error('Duplicate worksheet name.')
    const target = paths.get(sheet.getAttributeNS(relns, 'id'))
    if (!target || target.includes('..')) throw new Error('Unsupported workbook relationship.')
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
    const rows: Scalar[][] = []
    for (const row of elements(await part(path), 'row')) {
      const index = Number(row.getAttribute('r')) - 1
      if (!Number.isInteger(index) || index < 0 || index > 65000 || rows[index]) throw new Error('Invalid or oversized worksheet rows.')
      const values: Scalar[] = []
      for (const cell of elements(row, 'c')) {
        const reference = cell.getAttribute('r') ?? ''
        const match = /^([A-Z]+)([1-9][0-9]*)$/.exec(reference)
        if (!match || Number(match[2]) !== index + 1) throw new Error('Invalid cell reference.')
        let c = 0
        for (const letter of match[1]) c = c * 26 + letter.charCodeAt(0) - 64
        c--
        if (c > 40 || values[c] !== undefined) throw new Error('Unexpected worksheet columns.')
        if (elements(cell, 'f').length) throw new Error('Restore data must contain values, not Excel formulas.')
        const type = cell.getAttribute('t')
        const raw = elements(cell, 'v')[0]?.textContent ?? ''
        let value: Scalar
        if (type === 'inlineStr') value = elements(cell, 't').map((t) => t.textContent).join('')
        else if (type === 's') {
          if (!/^\d+$/.test(raw) || shared[Number(raw)] === undefined) throw new Error('Invalid shared string.')
          value = shared[Number(raw)]
        } else if (type === 'b') {
          if (raw !== '0' && raw !== '1') throw new Error('Invalid boolean cell.')
          value = raw === '1'
        } else if (type === 'str') value = raw
        else if (type && type !== 'n') throw new Error('Unsupported cell type in backup data.')
        else {
          if (!raw) value = null
          else { value = Number(raw); if (!Number.isFinite(value)) throw new Error('Invalid number cell.') }
        }
        values[c] = value
      }
      rows[index] = values
    }
    tables[name] = rows
  }
  return tables
}
