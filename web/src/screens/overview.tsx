import { cn } from "cn"
import { ChevronRight, Images, Inbox, PartyPopper, Power } from "lucide-react"
import { useState } from "react"
import { Link, useSearchParams } from "react-router"
import { useOverview, usePending } from "@/api/hooks"
import { usePictureMap } from "@/api/lookups"
import type { Frame, FrameEvent, Group, Overview, PendingChange } from "@/api/types"
import { Hint, PageHead } from "@/components/bits"
import { Badge, BadgeLegend, badgesOf, Seal, WaitingBadge } from "@/components/frame-badges"
import { StateMark } from "@/components/marks"
import { PENDING_ICON, PendingQueue, pendingShort } from "@/components/pending-queue"
import { FrameObject, PictureImage } from "@/components/picture"
import { Segmented } from "@/components/segmented"
import { Sheet } from "@/components/sheet"
import { FramePanel } from "@/components/test-card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { everyText } from "@/lib/cadence"
import { whenOnline } from "@/lib/explain"
import { fmtWhen, listDe, plural } from "@/lib/format"

type View = "jetzt" | "naechstes"

const lowBattery = (f: Frame) => f.health.level === "ok" && !!f.battery && !f.charging && f.battery.percent < 20

function headline(frames: Frame[]): { title: string; lead: string } {
  // Every frame that is not simply fine counts: one that is gone, and one that reports something else than was set.
  const need = frames.filter((f) => f.health.level !== "ok")
  const rest = frames.length - need.length
  if (need.length) {
    const others = rest === 0 ? "" : rest === 1 ? "Der andere Rahmen läuft wie geplant." : `Die anderen ${rest} Rahmen laufen wie geplant.`
    return { title: need.length === 1 ? `${need[0].name} braucht dich.` : `${need.length} Rahmen brauchen dich.`, lead: others }
  }
  return { title: "Alles läuft.", lead: `Alle ${frames.length} Rahmen haben sich nach ihrem letzten Wechsel gemeldet.` }
}

interface Todo {
  key: string
  level: "bad" | "warn" | "plain"
  to: string
  who: string
  what: string
  icon?: React.ComponentType<{ className?: string }>
}

/** What needs the owner, one line each. A running Event or a full battery is no task: that is on the frames. */
function todosOf(data: Overview, pending: PendingChange[]): Todo[] {
  const list: Todo[] = []
  for (const f of data.frames.filter((x) => x.health.level === "bad")) {
    const empty = f.battery && !f.charging && f.battery.percent < 10
    list.push({
      key: f.id,
      level: "bad",
      to: `/rahmen/${f.id}`,
      who: f.name,
      what: f.missedChanges > 0 ? `Knopf drücken${empty ? ", dann laden" : ""}` : f.health.title,
      icon: Power,
    })
  }
  for (const f of data.frames.filter((x) => x.health.level === "warn")) {
    const off = pending.find((p) => p.frameId === f.id && p.state === "abweichend")
    list.push({
      key: f.id,
      level: "warn",
      to: off ? `/rahmen/${f.id}#aenderungen` : `/rahmen/${f.id}`,
      who: f.name,
      what: off ? `${f.health.title}: entscheiden` : f.health.title,
    })
  }
  for (const f of data.frames.filter(lowBattery)) {
    list.push({ key: `akku-${f.id}`, level: "warn", to: `/rahmen/${f.id}`, who: f.name, what: `bald laden, Akku ${f.battery?.percent} %` })
  }
  for (const n of data.notes) {
    list.push({ key: n.text, level: "warn", to: n.link ?? "/gruppen", who: "Zu wenige Bilder", what: n.text.split(". ")[0].replace(/\.$/, ""), icon: Images })
  }
  if (data.inboxCount > 0) {
    list.push({
      key: "eingang",
      level: "plain",
      to: "/bibliothek?ansicht=eingang",
      who: "Eingang",
      what: plural(data.inboxCount, "neues Bild", "neue Bilder"),
      icon: Inbox,
    })
  }
  return list
}

