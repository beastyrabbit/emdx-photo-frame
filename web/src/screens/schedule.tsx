import { cn } from "cn"
import { ChevronRight, Link2, Lock, Palette, PartyPopper, Pin, ScanLine } from "lucide-react"
import { useState } from "react"
import { Link, useSearchParams } from "react-router"
import { api } from "@/api"
import { useAct, useDeck, useGroups, useOverview, usePending, useTimeline } from "@/api/hooks"
import { useFrameMap, usePictureMap } from "@/api/lookups"
import type { DeckCard, Frame, Orientation, TimelineItem } from "@/api/types"
import { Banner, Empty, Hint, PageHead, Section } from "@/components/bits"
import { FramePicker } from "@/components/frame-picker"
import { PendingQueue } from "@/components/pending-queue"
import { Thumb } from "@/components/picture"
import { Segmented } from "@/components/segmented"
import { ShowSheet } from "@/components/show-sheet"
import { SortableList } from "@/components/sortable"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { everyText } from "@/lib/cadence"
import { transferNote, whenOnline } from "@/lib/explain"
import { fmtWhen, plural } from "@/lib/format"

function PictureLine({
  pictureId,
  when,
  note,
  tone,
  right,
  wrap = false,
}: {
  pictureId: string
  when: string
  note?: React.ReactNode
  tone?: "green" | "blue"
  right?: React.ReactNode
  /** Let the line under the title run over several lines: for an explanation instead of a time. */
  wrap?: boolean
}) {
  const byId = usePictureMap()
  const p = byId.get(pictureId)
  if (!p) return <Skeleton className="h-12 w-full" />
  return (
    <div className="flex items-center gap-3">
      <Thumb picture={p} byId={byId} className={p.orientation === "hoch" ? "w-8" : "w-14"} />
      <div className="grid min-w-0 flex-1">
        <Link to={`/bild/${p.id}`} className="truncate font-semibold text-ink no-underline hover:underline">
          {p.title}
        </Link>
        <span className={cn("text-small text-ink-soft", !wrap && "truncate", tone === "green" && "font-semibold text-green", tone === "blue" && "text-blue")}>
          {p.source === "kunst" && <Palette className="mr-1 inline size-3.5 -translate-y-px" aria-label="Kunstwerk" />}
          {when}
          {note ? <> {note}</> : null}
        </span>
      </div>
      {right}
    </div>
  )
}

