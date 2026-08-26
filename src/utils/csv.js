import { format as csvFormat } from 'fast-csv'

const FORMULA_PREFIX = /^[=+\-@\t\r]/

export const MAX_EXPORT_ROWS = 5000

export function csvSafeCell(value) {
  if (typeof value !== 'string') return value
  return FORMULA_PREFIX.test(value) ? `'${value}` : value
}

export function csvFilename(base, now = new Date()) {
  const ymd = now.toISOString().slice(0, 10)
  return `legalease-${base}-${ymd}.csv`
}

export function sendCsvResponse(response, baseFilename, headers, rows) {
  response.setHeader('Content-Type', 'text/csv; charset=utf-8')
  response.setHeader('Content-Disposition', `attachment; filename="${csvFilename(baseFilename)}"`)
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.write('\uFEFF')

  const cappedRows = rows.length > MAX_EXPORT_ROWS ? rows.slice(0, MAX_EXPORT_ROWS) : rows
  const stream = csvFormat({ headers, writeHeaders: true })
  stream.pipe(response)
  for (const row of cappedRows) {
    stream.write(row.map((cell) => csvSafeCell(cell)))
  }
  stream.end()
}
