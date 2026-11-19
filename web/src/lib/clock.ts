// The prototype runs on a fixed day so that the mock data always tells the same story:
// Thursday 19 Nov 2026, 09:30, moving on in real time from there.
// With the real backend this becomes Date.now().
const START = new Date(2026, 10, 19, 9, 30, 0).getTime()
const bootedAt = Date.now()

export const now = (): number => START + (Date.now() - bootedAt)

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

/** A time on a day relative to today: at(1, 6) = tomorrow 06:00. */
export function at(dayOffset: number, hour: number, minute = 0): number {
  const d = new Date(START)
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hour, minute, 0, 0)
  return d.getTime()
}
