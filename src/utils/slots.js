const SLOT_DURATION_MINUTES = 30

export function toMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

export function toLabel(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function dhakaTodayKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(now)
}

export function dhakaNowMinutes(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now)
  const get = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return get('hour') * 60 + get('minute')
}

export function weekdayOfDateKey(dateKey) {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay()
}

/**
 * Pure slot generator — the single source of truth for what a client may book.
 * Grid = workingHours for that weekday; minus already-booked starts; minus past
 * slots when the dateKey is today (Asia/Dhaka).
 */
export function generateDaySlots({ workingHours, dateKey, bookedStarts = new Set(), duration = SLOT_DURATION_MINUTES, now = new Date() }) {
  const weekday = weekdayOfDateKey(dateKey)
  const dayEntry = (workingHours ?? []).find((day) => day.dayOfWeek === weekday)
  if (!dayEntry || !Array.isArray(dayEntry.slots)) return []

  const isToday = dateKey === dhakaTodayKey(now)
  const nowMinutes = dhakaNowMinutes(now)

  const available = []
  for (const range of dayEntry.slots) {
    let cursor = toMinutes(range.start)
    const end = toMinutes(range.end)
    while (cursor + duration <= end) {
      const label = toLabel(cursor)
      const isFutureEnough = !isToday || cursor > nowMinutes
      if (isFutureEnough && !bookedStarts.has(label)) available.push(label)
      cursor += duration
    }
  }
  return available
}

export function endLabelFor(start, duration = SLOT_DURATION_MINUTES) {
  return toLabel(toMinutes(start) + duration)
}