/** What one frame shows next, and the order it can still be given. Used on the Zeitplan page and on the frame's own page. */
export function FrameTimeline({ frame }: { frame: Frame }) {
  const { data } = useTimeline(frame.id)
  const pending = usePending(frame.id)
  const byId = usePictureMap()
  const { data: overview } = useOverview()
  const move = useAct(({ pictureId, toIndex }: { pictureId: string; toIndex: number }) => api.moveTimelineItem(frame.id, pictureId, toIndex))
  const [showId, setShowId] = useState<string | null>(null)
  if (!data) return <Skeleton className="h-64 w-full" />
  const event = overview?.events.find((e) => e.id === frame.eventId)
  const fixed = data.filter((i) => i.locked)
  const movable = data.filter((i) => !i.locked)
  const open = (pending.data ?? []).filter((p) => p.state !== "bestaetigt")
  // What is said about a picture follows the change that put it there: on a frame that is always
  // reachable it "geht gerade raus" and is then confirmed; only a sleeping frame is waited for.
  const immediate = frame.nextOnline.immediate
  const noteOf = (i: TimelineItem) =>
    i.state === "wartet" ? (
      <span className={cn("inline-flex items-center gap-1", i.change ? "text-blue" : "text-green")}>
        <Pin className="size-3" aria-hidden />
        von dir gesetzt, {transferNote(i.change, immediate)}
      </span>
    ) : i.state === "am-rahmen" ? (
      i.pinned && i.change ? (
        `liegt am Rahmen bereit, neue Reihenfolge ${transferNote(i.change, immediate)}`
      ) : (
        "liegt am Rahmen bereit"
      )
    ) : (
      "wahrscheinlich, aus dem Stapel"
    )
  const card = frame.current.card

  return (
    <div className="grid gap-7">
      {open.length > 0 && <PendingQueue frame={frame} changes={pending.data ?? []} compact />}
      {event && (
        <Banner level="plain" title={`Event „${event.name}“ bis ${fmtWhen(event.end)}`}>
          <p>
            Bis dahin wechselt {frame.name} {everyText(event.everyMin)} durch die Bilder des Events. <Link to={`/events/${event.id}`}>Event ansehen</Link>
          </p>
        </Banner>
      )}

      <Section
        title="Steht fest"
        aside={
          <Hint>
            Ein Rahmen mit Akku schläft. Er wechselt zuerst zu seinem nächsten Bild und meldet sich erst danach. Dieses Bild lässt sich deshalb nicht mehr
            verschieben. Alles danach kannst du noch ändern, auch Bilder, die schon in seinem Vorrat liegen. Ein Rahmen am Strom oder am Ladegerät ist immer
            erreichbar: dort steht nur fest, was gerade hängt.
          </Hint>
        }
      >
        <ol className="m-0 list-none p-0">
          {/* A test card or a frame that has nothing from here yet: no picture hangs, and the list says so. */}
          {!frame.current.pictureId && (
            <li className="flex items-center gap-1 border-t border-line py-2 last:border-b">
              <span className="grid h-11 w-8 shrink-0 place-items-center text-ink-soft">
                {card ? (
                  <span className="size-2.5 rounded-full bg-green" aria-hidden />
                ) : (
                  <span className="size-2.5 rounded-full border-2 border-blue" aria-hidden />
                )}
              </span>
              <ScanLine className="mx-1.5 size-5 shrink-0 text-ink-soft" aria-hidden />
              <div className="grid min-w-0 flex-1">
                <span className="font-semibold">{card ? (card.kind === "testbild" ? "Testbild" : "Erkennungsbild") : "Noch kein Bild von hier"}</span>
                <span className={cn("text-small", card ? "font-semibold text-green" : "text-ink-soft")}>
                  {card
                    ? `hängt seit ${fmtWhen(frame.current.since)}, bis ${fmtWhen(card.until)}`
                    : `Die ersten Bilder kommen mit der ersten Meldung: ${whenOnline(frame)}`}
                </span>
              </div>
            </li>
          )}
          {fixed.map((i) => (
            <li key={`${i.pictureId}:${i.at}`} className="flex items-center gap-1 border-t border-line py-2 last:border-b">
              <span className="grid h-11 w-8 shrink-0 place-items-center text-ink-soft" title="Fest: liegt schon am Rahmen">
                {i.state === "haengt" ? <span className="size-2.5 rounded-full bg-green" aria-hidden /> : <Lock className="size-4" aria-label="fest" />}
              </span>
              <div className="min-w-0 flex-1">
                <PictureLine
                  pictureId={i.pictureId}
                  when={i.state === "haengt" ? (frame.current.unsure ? "hängt wahrscheinlich noch" : `hängt seit ${fmtWhen(i.at)}`) : `ab ${fmtWhen(i.at)}`}
                  tone={i.state === "haengt" ? "green" : undefined}
                  note={i.eventId && i.state !== "haengt" ? "(Event)" : undefined}
                />
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Danach" aside={<span className="text-small text-ink-soft">Reihenfolge änderbar</span>}>
        <p className="text-[15px] text-ink-soft">
          {frame.nextOnline.immediate
            ? `${frame.name} ist immer erreichbar: eine neue Reihenfolge geht sofort raus.`
            : `Eine neue Reihenfolge bekommt ${frame.name}, wenn er sich das nächste Mal meldet: ${whenOnline(frame)}.`}{" "}
          Zieh die Bilder am Griff oder nimm die Pfeile. Beim Verschieben geht kein Bild verloren, nur die Reihenfolge ändert sich.
        </p>
        {movable.length === 0 ? (
          <Empty title="Der Stapel dieser Gruppe ist leer">
            <p className="text-ink-soft">Der Rahmen behält seine Bilder länger, bis wieder welche frei sind.</p>
          </Empty>
        ) : (
          <SortableList
            items={movable.map((i) => ({ id: i.pictureId, label: byId.get(i.pictureId)?.title ?? "Bild", item: i }))}
            onMove={(pictureId, toIndex) => move.mutate({ pictureId, toIndex })}
            render={({ item }, index) => (
              <PictureLine
                pictureId={item.pictureId}
                when={`ab ${fmtWhen(item.at)},`}
                note={noteOf(item)}
                right={
                  index > 0 ? (
                    <Button variant="ghost" size="sm" className="hidden shrink-0 min-[560px]:inline-flex" onClick={() => setShowId(item.pictureId)}>
                      Zeigen
                    </Button>
                  ) : undefined
                }
              />
            )}
          />
        )}
      </Section>
      <ShowSheet pictureIds={showId ? [showId] : []} open={!!showId} onOpenChange={(o) => !o && setShowId(null)} frameId={frame.id} />
    </div>
  )
}

const CARD_TEXT: Record<DeckCard["state"], string> = {
  haengt: "hängt gerade",
  vorgemerkt: "vorgemerkt",
  stapel: "im Stapel",
  gezeigt: "gezeigt in dieser Runde",
}

export function DeckView({ groupId, orientation }: { groupId: string; orientation: Orientation }) {
  const { data } = useDeck(groupId, orientation)
  const byId = usePictureMap()
  const frames = useFrameMap()
  const groups = useGroups()
  const move = useAct(({ pictureId, toIndex }: { pictureId: string; toIndex: number }) => api.moveDeckCard(groupId, orientation, pictureId, toIndex))
  const [all, setAll] = useState(false)
  if (!data) return <Skeleton className="h-64 w-full" />
  const name = (id: string | null) => (id ? (frames.get(id)?.name ?? "") : "")
  const title = (id: string | null) => (id ? (byId.get(id)?.title ?? "ein Bild") : "ein Bild")
  const atFrames = data.cards.filter((c) => c.state === "haengt" || c.state === "vorgemerkt")
  // Pictures are shared between groups with a common album. One that a frame of another group has is locked
  // here too, but it is not part of this group's schedule: it gets its own list.
  const here = (c: DeckCard) => (c.frameId ? frames.get(c.frameId)?.groupId === groupId : false)
  const locked = atFrames.filter(here)
  const elsewhere = atFrames.filter((c) => !here(c))
  // A real place on a frame, as opposed to a lock that only follows from a combined picture.
  const places = locked.filter((c) => !c.sharedWith)
  const lockedFrames = [...new Set(locked.map((c) => c.frameId))].flatMap((id) => (id && frames.get(id) ? [frames.get(id) as Frame] : []))
  const groupOf = (frameId: string | null) => groups.data?.find((g) => g.frameIds.includes(frameId ?? ""))?.name
  /** Own places in the order the frame shows them; a picture that only shares a lock follows the one that holds the place. */
  const rowsOf = (frameId: string) => {
    const mine = locked.filter((c) => c.frameId === frameId)
    const own = mine.filter((c) => !c.sharedWith).sort((a, b) => (a.expectedAt ?? 0) - (b.expectedAt ?? 0))
    const shared = mine.filter((c) => c.sharedWith)
    return [
      ...own.flatMap((c) => [c, ...shared.filter((s) => s.sharedWith === c.pictureId)]),
      ...shared.filter((s) => !own.some((c) => c.pictureId === s.sharedWith)),
    ]
  }
  const pile = data.cards.filter((c) => c.state === "stapel")
  const shown = data.cards.filter((c) => c.state === "gezeigt")
  const visible = all ? pile : pile.slice(0, 12)
  if (!data.cards.length) {
    return (
      <Empty title={`Keine Bilder im ${orientation === "hoch" ? "Hochformat" : "Querformat"}`}>
        <p className="text-ink-soft">Zu den Alben dieser Gruppe gibt es noch kein passendes Bild.</p>
      </Empty>
    )
  }
  return (
    <div className="grid gap-6">
      {data.shortBy > 0 && (
        <Banner level="warn" title={`Es fehlen ${plural(data.shortBy, "Bild", "Bilder")}`}>
          <p>
            Für alle Rahmen dieser Gruppe samt Vorrat reichen die freien Bilder nicht. Bis dahin bleiben Bilder länger hängen. Mehr Alben zur Gruppe nehmen
            hilft.
          </p>
        </Banner>
      )}
      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-2">
          <h3>An den Rahmen ({places.length})</h3>
          <Hint label="Warum sind diese Bilder fest?">
            Ein Rahmen mit Akku wechselt zu seinem nächsten Bild, bevor er sich meldet. Bei ihm stehen deshalb zwei Bilder fest: das, das gerade hängt, und das
            nächste. Bei einem Rahmen am Strom oder am Ladegerät steht nur fest, was gerade hängt. Feste Bilder tragen ein Schloss. Ein kombiniertes Bild und
            die Bilder, aus denen es besteht, sperren sich gegenseitig: nur eines von ihnen hat den Platz am Rahmen, die anderen stehen eingerückt darunter.
          </Hint>
        </div>
        <p className="text-[15px] text-ink-soft">
          Diese Bilder hängen gerade oder sind für Rahmen dieser Gruppe vorgemerkt. Im Stapel lassen sie sich nicht mehr verschieben. Spätere Bilder im Vorrat
          kannst du im Zeitplan des jeweiligen Rahmens verschieben.
        </p>
        {lockedFrames.map((f) => (
          <div key={f.id} className="grid gap-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <h4 className="font-semibold">
                {f.name} <span className="text-small font-normal text-ink-soft">{f.nextOnline.immediate ? "immer erreichbar" : "Akku, schläft"}</span>
              </h4>
              <Link to={`/zeitplan?rahmen=${f.id}`} className="inline-flex min-h-11 items-center text-[15px] font-semibold text-blue">
                Im Zeitplan von {f.name} verschieben
              </Link>
            </div>
            <ol className="m-0 list-none p-0">
              {rowsOf(f.id).map((c) =>
                c.sharedWith ? (
                  // No place of its own: it is only locked along with the picture above it.
                  <li key={c.pictureId} className="flex items-center gap-1 border-t border-dashed border-line py-2 pl-6 last:border-b last:border-solid">
                    <span className="grid h-11 w-8 shrink-0 place-items-center text-ink-soft">
                      <Link2 className="size-4" aria-label="mit gesperrt" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <PictureLine
                        pictureId={c.pictureId}
                        wrap
                        when={`Wegen ${byId.get(c.pictureId)?.combo ? "eines enthaltenen Bildes" : "des kombinierten Bildes"} gesperrt („${title(c.sharedWith)}“). Kein zusätzlicher Platz im Zeitplan.`}
                      />
                    </div>
                  </li>
                ) : (
                  <li key={c.pictureId} className="flex items-center gap-1 border-t border-line py-2 last:border-b">
                    <span className="grid h-11 w-8 shrink-0 place-items-center text-ink-soft">
                      {c.state === "haengt" ? (
                        <span className="size-2.5 rounded-full bg-green" aria-hidden />
                      ) : c.locked ? (
                        <Lock className="size-4" aria-label="fest" />
                      ) : (
                        <span className="size-2.5 rounded-full border-2 border-ink-soft" aria-hidden />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <PictureLine
                        pictureId={c.pictureId}
                        when={
                          c.state === "haengt"
                            ? "hängt gerade"
                            : `ab ${c.expectedAt ? fmtWhen(c.expectedAt) : "bald"}, ${c.locked ? "fest" : "im Vorrat, noch verschiebbar"}`
                        }
                        tone={c.state === "haengt" ? "green" : undefined}
                      />
                    </div>
                  </li>
                ),
              )}
            </ol>
          </div>
        ))}
      </div>
      {elsewhere.length > 0 && (
        <div className="grid gap-2">
          <h3>In anderen Gruppen verwendet ({elsewhere.length})</h3>
          <p className="text-[15px] text-ink-soft">
            Diese Bilder gehören auch zum Thema einer anderen Gruppe und hängen dort gerade oder sind dort vorgemerkt. Hier kommen sie so lange nicht dran: kein
            Bild hängt doppelt im Haus.
          </p>
          <ol className="m-0 list-none p-0">
            {elsewhere.map((c) => (
              <li key={c.pictureId} className="border-t border-line py-2 last:border-b">
                <PictureLine
                  pictureId={c.pictureId}
                  wrap
                  when={`${c.state === "haengt" ? "hängt gerade:" : "vorgemerkt für"} ${name(c.frameId)}${groupOf(c.frameId) ? ` (Gruppe ${groupOf(c.frameId)})` : ""}${
                    c.state === "vorgemerkt" && c.expectedAt ? `, ab ${fmtWhen(c.expectedAt)}` : ""
                  }${c.sharedWith ? `. Wegen „${title(c.sharedWith)}“ mit gesperrt` : ""}`}
                />
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="grid gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3>Im Stapel ({pile.length})</h3>
          <span className="text-small text-ink-soft">oben = als Nächstes</span>
        </div>
        <p className="text-[15px] text-ink-soft">
          Der Rahmen, der als Nächstes Bilder braucht, zieht von oben. Wer was bekommt, ist deshalb nur wahrscheinlich.
        </p>
        <SortableList
          items={visible.map((c) => ({ id: c.pictureId, label: byId.get(c.pictureId)?.title ?? "Bild", card: c }))}
          onMove={(pictureId, toIndex) => move.mutate({ pictureId, toIndex })}
          render={({ card }) => (
            <PictureLine
              pictureId={card.pictureId}
              when={card.frameId && card.expectedAt ? `wahrscheinlich ${name(card.frameId)}, ${fmtWhen(card.expectedAt)}` : "später in dieser Runde"}
            />
          )}
        />
        {pile.length > 12 && (
          <Button variant="ghost" className="w-fit" onClick={() => setAll(!all)}>
            {all ? "Weniger zeigen" : `Alle ${pile.length} zeigen`}
          </Button>
        )}
      </div>
      {shown.length > 0 && (
        <div className="grid gap-2">
          <h3>Gezeigt in dieser Runde ({shown.length})</h3>
          <p className="text-[15px] text-ink-soft">
            Diese Bilder waren in dieser Runde schon dran. Ist der Stapel leer, wird neu gemischt: was zuletzt hing, kommt dabei nach hinten.
          </p>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {shown.map((c) => {
              const p = byId.get(c.pictureId)
              return p ? (
                <li key={c.pictureId} className="w-[60px]">
                  <Link to={`/bild/${p.id}`} aria-label={`${p.title}, ${CARD_TEXT.gezeigt}`}>
                    <Thumb picture={p} byId={byId} orientation="hoch" className="w-full opacity-55" />
                  </Link>
                </li>
              ) : null
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

export function ScheduleScreen() {
  const [params, setParams] = useSearchParams()
  const { data } = useOverview()
  const groupId = params.get("gruppe")
  const frameId = params.get("rahmen") ?? (groupId ? "" : (data?.frames[0]?.id ?? ""))
  const frame = data?.frames.find((f) => f.id === frameId)
  const group = data?.groups.find((g) => g.id === groupId)
  // A group's deck opens in a format one of its frames has.
  const formatsOf = (id: string) => (["hoch", "quer"] as Orientation[]).filter((o) => data?.frames.some((f) => f.groupId === id && f.orientation === o))
  const format = (params.get("format") as Orientation | null) ?? (group ? formatsOf(group.id)[0] : undefined) ?? "hoch"

  return (
    <div data-wide className="grid gap-6">
      <PageHead title="Zeitplan" lead="Was als Nächstes kommt. Tipp einen Rahmen an, oder den Stapel einer Gruppe.">
        <Button asChild variant="outline">
          <Link to="/events">
            <PartyPopper />
            Events
          </Link>
        </Button>
      </PageHead>

      {data ? (
        <FramePicker
          label="Rahmen oder Stapel wählen"
          frames={data.frames}
          groups={data.groups}
          frameId={frame?.id}
          groupId={group?.id}
          frameTo={(f) => `/zeitplan?rahmen=${f.id}`}
          deckTo={(g) => `/zeitplan?gruppe=${g.id}&format=${formatsOf(g.id)[0] ?? "hoch"}`}
        />
      ) : (
        <Skeleton className="h-28 w-full" />
      )}

      <div className="grid max-w-[720px] gap-5 border-t-2 border-ink pt-4">
        {frame && (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <h2>{frame.name}</h2>
              <Link to={`/rahmen/${frame.id}`} className="inline-flex min-h-11 items-center gap-0.5 text-[15px] font-semibold text-blue no-underline">
                Rahmen öffnen
                <ChevronRight className="size-4" aria-hidden />
              </Link>
            </div>
            <FrameTimeline frame={frame} key={frame.id} />
          </>
        )}
        {group && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <h2>Stapel von {group.name}</h2>
              <Segmented
                label="Format"
                value={format}
                onChange={(v) => setParams({ gruppe: group.id, format: v }, { replace: true })}
                className="max-[559px]:w-full"
                options={[
                  { value: "hoch", label: "Hochformat" },
                  { value: "quer", label: "Querformat" },
                ]}
              />
            </div>
            <DeckView groupId={group.id} orientation={format} key={`${group.id}/${format}`} />
          </>
        )}
        {!data && <Skeleton className="h-64 w-full" />}
      </div>
    </div>
  )
}