/** The slim strip at the top: only what really is a task, each one line and one tap. */
function NeedsYou({ todos }: { todos: Todo[] }) {
  if (!todos.length) return null
  return (
    <nav aria-label="Braucht dich" className="overflow-hidden rounded-control border border-line bg-line">
      <ul className="m-0 grid list-none gap-px p-0 min-[900px]:grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">
        {todos.map((t) => {
          const Icon = t.icon
          return (
            <li key={t.key} className="bg-surface">
              <Link to={t.to} className="flex min-h-11 items-center gap-2.5 py-1.5 pr-1.5 pl-3 text-[15px] leading-snug text-ink no-underline hover:bg-sunken">
                {Icon ? (
                  <Icon className={cn("size-[18px] shrink-0", t.level === "bad" ? "text-red" : t.level === "warn" ? "text-yellow-ink" : "text-blue")} />
                ) : (
                  <StateMark level={t.level === "plain" ? "wait" : t.level} className="w-[18px] justify-center">
                    {null}
                  </StateMark>
                )}
                <span className="min-w-0 flex-1">
                  <strong className={cn("font-semibold", t.level === "bad" && "text-red")}>{t.who}</strong> <span>{t.what}</span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-ink-soft" aria-hidden />
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

const PICTURE_WIDTH = { hoch: "w-[72px] min-[900px]:w-[150px]", quer: "w-full max-w-[112px] min-[900px]:w-[230px] min-[900px]:max-w-none" }

/** The frame with the picture it shows after the current one. Hatched while that is only probable. */
function NextPanel({ frame, className }: { frame: Frame; className?: string }) {
  const pictures = usePictureMap()
  const next = frame.upNext
  const picture = next ? pictures.get(next.pictureId) : undefined
  return (
    <FrameObject
      orientation={frame.orientation}
      unsure={!!next && (next.state === "geplant" || next.uncertain)}
      className={className}
      label={picture ? `Als Nächstes auf ${frame.name}: ${picture.title}` : `${frame.name}: noch offen, was als Nächstes kommt`}
    >
      {picture ? <PictureImage picture={picture} byId={pictures} /> : next ? <Skeleton className="size-full rounded-none" /> : null}
    </FrameObject>
  )
}

function nextCaption(frame: Frame): string {
  const next = frame.upNext
  if (!next) return "noch offen"
  if (next.state === "wartet" && frame.nextOnline.immediate) return "geht gerade raus"
  return `${next.uncertain ? "frühestens" : "ab"} ${fmtWhen(next.at)}`
}

function FrameTile({
  frame,
  event,
  groupName,
  view,
  changes,
  onWaiting,
}: {
  frame: Frame
  event?: FrameEvent
  groupName: string
  view: View
  /** This frame's changes that the frame has not confirmed yet. */
  changes: PendingChange[]
  onWaiting: () => void
}) {
  const pictures = usePictureMap()
  const { card, pictureId } = frame.current
  const badges = badgesOf(frame, changes, event)
  const next = frame.upNext ? pictures.get(frame.upNext.pictureId) : undefined
  const now = view === "jetzt"
  const caption = !now
    ? nextCaption(frame)
    : card
      ? `${card.kind === "erkennungsbild" ? "Erkennungsbild" : "Testbild"} bis ${fmtWhen(card.until)}`
      : !pictureId
        ? "noch kein Bild von hier"
        : frame.current.unsure
          ? "wahrscheinlich noch dieses Bild"
          : `seit ${fmtWhen(frame.current.since)}`
  // "Als Nächstes" shows what is on its way; the state of the frame itself stays in "Jetzt".
  const shown = now ? badges : badges.filter((b) => b.key === "event" || b.key === "vorrat" || b.key.startsWith("ab-"))
  const waiting = changes.filter((c) => c.state !== "abweichend")

  return (
    <article className="grid content-start justify-items-center gap-1.5 text-center">
      {/* The frame hangs from the rail above it. */}
      <div className="flex h-[148px] w-full flex-col items-center min-[900px]:h-[296px]">
        {/* Landscape frames hang lower on a longer cord, so every frame sits right above its name. */}
        <span className="w-px flex-1 bg-ink-soft" aria-hidden />
        <Link to={`/rahmen/${frame.id}`} aria-label={`${frame.name} öffnen`} className={cn("relative block shrink-0", PICTURE_WIDTH[frame.orientation])}>
          {now ? <FramePanel frame={frame} groupName={groupName} className="w-full" /> : <NextPanel frame={frame} className="w-full" />}
          {now && <Seal badges={badges} />}
        </Link>
      </div>

      <h3 className="text-[15px] leading-tight min-[900px]:text-lead">
        <Link to={`/rahmen/${frame.id}`} className="text-ink no-underline hover:underline">
          {frame.name}
        </Link>
      </h3>
      <p className={cn("w-full text-[12px] leading-snug text-ink-soft min-[900px]:text-small", !now && frame.upNext?.state === "wartet" && "text-blue")}>
        {caption}
        {!now && next && <span className="mx-auto block truncate text-ink-soft min-[900px]:max-w-[230px]">{next.title}</span>}
      </p>

      <div className="flex flex-wrap items-center justify-center gap-1">
        {shown.map((b) => (
          <Badge key={b.key} badge={b} />
        ))}
        <WaitingBadge frame={frame} onOpen={onWaiting} />
      </div>

      {/* Wide screens have room for the words behind the signs. */}
      <div className="hidden w-full max-w-[280px] gap-0.5 text-[15px] min-[900px]:grid">
        {now ? (
          <>
            {frame.health.level !== "ok" && (
              <p className={frame.health.level === "bad" ? "font-semibold text-red" : "text-yellow-ink"}>
                {frame.health.title}
                {frame.health.level === "warn" && frame.health.text ? `: ${frame.health.text}` : ""}
              </p>
            )}
          </>
        ) : (
          waiting.length > 0 && (
            <>
              <ul className="m-0 grid list-none justify-items-center gap-0.5 p-0">
                {waiting.slice(0, 3).map((c) => {
                  const Icon = PENDING_ICON[c.kind]
                  return (
                    <li key={c.id} className="flex items-center gap-2">
                      <Icon className="size-4 shrink-0 text-blue" aria-hidden />
                      <span className="truncate">{pendingShort(c)}</span>
                    </li>
                  )
                })}
              </ul>
              {waiting.length > 3 && <p className="text-small text-ink-soft">und {waiting.length - 3} weitere</p>}
              <p className="text-small text-ink-soft">{frame.nextOnline.immediate ? "geht gerade raus" : whenOnline(frame)}</p>
            </>
          )
        )}
      </div>
    </article>
  )
}

function GroupBlock({
  group,
  frames,
  events,
  view,
  pending,
  onWaiting,
}: {
  group: Group
  frames: Frame[]
  events: FrameEvent[]
  view: View
  pending: PendingChange[]
  onWaiting: (frameId: string) => void
}) {
  const running = events.filter((e) => e.state === "laeuft" && frames.some((f) => f.eventId === e.id))
  return (
    <section className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2>{group.name}</h2>
        <Link to={`/gruppen/${group.id}`} className="inline-flex min-h-9 items-center gap-0.5 text-[15px] text-blue no-underline">
          {listDe(group.albums)}
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      </div>
      {running.map((e) => (
        <Link
          key={e.id}
          to={`/events/${e.id}`}
          className="-mt-2 inline-flex min-h-9 w-fit items-center gap-1.5 text-[15px] text-ink no-underline hover:underline"
        >
          <PartyPopper className="size-4 shrink-0" aria-hidden />
          Event „{e.name}“ bis {fmtWhen(e.end)}, {everyText(e.everyMin)} ein neues Bild
        </Link>
      ))}
      <div className="grid grid-cols-3 gap-x-2 gap-y-6 border-t-2 border-ink min-[900px]:grid-cols-[repeat(auto-fill,minmax(210px,1fr))] min-[900px]:gap-x-6">
        {frames.map((f) => (
          <FrameTile
            key={f.id}
            frame={f}
            groupName={group.name}
            event={events.find((e) => e.id === f.eventId)}
            view={view}
            changes={pending.filter((p) => p.frameId === f.id && p.state !== "bestaetigt")}
            onWaiting={() => onWaiting(f.id)}
          />
        ))}
      </div>
    </section>
  )
}

export function OverviewScreen() {
  const { data } = useOverview()
  const pending = usePending()
  const [params, setParams] = useSearchParams()
  const [waitingFor, setWaitingFor] = useState<string | null>(null)
  if (!data) return <OverviewSkeleton />
  const view: View = params.get("ansicht") === "naechstes" ? "naechstes" : "jetzt"
  const { frames, groups, events } = data
  const head = headline(frames)
  const all = pending.data ?? []
  const open = all.filter((p) => p.state !== "bestaetigt")
  const waitingFrame = frames.find((f) => f.id === waitingFor)
  const setView = (v: View) => {
    const next = new URLSearchParams(params)
    if (v === "naechstes") next.set("ansicht", "naechstes")
    else next.delete("ansicht")
    setParams(next, { replace: true })
  }

  return (
    <div data-wide className="grid gap-6">
      <PageHead title={head.title} lead={head.lead}>
        <span className="self-end text-small text-ink-soft">Stand {fmtWhen(data.at)}</span>
      </PageHead>

      <NeedsYou todos={todosOf(data, all)} />

      <div className="flex items-center gap-2">
        <Segmented<View>
          label="Was die Rahmen zeigen"
          value={view}
          onChange={setView}
          className="flex-1 min-[560px]:w-[340px] min-[560px]:flex-none"
          options={[
            { value: "jetzt", label: "Jetzt" },
            {
              value: "naechstes",
              label: (
                <span className="inline-flex items-center gap-2">
                  Als Nächstes
                  {open.length > 0 && (
                    <span className="grid h-5 min-w-5 place-items-center rounded-full bg-blue px-1 text-[12px] leading-none font-bold text-on-blue">
                      {open.length}
                      <span className="sr-only"> Änderungen unterwegs</span>
                    </span>
                  )}
                </span>
              ),
            },
          ]}
        />
        <Hint label="Was bedeuten die Zeichen?">
          <p className="mb-2">
            {view === "jetzt"
              ? "Jeder Rahmen mit dem Bild, das gerade hängt. Die Zeichen darunter sagen, wie es ihm geht."
              : "Jeder Rahmen mit dem Bild, das als Nächstes kommt, und mit dem, was noch zu ihm unterwegs ist. Gestreift heißt: nur wahrscheinlich."}
          </p>
          <BadgeLegend />
        </Hint>
      </div>

      {groups.map((g) => (
        <GroupBlock
          key={g.id}
          group={g}
          frames={frames.filter((f) => f.groupId === g.id)}
          events={events}
          view={view}
          pending={all}
          onWaiting={setWaitingFor}
        />
      ))}

      {view === "naechstes" && !open.length && <p className="text-ink-soft">Nichts unterwegs. Alle Rahmen haben, was du eingestellt hast.</p>}

      <Sheet
        open={!!waitingFrame}
        onOpenChange={(o) => !o && setWaitingFor(null)}
        title={waitingFrame ? `Unterwegs zu ${waitingFrame.name}` : "Unterwegs"}
        description={
          waitingFrame?.nextOnline.immediate
            ? "Dieser Rahmen ist immer erreichbar. Änderungen gehen sofort raus und stehen hier, bis er sie bestätigt hat."
            : "Die Änderungen kommen zusammen an, sobald sich der Rahmen meldet. Bis dahin kannst du jede zurücknehmen."
        }
      >
        {waitingFrame && (
          <>
            <PendingQueue frame={waitingFrame} changes={all.filter((p) => p.frameId === waitingFrame.id)} compact />
            <Button asChild variant="outline">
              <Link to={`/rahmen/${waitingFrame.id}`}>{waitingFrame.name} öffnen</Link>
            </Button>
          </>
        )}
      </Sheet>
    </div>
  )
}

function OverviewSkeleton() {
  return (
    <div data-wide className="grid gap-6" aria-busy="true">
      <div className="grid gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-5 w-80 max-w-full" />
      </div>
      <Skeleton className="h-11 w-full" />
      {[0, 1].map((g) => (
        <div key={g} className="grid grid-cols-3 gap-x-2 min-[900px]:gap-x-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="grid justify-items-center gap-2 pt-5">
              <Skeleton className="aspect-9/16 w-[72px] rounded-picture min-[900px]:w-[150px]" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
