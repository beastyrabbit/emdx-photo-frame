import { CalendarDays } from "lucide-react"
import { useState } from "react"
import { de } from "react-day-picker/locale"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DAY, HOUR } from "@/lib/clock"
import { fmtDate, fmtDay, fmtDuration, fmtTime, isDated } from "@/lib/format"
import { useWide } from "@/lib/use-media"
import { Chip } from "./bits"
import { Sheet } from "./sheet"
import { TimeField } from "./time-field"

const longDate = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })

const withTime = (day: number, time: string) => {
  const [h, m] = time.split(":").map(Number)
  const d = new Date(day)
  d.setHours(h || 0, m || 0, 0, 0)
  return d.getTime()
}
const dayStart = (t: number) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** "Sa 21.11. 15:00 bis 23:00" or "... bis So 03:00 (am nächsten Tag)". */
export function rangeText(start: number, end: number): string {
  const days = Math.round((dayStart(end) - dayStart(start)) / DAY)
  // Both ends in the same form: if one of them needs its date, the other gets it too ("Mi 25.11. … bis Do 26.11. …").
  const dated = isDated(start) || isDated(end)
  const startDay = fmtDay(start, dated)
  if (days === 0) return `${startDay} ${fmtTime(start)} bis ${fmtTime(end)}`
  if (days === 1) return `${startDay} ${fmtTime(start)} bis ${fmtDay(end, dated)} ${fmtTime(end)} (am nächsten Tag)`
  return `${startDay} ${fmtTime(start)} bis ${fmtDay(end, dated)} ${fmtTime(end)}`
}

/**
 * Start and end of an Event. On wide screens: one calendar for the days and two time fields.
 * An end time earlier than the start time means "the next day", so 15:00 to 03:00 just works.
 * On the phone each day opens the same German calendar in a bottom sheet, so a date never reads
 * "11/21/2026", whatever language the browser is set to.
 * Times are always entered in 24 hours, whatever the browser's language (see TimeField).
 */
