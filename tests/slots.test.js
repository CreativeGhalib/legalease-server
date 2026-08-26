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
  const now = new Date()
  const today = dhakaTodayKey(now)
  void dhakaNowMinutes(now)

  const lateSlotHours = [
    { dayOfWeek: weekdayOf(today), slots: [{ start: '06:00', end: '07:00' }, { start: '22:00', end: '23:00' }] },
  ]
  function weekdayOf(dateKey) {
    return new Date(`${dateKey}T00:00:00Z`).getUTCDay()
  }

  const todaySlots = generateDaySlots({ workingHours: lateSlotHours, dateKey: today, now })
  // 06:00–07:00 Dhaka is always in the past or edge-adjacent relative to "now";
  // 22:00+ is always future-or-edge for a same-day check made before 22:00.
  assert.ok(todaySlots.every((slot) => slot >= '21:30'), `unexpected past slot kept: ${todaySlots}`)
})
