import { cn } from "cn"
import { ChevronDown, ChevronLeft, CircleHelp, Info, Power, TriangleAlert } from "lucide-react"
import { Link } from "react-router"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/** Page head: where you are, a way back, and at most a couple of actions. */
export function PageHead({
  title,
  back,
  lead,
  children,
}: {
  title: string
  back?: { to: string; label: string }
  lead?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <header className="grid gap-2">
      {back && (
        <Link to={back.to} className="-ml-1.5 inline-flex h-9 w-fit items-center gap-0.5 text-[15px] font-semibold text-blue no-underline">
          <ChevronLeft className="size-5" aria-hidden />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <h1>{title}</h1>
        {children && <div className="flex flex-wrap gap-2">{children}</div>}
      </div>
      {lead && <p className="max-w-[62ch] text-lead text-ink-soft">{lead}</p>}
    </header>
  )
}

export function Section({
  title,
  aside,
  children,
  className,
}: {
  title?: React.ReactNode
  aside?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("grid min-w-0 gap-3", className)}>
      {(title || aside) && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          {title && <h2>{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  )
}

/** A small "?" that explains a word or a rule in two sentences. */
export function Hint({ children, label = "Erklärung" }: { children: React.ReactNode; label?: string }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={label}
        className="-m-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full align-middle text-ink-soft hover:text-ink"
      >
        <CircleHelp className="size-[18px]" aria-hidden />
      </PopoverTrigger>
      <PopoverContent className="w-72 bg-surface p-3 text-[15px] leading-snug font-normal text-ink">{children}</PopoverContent>
    </Popover>
  )
}

const BANNER = {
  bad: { box: "border-red bg-red-wash", tone: "text-red", Icon: Power },
  warn: { box: "border-yellow bg-yellow-wash", tone: "text-yellow-ink", Icon: TriangleAlert },
  wait: { box: "border-blue bg-blue-wash", tone: "text-blue", Icon: Info },
  plain: { box: "border-line bg-surface", tone: "text-ink", Icon: Info },
}

/** The first line says what to do, the rest why. */
export function Banner({
  level,
  title,
  children,
  icon,
  className,
}: {
  level: keyof typeof BANNER
  title: React.ReactNode
  children?: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  className?: string
}) {
  const b = BANNER[level]
  const Icon = icon ?? b.Icon
  return (
    <div className={cn("grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-control border px-4 py-3", b.box, className)}>
      <Icon className={cn("mt-0.5 size-5", b.tone)} aria-hidden />
      <strong className={cn("font-semibold", b.tone)}>{title}</strong>
      {children && <div className="col-start-2 grid gap-2 text-[15px]">{children}</div>}
    </div>
  )
}

/** Label and value rows. */
export function Facts({ rows, className }: { rows: [string, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[minmax(0,8.5em)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[15px]", className)}>
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-soft">{k}</dt>
          <dd className="m-0 wrap-anywhere">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A section that folds. Its closed line already carries the state, so closed folds still inform. */
export function Fold({
  title,
  summary,
  tone,
  defaultOpen = false,
  children,
}: {
  title: string
  summary?: React.ReactNode
  tone?: "bad" | "warn"
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="group/fold border-t border-line last:border-b">
      <CollapsibleTrigger className="flex min-h-14 w-full items-center gap-3 py-2 text-left">
        <span className="grid flex-1 gap-0.5">
          <span className="text-lead font-semibold">{title}</span>
          {summary && <span className={cn("text-[15px] text-ink-soft", tone === "bad" && "text-red", tone === "warn" && "text-yellow-ink")}>{summary}</span>}
        </span>
        <ChevronDown className="size-5 shrink-0 text-ink-soft transition-transform group-data-[state=open]/fold:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-3 pb-5">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Filter chip: pressed = on. */
export function Chip({ pressed, onClick, children, count }: { pressed: boolean; onClick: () => void; children: React.ReactNode; count?: number }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[15px] whitespace-nowrap transition-colors",
        pressed ? "border-ink bg-ink text-paper" : "border-line text-ink hover:bg-sunken",
      )}
    >
      {children}
      {count !== undefined && <span className={pressed ? "opacity-70" : "text-ink-soft"}>{count}</span>}
    </button>
  )
}

/** A row of chips. It wraps: nothing runs off the side, whatever the width. */
export function ChipRow({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <fieldset aria-label={label} className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
      {children}
    </fieldset>
  )
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="grid justify-items-start gap-3 rounded-control border border-dashed border-line px-4 py-6">
      <strong>{title}</strong>
      {children}
    </div>
  )
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: React.ReactNode
  hint?: React.ReactNode
  error?: string
  children: React.ReactNode
  htmlFor?: string
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="font-semibold">
        {label}
      </label>
      {children}
      {error ? <p className="text-small text-red">{error}</p> : hint ? <p className="text-small text-ink-soft">{hint}</p> : null}
    </div>
  )
}

/** A switch or a choice with its explanation beside it. */
export function SettingRow({ title, text, children }: { title: React.ReactNode; text?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="grid gap-0.5">
        <span className="font-semibold">{title}</span>
        {text && <span className="text-[15px] text-ink-soft">{text}</span>}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  )
}
