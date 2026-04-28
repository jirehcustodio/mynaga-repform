import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'csv-parse/sync'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const csvPath = path.join(projectRoot, 'tmp-sheet.csv')

if (!fs.existsSync(csvPath)) {
  console.error('Missing tmp-sheet.csv. Download the CSV export first.')
  process.exit(1)
}

const csvContent = fs.readFileSync(csvPath, 'utf8')
const records = parse(csvContent, {
  columns: true,
  skip_empty_lines: true,
  relax_quotes: true,
  relax_column_count: true,
  trim: true,
})

const normalize = (value = '') => value.trim()

const officeCounts = new Map()
const overallCounts = new Map()
const officeTotals = new Map()
const officeSet = new Set()
let overallTotal = 0

for (const record of records) {
  const rawCategory = normalize(record.Category || '')
  if (!rawCategory) {
    continue
  }

  overallTotal += 1

  const officeRaw = normalize(record.Office || '')
  if (!officeRaw) continue

  const officeNames = officeRaw
    .split(/,|\//)
    .map((item) => item.trim())
    .filter(Boolean)

  if (officeNames.length === 0) {
    continue
  }

  officeNames.forEach((office) => officeSet.add(office))

  officeNames.forEach((office) => {
    officeTotals.set(office, (officeTotals.get(office) ?? 0) + 1)
  })

  if (rawCategory.toLowerCase() === 'others') {
    continue
  }

  const normalizedCategory = rawCategory

  officeNames.forEach((office) => {
    const officeMap = officeCounts.get(office) ?? new Map()
    officeMap.set(
      normalizedCategory,
      (officeMap.get(normalizedCategory) ?? 0) + 1,
    )
    officeCounts.set(office, officeMap)
  })

  overallCounts.set(
    normalizedCategory,
    (overallCounts.get(normalizedCategory) ?? 0) + 1,
  )

}

const toSortedList = (map) =>
  [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }))

const overall = {
  totalReports: overallTotal,
  categories: toSortedList(overallCounts).slice(0, 10),
}

const officeList = [...officeSet].sort((a, b) => a.localeCompare(b))

const offices = [...officeCounts.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([office, map]) => ({
    office,
    totalReports: officeTotals.get(office) ?? 0,
    categories: toSortedList(map).slice(0, 10),
  }))

const output = `export const officeTopCategories = ${JSON.stringify(
  { overall, offices, officeList },
  null,
  2,
)} as const
`

fs.writeFileSync(
  path.join(projectRoot, 'src/data/officeTopCategories.ts'),
  output,
  'utf8',
)

console.log('Generated src/data/officeTopCategories.ts')
