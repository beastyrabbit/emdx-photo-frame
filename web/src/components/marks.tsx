import { cn } from "cn"
import { BatteryCharging, Plug } from "lucide-react"
import type { Frame, HealthLevel, PendingState } from "@/api/types"
import { fmtDay, fmtTime, fmtWhen } from "@/lib/format"

/** Health as shape and colour together: dot = fine, triangle = soon, diamond = now, ring = waiting. */
export function StateMark({ level, children, className }: { level: HealthLevel | "wait" | "off"; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold", level === "bad" && "text-red", level === "wait" && "text-blue", className)}>
      <span
        aria-hidden
        className={cn(
          "shrink-0",
          level === "ok" && "size-2.5 rounded-full bg-green",
          level === "warn" && "h-[11px] w-3 bg-yellow [clip-path:polygon(50%_0,100%_100%,0_100%)]",
          level === "bad" && "size-[9px] rotate-45 rounded-[1px] bg-red",
          level === "wait" && "size-2.5 rounded-full border-[2.5px] border-blue",
          level === "off" && "size-2.5 rounded-full bg-ink-soft",
        )}
      />
      {children}
    </span>
  )
}

export function batteryLevel(percent: number): HealthLevel {
  return percent < 10 ? "bad" : percent < 20 ? "warn" : "ok"
}

/** Thin meter under a battery figure. */
export function Meter({ percent, className }: { percent: number; className?: string }) {
  const level = batteryLevel(percent)
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-sunken", className)} aria-hidden>
      <div
        className={cn("h-full min-w-1 rounded-full", level === "ok" && "bg-green", level === "warn" && "bg-yellow", level === "bad" && "bg-red")}
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

/** What a frame runs on, in one line: battery with outlook, charging, or mains power. */
export function powerLine(frame: Frame): string {
  if (frame.power === "dauerstrom" || !frame.battery) return "am Strom, immer erreichbar"
  if (frame.charging) return "lädt gerade, Änderungen gehen sofort raus"
  const b = frame.battery
  if (b.changesLeft !== null && b.changesLeft < 10) return `reicht nur noch für etwa ${b.changesLeft} Wechsel`
  return b.until ? `reicht voraussichtlich bis ${fmtDay(b.until)}` : ""
}

export function PowerFigure({ frame, size = "md" }: { frame: Frame; size?: "md" | "lg" }) {
  const big = size === "lg" ? "text-figure" : "text-[32px] leading-none"
  if (frame.power === "dauerstrom" || !frame.battery) {
    return (
      <div className="flex items-center gap-2">
        <Plug className="size-6 text-ink-soft" aria-hidden />
        <span className={cn("font-figures font-semibold", size === "lg" ? "text-[32px] leading-none" : "text-title")}>Dauerstrom</span>
      </div>
    )
  }
  const level = batteryLevel(frame.battery.percent)
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className={cn("font-figures font-semibold", big, level === "bad" && "text-red", level === "warn" && "text-yellow-ink")}>
          {frame.battery.percent} %
        </span>
        {frame.charging && <BatteryCharging className="size-5 self-center text-green" aria-label="lädt" />}
        <span className="text-small text-ink-soft">Akku, Stand {fmtWhen(frame.battery.at).replace("heute ", "")}</span>
      </div>
      <Meter percent={frame.battery.percent} />
    </div>
  )
}

export const PENDING_LABEL: Record<PendingState, string> = {
  eingestellt: "eingestellt",
  wartet: "wartet auf Rahmen",
  uebertragen: "übertragen",
  bestaetigt: "am Rahmen bestätigt",
  abweichend: "abweichend",
}

const STEP_OF: Record<PendingState, number> = { eingestellt: 0, wartet: 1, uebertragen: 2, bestaetigt: 3, abweichend: 3 }

/**
 * The path of a change in four dots: eingestellt, wartet auf Rahmen, übertragen, am Rahmen bestätigt.
 * Blue while it is on its way, green when the frame confirmed it, red when the frame says otherwise.
 */
