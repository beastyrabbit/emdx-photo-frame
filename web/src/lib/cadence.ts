import type { Cadence } from "@/api/types"

export const CADENCE_CHOICES: { everyMin: number; label: string }[] = [
  { everyMin: 60, label: "stündlich" },
  { everyMin: 120, label: "alle 2 Stunden" },
  { everyMin: 240, label: "alle 4 Stunden" },
  { everyMin: 720, label: "zweimal am Tag" },
  { everyMin: 1440, label: "täglich" },
  { everyMin: 2880, label: "alle 2 Tage" },
  { everyMin: 10080, label: "wöchentlich" },
]

export const EVENT_CADENCE_CHOICES = [
  { everyMin: 15, label: "alle 15 Minuten" },
  { everyMin: 30, label: "alle 30 Minuten" },
  { everyMin: 60, label: "stündlich" },
  { everyMin: 120, label: "alle 2 Stunden" },
  { everyMin: 240, label: "alle 4 Stunden" },
]

export function everyText(everyMin: number): string {
  const known = [...CADENCE_CHOICES, ...EVENT_CADENCE_CHOICES].find((c) => c.everyMin === everyMin)
  if (known) return known.label
  return everyMin < 60 ? `alle ${everyMin} Minuten` : `alle ${Math.round(everyMin / 60)} Stunden`
}

/** "stündlich", "täglich um 07:00", "alle 2 Tage um 06:00". */
export function cadenceText(c: Cadence): string {
  if (c.until) return `${everyText(c.everyMin)} von ${c.at} bis ${c.until}`
  return c.everyMin >= 720 ? `${everyText(c.everyMin)} um ${c.at}` : everyText(c.everyMin)
}

/** The rhythm the frame runs on right now, and the one it will get once a change arrived. */
export function rhythmNow(c: { value: Cadence; confirmedAt: number | null; deviceValue?: Cadence }): string {
  if (c.confirmedAt || !c.deviceValue) return cadenceText(c.value)
  return `${cadenceText(c.deviceValue)} (bald ${cadenceText(c.value)})`
}

/** Ten minutes before the first change of the day: the panel is clean when the picture comes. */
export function suggestedCleaning(c: Cadence): string {
  const [h, m] = c.at.split(":").map(Number)
  const total = (h * 60 + m - 10 + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

/** The first regular change of a rhythm after `t`. */
export function firstChangeAfter(t: number, c: Cadence): number {
  const [h, m] = c.at.split(":").map(Number)
  const d = new Date(t)
  d.setHours(h, m, 0, 0)
  let first = d.getTime()
  while (first <= t) first += Math.min(c.everyMin, 1440) * 60_000
  return first
}
