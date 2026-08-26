import assert from 'node:assert/strict'
import test from 'node:test'
import { csvSafeCell, csvFilename, MAX_EXPORT_ROWS } from '../src/utils/csv.js'

test('csv cells neutralise spreadsheet formula injection while preserving normal values', () => {
  assert.equal(csvSafeCell('=cmd|\' /C calc\'!A0'), "'=cmd|' /C calc'!A0")
  assert.equal(csvSafeCell('+SUM(A1)'), "'+SUM(A1)")
  assert.equal(csvSafeCell('@import_url'), "'@import_url")
  assert.equal(csvSafeCell('-not-a-formula-account'), "'-not-a-formula-account")
  assert.equal(csvSafeCell('Adv. Rahim Ahmed'), 'Adv. Rahim Ahmed')
  assert.equal(csvSafeCell(22000), 22000)
  assert.equal(csvSafeCell(null), null)
})

test('export filenames are dated and row caps are enforced', () => {
  const fixed = new Date('2026-08-26T09:30:00.000Z')
  assert.equal(csvFilename('users', fixed), 'legalease-users-2026-08-26.csv')
  assert.ok(MAX_EXPORT_ROWS >= 1000)
})
