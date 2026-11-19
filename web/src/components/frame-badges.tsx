import { cn } from "cn"
import { Check, Clock, Hourglass, ListOrdered, PartyPopper, Plug, RefreshCwOff, Repeat, Send, Sparkles, Zap } from "lucide-react"
import type { Frame, FrameEvent, HealthLevel, PendingChange, PendingKind } from "@/api/types"
import { batteryLevel, powerLine } from "@/components/marks"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { fmtTime, fmtWhen, plural } from "@/lib/format"

// The state of a frame as small signs on and under its picture, so the overview needs no text blocks.
// Colour keeps its one meaning: red = now, yellow = soon, blue = waiting for the frame, green = confirmed.

export type BadgeTone = HealthLevel | "wait" | "plain"

const TONE: Record<BadgeTone, string> = {
  bad: "bg-red-wash text-red",
  warn: "bg-yellow-wash text-yellow-ink",
  wait: "bg-blue-wash text-blue",
  ok: "bg-green-wash text-green",
  plain: "bg-sunken text-ink",
}

/** A battery drawn with its real level, so the shape already says how full it is. */
export function BatteryGlyph({ percent, charging = false, className }: { percent: number; charging?: boolean; className?: string }) {
  const width = Math.max(1.5, (Math.min(100, percent) / 100) * 15)
  return (
    <svg viewBox="0 0 24 14" className={cn("h-3.5 w-6 shrink-0", className)} aria-hidden="true">
      <rect x="1" y="1.5" width="19" height="11" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="21.2" y="4.6" width="2" height="4.8" rx="1" fill="currentColor" />
      <rect x="3" y="3.5" width={width} height="7" rx="1" fill="currentColor" opacity={charging ? 0.45 : 1} />
      {charging && <path d="M11.6 2.2 7.4 7.6h3l-1 4.2 4.2-5.4h-3z" fill="currentColor" stroke="var(--surface)" strokeWidth="0.6" />}
    </svg>
  )
}

export interface FrameBadge {
  key: string
  tone: BadgeTone
  icon: React.ReactNode
  /** A short figure next to the sign: "78 %", "3". */
  figure?: string
  /** The whole sentence, for the tooltip and for screen readers. */
  label: string
}

const OFF_ICON: Partial<Record<PendingKind, React.ComponentType<{ className?: string }>>> = { reinigung: Sparkles, rhythmus: Clock, vorrat: ListOrdered }
const ICON = "size-3.5 shrink-0"

/** Everything worth a sign on a frame right now, the most urgent first. */
export function badgesOf(frame: Frame, changes: PendingChange[], event?: FrameEvent): FrameBadge[] {
  const list: FrameBadge[] = []
  if (frame.missedChanges > 0) {
    list.push({
      key: "verpasst",
      tone: "bad",
      icon: <RefreshCwOff className={ICON} aria-hidden />,
      figure: String(frame.missedChanges),
      label: `${plural(frame.missedChanges, "Wechsel", "Wechsel")} verpasst: der Rahmen hat sich nicht gemeldet`,
    })
  }
  if (frame.power === "dauerstrom" || !frame.battery) {
    list.push({ key: "strom", tone: "plain", icon: <Plug className={ICON} aria-hidden />, label: "Am Strom, immer erreichbar" })
  } else {
    const level = frame.charging ? "ok" : batteryLevel(frame.battery.percent)
    const line = powerLine(frame)
    list.push({
      key: "akku",
      tone: level === "ok" && !frame.charging ? "plain" : level,
      icon: <BatteryGlyph percent={frame.battery.percent} charging={frame.charging} />,
      figure: `${frame.battery.percent} %`,
      label: `Akku ${frame.battery.percent} %${line ? `, ${line}` : ""}`,
    })
  }
  for (const off of changes.filter((c) => c.state === "abweichend")) {
    const Icon = OFF_ICON[off.kind] ?? Sparkles
    list.push({
      key: `ab-${off.id}`,
      tone: "warn",
      icon: (
        <>
          <Icon className={ICON} aria-hidden />
          <span aria-hidden className="text-[13px] leading-none font-bold">
            ≠
          </span>
        </>
      ),
      label: `${frame.health.level === "warn" ? frame.health.title : `${off.title} weicht ab`}: eingestellt ${off.to}, am Rahmen ${off.deviceValue}`,
    })
  }
  if (frame.bufferLeft === 0 && (frame.current.pictureId || frame.current.card)) {
    list.push({ key: "vorrat", tone: "warn", icon: <Repeat className={ICON} aria-hidden />, label: "Vorrat aufgebraucht: er wiederholt seine letzten Bilder" })
  }
  if (event) {
    list.push({
      key: "event",
      tone: "plain",
      icon: <PartyPopper className={ICON} aria-hidden />,
      label: `Event „${event.name}“ läuft bis ${fmtWhen(event.end)}`,
    })
  }
  if (frame.justUpdated && frame.health.level === "ok") {
    list.push({ key: "aktuell", tone: "ok", icon: <Check className={ICON} aria-hidden />, label: `Gerade aktualisiert, ${fmtTime(frame.justUpdated.at)}` })
  }
  return list
}

