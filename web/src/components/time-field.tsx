import { parseTime } from "@internationalized/date"
import { cn } from "cn"
import { TimeField as AriaTimeField, DateInput, DateSegment, I18nProvider } from "react-aria-components"

const pad = (n: number) => String(n).padStart(2, "0")

/**
 * A time of day, always in 24 hours ("15:00 Uhr"), whatever language the browser is set to.
 * Hour and minute are two fields: type the digits or use the arrow keys.
 */
export function TimeField({
  value,
  onChange,
  label,
  className,
  id,
}: {
  /** "HH:MM" */
  value: string
  onChange: (value: string) => void
  /** Read out with the hour and the minute field, e.g. "Beginn". */
  label: string
  className?: string
  id?: string
}) {
  return (
    <I18nProvider locale="de-DE">
      <AriaTimeField
        id={id}
        aria-label={label}
        value={parseTime(value)}
        onChange={(t) => t && onChange(`${pad(t.hour)}:${pad(t.minute)}`)}
        hourCycle={24}
        granularity="minute"
        shouldForceLeadingZeros
        className={cn("inline-flex items-center gap-2", className)}
      >
        <DateInput className="inline-flex h-11 items-center rounded-lg border border-input bg-surface px-3 text-body text-ink tabular-nums transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
          {(segment) => (
            <DateSegment
              segment={segment}
              className="rounded-[4px] px-0.5 caret-transparent outline-none data-[focused]:bg-blue data-[focused]:text-on-blue data-[type=literal]:px-0"
            />
          )}
        </DateInput>
        <span aria-hidden className="text-[15px] font-normal text-ink-soft">
          Uhr
        </span>
      </AriaTimeField>
    </I18nProvider>
  )
}
