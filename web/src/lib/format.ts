import { DAY, HOUR, MINUTE, now } from "./clock"

const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" })
const weekday = new Intl.DateTimeFormat("de-DE", { weekday: "short" })
const dayMonth = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "numeric" })

const startOfDay = (t: number) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Whole days between today and t: 0 today, 1 tomorrow, -1 yesterday. */
export const dayDiff = (t: number, from = now()) => Math.round((startOfDay(t) - startOfDay(from)) / DAY)

export const fmtTime = (t: number) => time.format(t)

const wd = (t: number) => weekday.format(t).replace(".", "")

/** "heute", "morgen", "gestern", "Sa", or "Sa 28.11." further away. `dated` always gives the date: "Sa 21.11.". */
export function fmtDay(t: number, dated = false): string {
  const d = dayDiff(t)
  if (!dated) {
    if (d === 0) return "heute"
    if (d === 1) return "morgen"
    if (d === -1) return "gestern"
    if (d > 1 && d < 7) return wd(t)
  }
  return `${wd(t)} ${dayMonth.format(t)}`
}

/** Whether `fmtDay` names this day by its date, not as "heute", "morgen" or a bare weekday. */
export const isDated = (t: number) => dayDiff(t) < -1 || dayDiff(t) >= 7

const fullDate = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })

/** "Sa 21.11.2026": a whole date, for the field that picks a day. */
export const fmtDate = (t: number) => `${wd(t)} ${fullDate.format(t)}`

/** "heute 07:00", "Sa 06:00", "Sa 28.11., 06:00". */
export function fmtWhen(t: number): string {
  const d = dayDiff(t)
  const day = fmtDay(t)
  return d >= -1 && d < 7 ? `${day} ${fmtTime(t)}` : `${day}, ${fmtTime(t)}`
}

/** "vor 5 Min.", "vor 2 Std.", "vor 3 Tagen". */
export function fmtAgo(t: number): string {
  const diff = now() - t
  if (diff < MINUTE) return "gerade eben"
  if (diff < HOUR) return `vor ${Math.round(diff / MINUTE)} Min.`
  if (diff < DAY) return `vor ${Math.round(diff / HOUR)} Std.`
  const days = Math.round(diff / DAY)
  return days === 1 ? "vor 1 Tag" : `vor ${days} Tagen`
}

/** "12 Stunden", "1 Tag 3 Stunden", "45 Minuten". */
export function fmtDuration(ms: number): string {
  const mins = Math.round(ms / MINUTE)
  if (mins < 60) return `${mins} Minuten`
  const hours = Math.round(mins / 60)
  if (hours < 24) return hours === 1 ? "1 Stunde" : `${hours} Stunden`
  const days = Math.floor(hours / 24)
  const rest = hours % 24
  const d = days === 1 ? "1 Tag" : `${days} Tage`
  return rest ? `${d} ${rest} Std.` : d
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "Flur", "Flur und Küche", "Flur, Küche und Treppe". */
export function listDe(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ""
  return `${items.slice(0, -1).join(", ")} und ${items[items.length - 1]}`
}