/** How many changes are on their way to a frame, as the sign and the sentence that go with it. */
export function waitingOf(frame: Frame): { icon: React.ReactNode; figure: string; label: string } | null {
  if (!frame.pendingCount) return null
  return frame.nextOnline.immediate
    ? {
        icon: <Send className={ICON} aria-hidden />,
        figure: String(frame.pendingCount),
        label: plural(frame.pendingCount, "Änderung geht gerade raus", "Änderungen gehen gerade raus"),
      }
    : {
        icon: <Hourglass className={ICON} aria-hidden />,
        figure: String(frame.pendingCount),
        label: plural(frame.pendingCount, "Änderung wartet auf den Rahmen", "Änderungen warten auf den Rahmen"),
      }
}

const SHAPE = "inline-flex h-6 shrink-0 items-center gap-1 rounded-[7px] px-1.5 font-figures text-[15px] leading-none font-semibold"

export function Badge({ badge }: { badge: FrameBadge }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn(SHAPE, TONE[badge.tone])}>
          {badge.icon}
          {badge.figure && <span aria-hidden>{badge.figure}</span>}
          <span className="sr-only">{badge.label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="text-small">{badge.label}</TooltipContent>
    </Tooltip>
  )
}

/** The waiting sign is a button: it opens what waits for this frame. */
export function WaitingBadge({ frame, onOpen, className }: { frame: Frame; onOpen: () => void; className?: string }) {
  const w = waitingOf(frame)
  if (!w) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onOpen}
          aria-label={`${frame.name}: ${w.label}. Ansehen`}
          // The sign is small, the touch target around it is not.
          className={cn(SHAPE, TONE.wait, "relative ring-1 ring-blue/40 before:absolute before:-inset-2.5 hover:ring-blue", className)}
        >
          {w.icon}
          <span aria-hidden>{w.figure}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="text-small">{w.label}</TooltipContent>
    </Tooltip>
  )
}

/** The most urgent sign again, as a seal on the corner of the picture: problems stand out on a wall of eight. */
export function Seal({ badges, className }: { badges: FrameBadge[]; className?: string }) {
  const worst = badges.find((b) => b.tone === "bad") ?? badges.find((b) => b.tone === "warn")
  if (!worst) return null
  return (
    <span
      aria-hidden
      className={cn(
        "absolute -top-2 -right-2 z-10 grid size-6 place-items-center rounded-full shadow-[0_0_0_2px_var(--paper)] [&_svg]:size-3.5",
        worst.tone === "bad" ? "bg-red text-paper" : "bg-yellow text-[#191b1a]",
        className,
      )}
    >
      {worst.key === "akku" ? (
        <Zap className="fill-current" />
      ) : worst.key.startsWith("ab-") ? (
        <span className="text-[15px] leading-none font-bold">≠</span>
      ) : (
        worst.icon
      )}
    </span>
  )
}

/** What each sign means, for the "?" next to the switch and for the help page. */
export function BadgeLegend({ className }: { className?: string }) {
  const rows: [BadgeTone, React.ReactNode, string][] = [
    ["plain", <BatteryGlyph key="a" percent={78} />, "Akku und sein Stand. Gelb unter 20 %, rot unter 10 %"],
    ["ok", <BatteryGlyph key="b" percent={70} charging />, "lädt gerade"],
    ["plain", <Plug key="c" className={ICON} />, "am Strom, immer erreichbar"],
    ["bad", <RefreshCwOff key="d" className={ICON} />, "Wechsel verpasst: der Rahmen hat sich nicht gemeldet"],
    ["warn", <Sparkles key="e" className={ICON} />, "≠ der Rahmen meldet etwas anderes als eingestellt"],
    ["warn", <Repeat key="f" className={ICON} />, "Vorrat aufgebraucht, er wiederholt seine Bilder"],
    ["wait", <Hourglass key="g" className={ICON} />, "Änderungen warten auf den Rahmen. Antippen zeigt sie"],
    ["wait", <Send key="h" className={ICON} />, "Änderungen gehen gerade raus"],
    ["plain", <PartyPopper key="i" className={ICON} />, "ein Event läuft"],
    ["ok", <Check key="j" className={ICON} />, "gerade aktualisiert"],
  ]
  return (
    <ul className={cn("m-0 grid list-none gap-2 p-0", className)}>
      {rows.map(([tone, icon, text]) => (
        <li key={text} className="flex items-start gap-2.5">
          <span className={cn(SHAPE, TONE[tone], "mt-px min-w-9 justify-center")} aria-hidden>
            {icon}
          </span>
          <span>{text}</span>
        </li>
      ))}
    </ul>
  )
}
