import assert from 'node:assert/strict'
import test from 'node:test'
import { dhakaNowMinutes, dhakaTodayKey, endLabelFor, generateDaySlots, toLabel, toMinutes } from '../src/utils/slots.js'

const workingHours = [
  { dayOfWeek: 2, slots: [{ start: '10:00', end: '12:00' }] },
]

test('slot grid math and labels round-trip on the 30-minute lattice', () => {
  assert.equal(toMinutes('10:30'), 630)
  assert.equal(toLabel(645), '10:45')
  assert.equal(endLabelFor('11:30'), '12:00')
})

test('generateDaySlots produces the working window minus bookings and past times', () => {
  const full = generateDaySlots({ workingHours, dateKey: '2026-09-01' })
  assert.deepEqual(full, ['10:00', '10:30', '11:00', '11:30'])

  const withBooking = generateDaySlots({ workingHours, dateKey: '2026-09-01', bookedStarts: new Set(['10:30']) })
  assert.deepEqual(withBooking, ['10:00', '11:00', '11:30'])

  const wrongDay = generateDaySlots({ workingHours, dateKey: '2026-09-02' })
  assert.deepEqual(wrongDay, [])

  const noSchedule = generateDaySlots({ workingHours: [], dateKey: '2026-09-01' })
  assert.deepEqual(noSchedule, [])
})

test('today-aware generation drops past Dhaka slots only for the current date', () => {
  // Fixed "now" keeps this time-of-day independent; a live `new Date()` made
  // this suite fail whenever it ran between 00:00 and 06:00 Dhaka time.
  const fixedNow = new Date('2026-09-21T04:00:00Z') // 10:00 Asia/Dhaka
  const today = dhakaTodayKey(fixedNow)

  const lateSlotHours = [
    { dayOfWeek: new Date(`${today}T00:00:00Z`).getUTCDay(), slots: [{ start: '06:00', end: '07:00' }, { start: '10:00', end: '11:00' }] },
  ]

  const todaySlots = generateDaySlots({ workingHours: lateSlotHours, dateKey: today, now: fixedNow })
  // 06:00 is behind the fixed 10:00 Dhaka "now" and must be dropped;
  // a slot starting exactly at "now" is not bookable (strict future),
  // so only 10:30 remains.
  assert.deepEqual(todaySlots, ['10:30'])

  // The same working window on a future date keeps everything.
  const futureKey = dhakaTodayKey(new Date(fixedNow.getTime() + 7 * 24 * 60 * 60 * 1000))
  const futureSlots = generateDaySlots({ workingHours: [{ dayOfWeek: new Date(`${futureKey}T00:00:00Z`).getUTCDay(), slots: [{ start: '06:00', end: '07:00' }] }], dateKey: futureKey, now: fixedNow })
  assert.deepEqual(futureSlots, ['06:00', '06:30'])
})