export function ConfirmMark({
  state,
  at,
  note,
  className,
}: {
  state: PendingState
  at?: number
  /** How it got there, e.g. "am Strom" or "nach Knopfdruck". */
  note?: string
  className?: string
}) {
  const step = STEP_OF[state]
  const tone = state === "bestaetigt" ? "green" : state === "abweichend" ? "red" : "blue"
  const text = { green: "text-green", red: "text-red", blue: "text-blue" }[tone]
  const fill = { green: "bg-green border-green", red: "bg-red border-red", blue: "bg-blue border-blue" }[tone]
  const line = { green: "border-green", red: "border-red", blue: "border-blue" }[tone]
  return (
    <span className={cn("inline-flex items-center gap-2 text-small font-semibold", text, className)}>
      <span className="inline-flex items-center" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="inline-flex items-center">
            {i > 0 && <span className={cn("w-2.5 border-t-2", line, i > step && "border-dashed opacity-50")} />}
            <span
              className={cn(
                "size-2.5 rounded-full border-2",
                i <= step ? fill : cn(line, "bg-transparent opacity-60"),
                i === step && state === "abweichend" && "rotate-45 rounded-[1px]",
                i === step &&
                  (state === "wartet" || state === "uebertragen") &&
                  "motion-safe:animate-[breathe_2.4s_ease-in-out_infinite] shadow-[0_0_0_4px_var(--blue-wash)]",
              )}
            />
          </span>
        ))}
      </span>
      <span>
        {PENDING_LABEL[state]}
        {at ? <span className="font-normal">, {state === "eingestellt" || state === "wartet" ? `seit ${fmtTime(at)}` : fmtWhen(at)}</span> : null}
        {note ? <span className="font-normal">, {note}</span> : null}
      </span>
    </span>
  )
}

/** For a setting: the value the frame last reported, or that it has not confirmed yet. */
export function SettingMark({ confirmedAt, deviceValue }: { confirmedAt: number | null; deviceValue?: string }) {
  if (confirmedAt) return <ConfirmMark state="bestaetigt" at={confirmedAt} />
  return (
    <span className="grid gap-0.5">
      <ConfirmMark state="wartet" />
      {deviceValue && <span className="text-small text-ink-soft">Am Rahmen gilt noch: {deviceValue}</span>}
    </span>
  )
}

/** The same four dots, all empty: changed on this page, not saved, nothing on its way to the frame. */
export function UnsavedMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-small font-semibold text-ink", className)}>
      <span className="inline-flex items-center" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="inline-flex items-center">
            {i > 0 && <span className="w-2.5 border-t-2 border-dashed border-ink-soft opacity-60" />}
            <span className="size-2.5 rounded-full border-2 border-ink-soft" />
          </span>
        ))}
      </span>
      Noch nicht gespeichert
    </span>
  )
}

/**
 * Under a setting field. While the field holds a value that is not saved, the green mark must not
 * stand under it: it says "Noch nicht gespeichert" and names the value the frame really confirmed.
 */
export function SettingState({
  dirty,
  confirmedAt,
  saved,
  deviceValue,
}: {
  dirty: boolean
  confirmedAt: number | null
  /** The saved value, as text. */
  saved: string
  /** What the frame still runs on while the saved value has not arrived. */
  deviceValue?: string
}) {
  if (!dirty) return <SettingMark confirmedAt={confirmedAt} deviceValue={deviceValue} />
  return (
    <span className="grid gap-1">
      <UnsavedMark />
      <span className="flex items-baseline gap-2 text-small text-ink-soft">
        <span aria-hidden className={cn("size-2 shrink-0 translate-y-[-1px] rounded-full", confirmedAt ? "bg-green" : "border-2 border-blue")} />
        <span>
          {confirmedAt ? (
            <>
              Am Rahmen bestätigt: <strong className="font-semibold text-ink">{saved}</strong>
            </>
          ) : deviceValue ? (
            <>
              Am Rahmen gilt noch: <strong className="font-semibold text-ink">{deviceValue}</strong>. Gespeichert und unterwegs: {saved}
            </>
          ) : (
            <>Am Rahmen ist noch nichts bestätigt. Gespeichert und unterwegs: {saved}</>
          )}
        </span>
      </span>
    </span>
  )
}