export function DateTimeRange({ start, end, onChange }: { start: number; end: number; onChange: (start: number, end: number) => void }) {
  const wide = useWide()
  const duration = end - start
  const setStartTime = (time: string) => {
    const s = withTime(start, time)
    onChange(s, s + Math.max(duration, HOUR))
  }
  const setEndTime = (time: string) => {
    let e = withTime(end, time)
    // Same day but earlier than the start: the owner means the next day.
    if (dayStart(e) === dayStart(start) && e <= start) e += DAY
    else if (e - start > DAY && withTime(start, time) > start) e = withTime(start, time)
    onChange(start, e)
  }
  const invalid = end <= start

  return (
    <div className="grid gap-3">
      {wide ? (
        <div className="flex flex-wrap items-end gap-3">
          <Popover>
            <PopoverTrigger className="inline-flex h-11 items-center gap-2 rounded-control border border-line bg-surface px-3 text-left">
              <CalendarDays className="size-5 text-ink-soft" aria-hidden />
              <span>
                {fmtDay(start, isDated(start) || isDated(end))}
                {dayStart(end) !== dayStart(start) ? ` bis ${fmtDay(end, isDated(start) || isDated(end))}` : ""}
              </span>
              <span className="sr-only">, Tage ändern</span>
            </PopoverTrigger>
            <PopoverContent className="w-auto bg-surface p-2" align="start">
              <Calendar
                mode="range"
                locale={de}
                numberOfMonths={2}
                defaultMonth={new Date(start)}
                selected={{ from: new Date(start), to: new Date(end) }}
                onSelect={(range) => {
                  if (!range?.from) return
                  const s = withTime(range.from.getTime(), fmtTime(start))
                  let e = withTime((range.to ?? range.from).getTime(), fmtTime(end))
                  if (e <= s) e += DAY
                  onChange(s, e)
                }}
                className="bg-surface"
              />
            </PopoverContent>
          </Popover>
          <div className="grid gap-1 text-small text-ink-soft">
            <span aria-hidden>Beginn</span>
            <TimeField label="Beginn" value={fmtTime(start)} onChange={setStartTime} />
          </div>
          <div className="grid gap-1 text-small text-ink-soft">
            <span aria-hidden>Ende</span>
            <TimeField label="Ende" value={fmtTime(end)} onChange={setEndTime} />
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="grid gap-1">
            <span className="font-semibold">Beginn</span>
            <div className="flex flex-wrap items-center gap-2">
              <DayField
                id="event-beginn-tag"
                label="Beginn"
                value={start}
                onChange={(day) => {
                  const s = withTime(day, fmtTime(start))
                  onChange(s, s + Math.max(duration, HOUR))
                }}
              />
              <TimeField label="Beginn" value={fmtTime(start)} onChange={setStartTime} />
            </div>
          </div>
          <div className="grid gap-1">
            <span className="font-semibold">Ende</span>
            <div className="flex flex-wrap items-center gap-2">
              <DayField
                id="event-ende-tag"
                label="Ende"
                value={end}
                min={start}
                invalid={invalid}
                onChange={(day) => onChange(start, withTime(day, fmtTime(end)))}
              />
              <TimeField
                label="Ende"
                value={fmtTime(end)}
                onChange={(time) => {
                  const e = withTime(end, time)
                  // Earlier than the start on the same day: the owner means the next day.
                  onChange(start, dayStart(e) === dayStart(start) && e <= start ? e + DAY : e)
                }}
              />
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-small text-ink-soft">Dauer</span>
        {[3, 6, 12, 24, 48].map((h) => (
          <Chip key={h} pressed={duration === h * HOUR} onClick={() => onChange(start, start + h * HOUR)}>
            {h < 24 ? `${h} Std.` : h === 24 ? "1 Tag" : "2 Tage"}
          </Chip>
        ))}
      </div>
      <p className={invalid ? "text-red" : ""} aria-live="polite">
        {invalid ? (
          "Das Ende liegt vor dem Beginn."
        ) : (
          <>
            <strong>{rangeText(start, end)}</strong>, das sind {fmtDuration(duration)}.
          </>
        )}
      </p>
    </div>
  )
}

/**
 * One day, for the phone: a button that shows the date in German and opens the calendar in a bottom sheet.
 * Days are large enough to tap; choosing one closes the sheet.
 */
function DayField({
  id,
  label,
  value,
  min,
  invalid,
  onChange,
}: {
  id: string
  /** "Beginn" or "Ende". */
  label: string
  value: number
  /** Days before this one cannot be chosen. */
  min?: number
  invalid?: boolean
  /** Called with the start of the chosen day. */
  onChange: (day: number) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-invalid={invalid}
        aria-label={`${label}, Tag: ${longDate.format(value)}. Ändern`}
        onClick={() => setOpen(true)}
        className="inline-flex h-11 min-w-[168px] flex-1 items-center gap-2 rounded-control border border-line bg-surface px-3 text-left tabular-nums aria-invalid:border-red"
      >
        <CalendarDays className="size-5 shrink-0 text-ink-soft" aria-hidden />
        <span className="first-letter:uppercase">{fmtDate(value)}</span>
      </button>
      <Sheet open={open} onOpenChange={setOpen} title={`${label}: Tag wählen`} description={`Gewählt: ${longDate.format(value)}`}>
        <Calendar
          mode="single"
          required
          locale={de}
          defaultMonth={new Date(value)}
          selected={new Date(value)}
          disabled={min !== undefined ? { before: new Date(dayStart(min)) } : undefined}
          onSelect={(day) => {
            if (!day) return
            onChange(dayStart(day.getTime()))
            setOpen(false)
          }}
          className="w-full bg-surface p-0 [--cell-size:--spacing(11)]"
          classNames={{ root: "w-full" }}
        />
      </Sheet>
    </>
  )
}
