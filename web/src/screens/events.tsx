import { useQuery } from "@tanstack/react-query"
import { BatteryMedium, Plus, Power, Trash2 } from "lucide-react"
import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { api } from "@/api"
import { useAct, useEvents, useOverview } from "@/api/hooks"
import { usePictureMap } from "@/api/lookups"
import type { EventDraft, FrameEvent } from "@/api/types"
import { Banner, Empty, Field, Hint, PageHead, Section, SettingRow } from "@/components/bits"
import { DateTimeRange, rangeText } from "@/components/date-time-range"
import { Thumb } from "@/components/picture"
import { PicturePicker } from "@/components/picture-picker"
import { SortableList } from "@/components/sortable"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { EVENT_CADENCE_CHOICES, everyText } from "@/lib/cadence"
import { at, now } from "@/lib/clock"
import { eventPressSentence } from "@/lib/explain"
import { listDe, plural } from "@/lib/format"

const STATE_TEXT = { geplant: "geplant", laeuft: "läuft gerade", vorbei: "vorbei" }

export function EventsScreen() {
  const { data } = useEvents()
  const { data: overview } = useOverview()
  const name = (id: string) => overview?.frames.find((f) => f.id === id)?.name ?? ""
  const order = { laeuft: 0, geplant: 1, vorbei: 2 }
  const list = [...(data ?? [])].sort((a, b) => order[a.state] - order[b.state] || a.start - b.start)
  return (
    <div className="grid gap-6">
      <PageHead
        title="Events"
        back={{ to: "/zeitplan", label: "Zeitplan" }}
        lead="Für einen Geburtstag oder ein Fest: eigene Bilder in eigenem Takt, für eine bestimmte Zeit. Danach geht alles von selbst normal weiter."
      >
        <Button asChild>
          <Link to="/events/neu">
            <Plus />
            Event anlegen
          </Link>
        </Button>
      </PageHead>
      {!data ? (
        <Skeleton className="h-32 w-full" />
      ) : list.length === 0 ? (
        <Empty title="Noch kein Event">
          <Button asChild>
            <Link to="/events/neu">Event anlegen</Link>
          </Button>
        </Empty>
      ) : (
        <ul className="m-0 list-none p-0 [&>li:last-child]:border-b">
          {list.map((e) => (
            <li key={e.id} className="border-t border-line">
              <Link to={`/events/${e.id}`} className="grid gap-1 py-4 text-ink no-underline">
                <span className="flex flex-wrap items-baseline gap-x-3">
                  <strong className="text-lead">{e.name}</strong>
                  <span className={e.state === "laeuft" ? "font-semibold text-green" : "text-ink-soft"}>{STATE_TEXT[e.state]}</span>
                </span>
                <span>{rangeText(e.start, e.end)}</span>
                <span className="text-[15px] text-ink-soft">
                  {e.frameIds.length === overview?.frames.length ? "Alle Rahmen" : listDe(e.frameIds.map(name))},{" "}
                  {plural(e.pictureIds.length, "Bild", "Bilder")}, {everyText(e.everyMin)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function EventEditScreen() {
  const { id } = useParams()
  const { data } = useEvents()
  const existing = id && id !== "neu" ? data?.find((e) => e.id === id) : undefined
  if (id && id !== "neu" && !data) return <Skeleton className="h-64 w-full" />
  if (id && id !== "neu" && !existing) return <Banner level="plain" title="Dieses Event gibt es nicht mehr" />
  return <EventForm existing={existing} key={existing?.id ?? "neu"} />
}

function EventForm({ existing }: { existing?: FrameEvent }) {
  const navigate = useNavigate()
  const { data: overview } = useOverview()
  const byId = usePictureMap()
  const frames = overview?.frames ?? []
  const [draft, setDraft] = useState<EventDraft>(
    existing ? { ...existing } : { name: "", start: at(2, 15), end: at(3, 3), frameIds: [], pictureIds: [], everyMin: 60, sameOnAll: false },
  )
  const [touchedFrames, setTouchedFrames] = useState(!!existing)
  const [picking, setPicking] = useState(false)
  const [confirm, setConfirm] = useState<"beenden" | "loeschen" | null>(null)
  // Default target: all frames.
  const frameIds = touchedFrames ? draft.frameIds : frames.map((f) => f.id)
  const full = { ...draft, frameIds }
  const patch = (p: Partial<EventDraft>) => setDraft((d) => ({ ...d, ...p }))

  const estimate = useQuery({
    queryKey: ["event-estimate", full],
    queryFn: () => api.estimateEvent(full),
    enabled: frameIds.length > 0 && full.end > full.start,
  })
  const save = useAct(api.saveEvent, existing ? "Event geändert" : "Event angelegt")
  const end = useAct(api.endEvent, "Event beendet")
  const remove = useAct(api.deleteEvent, "Event gelöscht")

  const frame = (fid: string) => frames.find((f) => f.id === fid)
  const running = existing?.state === "laeuft"
  const over = existing?.state === "vorbei"
  const est = estimate.data
  const needPress = est?.perFrame.filter((p) => p.pressReason) ?? []
  // Frames for which none of the chosen pictures has a crop in their format, by format.
  const noFormat = (["hoch", "quer"] as const)
    .map((o) => ({ o, ids: (est?.perFrame ?? []).filter((p) => p.missingFormat && frame(p.frameId)?.orientation === o).map((p) => p.frameId) }))
    .filter((m) => m.ids.length > 0)
  const formatOk = noFormat.length === 0
  const overlaps = est?.perFrame.filter((p) => p.overlapsWith) ?? []
  const battery = est?.perFrame.filter((p) => p.extraBattery !== null) ?? []
  const valid = draft.name.trim() && frameIds.length > 0 && draft.pictureIds.length > 0 && draft.end > draft.start && overlaps.length === 0 && formatOk && !!est
  const toggleFrames = (ids: string[], on: boolean) => {
    setTouchedFrames(true)
    patch({ frameIds: on ? [...new Set([...frameIds, ...ids])] : frameIds.filter((x) => !ids.includes(x)) })
  }

  return (
    <div className="grid gap-8">
      <PageHead
        title={existing ? existing.name : "Event anlegen"}
        back={{ to: "/events", label: "Events" }}
        lead={existing ? STATE_TEXT[existing.state].replace(/^./, (c) => c.toUpperCase()) : undefined}
      />

      <Field label="Name" htmlFor="event-name">
        <Input id="event-name" value={draft.name} placeholder="Geburtstag Jonas" onChange={(e) => patch({ name: e.target.value })} disabled={over} />
      </Field>

      <Section title="Wann">
        <DateTimeRange start={draft.start} end={draft.end} onChange={(start, e) => patch({ start, end: e })} />
      </Section>

      <Section
        title="Wo"
        aside={
          <span className="text-small text-ink-soft">{frameIds.length === frames.length ? "alle Rahmen" : plural(frameIds.length, "Rahmen", "Rahmen")}</span>
        }
      >
        <div className="grid gap-4">
          {overview?.groups.map((g) => {
            const inGroup = frames.filter((f) => f.groupId === g.id)
            const all = inGroup.every((f) => frameIds.includes(f.id))
            const some = inGroup.some((f) => frameIds.includes(f.id))
            return (
              <fieldset key={g.id} className="m-0 grid gap-2 border-0 p-0">
                <label className="flex min-h-9 items-center gap-3 font-semibold">
                  <Checkbox
                    checked={all ? true : some ? "indeterminate" : false}
                    onCheckedChange={(v) =>
                      toggleFrames(
                        inGroup.map((f) => f.id),
                        v === true,
                      )
                    }
                    className="size-5"
                  />
                  {g.name}
                </label>
                <div className="ml-8 flex flex-wrap gap-x-5 gap-y-1">
                  {inGroup.map((f) => (
                    <label key={f.id} className="flex min-h-9 items-center gap-2 text-[15px]">
                      <Checkbox checked={frameIds.includes(f.id)} onCheckedChange={(v) => toggleFrames([f.id], v === true)} className="size-5" />
                      {f.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            )
          })}
        </div>
        {overlaps.length > 0 && (
          <Banner level="warn" title="Zwei Events zur selben Zeit gehen nicht">
            <p>
              {overlaps.map((o) => `${frame(o.frameId)?.name} hat in dieser Zeit schon „${o.overlapsWith}“`).join(". ")}. Nimm den Rahmen hier heraus oder
              ändere die Zeit.
            </p>
          </Banner>
        )}
      </Section>

      <Section
        title="Bilder"
        aside={<span className="text-small text-ink-soft">{plural(draft.pictureIds.length, "Bild", "Bilder")}, in dieser Reihenfolge</span>}
      >
        {draft.pictureIds.length === 0 ? (
          <Empty title="Noch keine Bilder">
            <p className="text-ink-soft">Wähle einzelne Bilder oder gleich ein ganzes Album.</p>
            <Button variant="outline" onClick={() => setPicking(true)}>
              Bilder wählen
            </Button>
          </Empty>
        ) : (
          <>
            <SortableList
              items={draft.pictureIds.map((pid) => ({ id: pid, label: byId.get(pid)?.title ?? "Bild" }))}
              onMove={(pid, toIndex) => {
                const next = draft.pictureIds.filter((x) => x !== pid)
                next.splice(toIndex, 0, pid)
                patch({ pictureIds: next })
              }}
              render={(item, index) => {
                const p = byId.get(item.id)
                return (
                  <div className="flex items-center gap-3">
                    <span className="w-5 text-right text-small text-ink-soft">{index + 1}</span>
                    {p && <Thumb picture={p} byId={byId} className={p.orientation === "hoch" ? "w-8" : "w-14"} />}
                    <span className="min-w-0 flex-1 truncate font-semibold">{item.label}</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-ink-soft"
                      aria-label={`${item.label} entfernen`}
                      onClick={() => patch({ pictureIds: draft.pictureIds.filter((x) => x !== item.id) })}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )
              }}
            />
            <Button variant="outline" className="w-fit" onClick={() => setPicking(true)}>
              Bilder ändern
            </Button>
          </>
        )}
        {noFormat.map(({ o, ids }) => {
          const names = listDe(ids.map((fid) => frame(fid)?.name ?? ""))
          return (
            <Banner key={o} level="warn" title={`Für ${names} fehlen Bilder im ${o === "hoch" ? "Hochformat" : "Querformat"}`}>
              <p>
                {ids.length === 1 ? "Dieser Rahmen hängt" : "Diese Rahmen hängen"} im {o === "hoch" ? "Hochformat" : "Querformat"}, von den gewählten Bildern
                passt keines. Lege passende Zuschnitte an oder nimm {names} aus dem Event.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
                  Bilder ändern
                </Button>
                <Button size="sm" variant="outline" onClick={() => toggleFrames(ids, false)}>
                  {names} aus dem Event nehmen
                </Button>
              </div>
            </Banner>
          )
        })}
        <SettingRow
          title="Auf allen Rahmen gleich"
          text={
            draft.sameOnAll ? "Alle Rahmen zeigen zur selben Zeit dasselbe Bild." : "Die Bilder verteilen sich auf die Rahmen, keines ist doppelt zu sehen."
          }
        >
          <Switch checked={draft.sameOnAll} onCheckedChange={(v) => patch({ sameOnAll: v })} aria-label="Auf allen Rahmen gleich" />
        </SettingRow>
        {est?.repeats && <p className="text-[15px] text-ink-soft">Die Bilder reichen nicht für die ganze Zeit. Sind alle gezeigt, beginnen sie von vorn.</p>}
      </Section>

      <Section title="Takt" aside={<Hint>Der Takt gilt nur während des Events. Den normalen Rhythmus eines Rahmens änderst du in seinen Einstellungen.</Hint>}>
        <Select value={String(draft.everyMin)} onValueChange={(v) => patch({ everyMin: Number(v) })}>
          <SelectTrigger className="h-11 w-full bg-surface text-body min-[560px]:w-[260px]" aria-label="Takt während des Events">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EVENT_CADENCE_CHOICES.map((c) => (
              <SelectItem key={c.everyMin} value={String(c.everyMin)} className="py-2 text-body">
                {c.label} ein neues Bild
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Section>

      {est && frameIds.length > 0 && formatOk && (
        <Section title="Das passiert">
          <div className="grid gap-3 rounded-control bg-sunken p-4">
            <p>
              {rangeText(draft.start, draft.end).replace(/^./, (c) => c.toUpperCase())}:{" "}
              {frameIds.length === frames.length
                ? "alle Rahmen wechseln"
                : `${listDe(frameIds.map((f) => frame(f)?.name ?? ""))} ${frameIds.length === 1 ? "wechselt" : "wechseln"}`}{" "}
              {everyText(draft.everyMin)} das Bild. Danach geht jeder Rahmen von selbst zu seinem normalen Rhythmus und seinen normalen Bildern zurück.
            </p>
            {battery.length > 0 && (
              <div className="grid gap-1.5">
                <strong className="flex items-center gap-2">
                  <BatteryMedium className="size-5 text-ink-soft" aria-hidden />
                  Kostet zusätzlich Akku
                </strong>
                <ul className="m-0 grid list-none gap-1 p-0 text-[15px]">
                  {battery.map((b) => (
                    <li key={b.frameId} className={b.batteryAfter !== null && b.batteryAfter < 10 ? "font-semibold text-red" : ""}>
                      {frame(b.frameId)?.name}: {plural(b.changes, "Wechsel", "Wechsel")}, etwa {String(b.extraBattery).replace(".", ",")} % mehr als sonst.
                      Danach noch etwa {b.batteryAfter} %.
                      {b.batteryAfter !== null && b.batteryAfter < 10 ? " Das reicht nicht sicher: vorher laden." : ""}
                    </li>
                  ))}
                </ul>
                <p className="text-small text-ink-soft">Rahmen am Strom kostet das nichts.</p>
              </div>
            )}
            {needPress.length > 0 ? (
              <div className="grid gap-1.5">
                <strong className="flex items-center gap-2 text-yellow-ink">
                  <Power className="size-5" aria-hidden />
                  Vor dem Beginn den Knopf drücken
                </strong>
                <ul className="m-0 grid list-none gap-1.5 p-0 text-[15px]">
                  {needPress.map((p) => {
                    const f = frame(p.frameId)
                    return f && p.pressReason ? <li key={p.frameId}>{eventPressSentence(f, p.pressReason, draft.start, p.nextContact)}</li> : null
                  })}
                </ul>
                {needPress.length < frameIds.length && (
                  <p className="text-[15px] text-ink-soft">Die anderen Rahmen melden sich vor dem Beginn noch von selbst und bekommen das Event dabei mit.</p>
                )}
              </div>
            ) : (
              <p className="text-[15px] text-ink-soft">
                Alle gewählten Rahmen melden sich vor dem Beginn noch von selbst und bekommen das Event dabei mit. Du musst nichts tun.
              </p>
            )}
          </div>
        </Section>
      )}

      <div className="grid gap-2 min-[560px]:flex min-[560px]:flex-wrap">
        {!over && (
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate(full, { onSuccess: () => navigate("/events") })}>
            {existing ? "Änderungen speichern" : "Event anlegen"}
          </Button>
        )}
        {running && (
          <Button variant="outline" onClick={() => setConfirm("beenden")}>
            Jetzt beenden
          </Button>
        )}
        {existing && !running && (
          <Button variant="destructive" onClick={() => setConfirm("loeschen")}>
            <Trash2 />
            Event löschen
          </Button>
        )}
        <Button variant="ghost" asChild>
          <Link to="/events">Abbrechen</Link>
        </Button>
      </div>
      {!valid && !over && (
        <p className="-mt-5 text-small text-ink-soft">
          Es fehlt noch:{" "}
          {[
            !draft.name.trim() && "ein Name",
            frameIds.length === 0 && "mindestens ein Rahmen",
            draft.pictureIds.length === 0 && "Bilder",
            draft.end <= draft.start && "ein Ende nach dem Beginn",
            overlaps.length > 0 && "eine Zeit ohne anderes Event",
            ...noFormat.map((m) => `Bilder im ${m.o === "hoch" ? "Hochformat" : "Querformat"} für ${listDe(m.ids.map((fid) => frame(fid)?.name ?? ""))}`),
          ]
            .filter(Boolean)
            .join(", ")}
          .
        </p>
      )}

      <PicturePicker
        open={picking}
        onOpenChange={setPicking}
        title="Bilder für das Event"
        selected={draft.pictureIds}
        onDone={(ids) => patch({ pictureIds: ids })}
      />

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent className="bg-surface">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "beenden" ? "Event jetzt beenden?" : "Event löschen?"}</AlertDialogTitle>
            <AlertDialogDescription className="text-body text-ink">
              {confirm === "beenden"
                ? "Jeder Rahmen kehrt zum normalen Rhythmus zurück, sobald er sich das nächste Mal meldet: Rahmen am Strom sofort, die anderen nach ihrem nächsten Wechsel oder einem Knopfdruck. Bis dahin laufen dort noch Bilder des Events."
                : existing && existing.start > now()
                  ? "Das Event findet dann nicht statt. Rahmen, die es schon bekommen haben, erfahren das bei ihrem nächsten Melden."
                  : "Das Event verschwindet aus der Liste. An den Rahmen ändert sich nichts."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!existing) return
                if (confirm === "beenden") end.mutate(existing.id, { onSuccess: () => navigate("/events") })
                else remove.mutate(existing.id, { onSuccess: () => navigate("/events") })
              }}
            >
              {confirm === "beenden" ? "Beenden" : "Löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
