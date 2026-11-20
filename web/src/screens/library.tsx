import { cn } from "cn"
import {
  Bookmark,
  Camera,
  Check,
  CircleDashed,
  CloudDownload,
  Combine,
  Copy,
  Eye,
  Layers,
  ListFilter,
  Palette,
  Pause,
  Play,
  RectangleHorizontal,
  RectangleVertical,
  ScanSearch,
  Trash2,
  Undo2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useRef, useState } from "react"
import { Link, useSearchParams } from "react-router"
import { toast } from "sonner"
import { api } from "@/api"
import { useAct, useAlbums, useDiscarded, useDiscardInbox, useGroups, useInbox, usePictures, useSettings } from "@/api/hooks"
import { uploadPictures } from "@/api/http"
import { useFrameMap, usePictureMap } from "@/api/lookups"
import type { Hint as HintKind, InboxItem, Picture } from "@/api/types"
import { Chip, ChipRow, Empty, Hint, PageHead } from "@/components/bits"
import { IconFilter, type IconOption } from "@/components/icon-filter"
import { ArtImage, Thumb } from "@/components/picture"
import { Segmented } from "@/components/segmented"
import { Sheet } from "@/components/sheet"
import { ShowSheet } from "@/components/show-sheet"
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
import { Skeleton } from "@/components/ui/skeleton"
import { fmtAgo, fmtDay, fmtWhen, plural } from "@/lib/format"

const HINT_TEXT: Record<HintKind, { short: string; long: string }> = {
  "zu-klein": { short: "zu klein", long: "Zu klein: auf dem Rahmen wirkt es unscharf." },
  unscharf: { short: "unscharf", long: "Wirkt unscharf oder verwackelt." },
  doppelt: { short: "wohl doppelt", long: "Sieht aus wie ein Bild, das schon in der Bibliothek ist." },
}
type Status = "alle" | "haengt" | "vorgemerkt" | "frei" | "ohne" | "pause"

// One sign per format, state and source, the same in the filters and on the pictures.
const FORMATS: IconOption[] = [
  { value: "hoch", label: "Hochformat", icon: RectangleVertical },
  { value: "quer", label: "Querformat", icon: RectangleHorizontal },
]
const STATES: IconOption[] = [
  { value: "haengt", label: "Hängt gerade", icon: Eye },
  { value: "vorgemerkt", label: "Vorgemerkt", icon: Bookmark },
  { value: "frei", label: "Im Stapel", icon: Layers },
  { value: "ohne", label: "Ohne Gruppe", icon: CircleDashed },
  { value: "pause", label: "Pausiert", icon: Pause },
]
const SOURCES: IconOption[] = [
  { value: "upload", label: "Hochgeladen", icon: Upload },
  { value: "immich", label: "Immich", icon: CloudDownload },
  { value: "kunst", label: "Kunst", icon: Palette },
  { value: "foto", label: "Fotos", icon: Camera },
  { value: "erzeugt", label: "Erzeugt", icon: WandSparkles },
]

export function statusOf(p: Picture): { key: Status; text: string } {
  if (p.paused) return { key: "pause", text: "pausiert" }
  if (p.where.hangs) return { key: "haengt", text: "hängt" }
  if (p.where.reserved) return { key: "vorgemerkt", text: "vorgemerkt" }
  // In a deck only if a group shows one of its albums.
  if (!p.groupIds.length) return { key: "ohne", text: "keine Gruppe" }
  return { key: "frei", text: "" }
}

export function whereText(p: Picture, frameName: (id: string) => string): string {
  if (p.paused) return "Pausiert: bleibt in der Bibliothek, kommt aber auf keinen Rahmen."
  if (p.where.hangs) return `Hängt gerade: ${frameName(p.where.hangs.frameId)}, seit ${fmtWhen(p.where.hangs.since)}.`
  if (p.where.reserved) return `Vorgemerkt für ${frameName(p.where.reserved.frameId)}, voraussichtlich ${fmtWhen(p.where.reserved.at)}.`
  if (p.where.lastShown)
    return `Hing zuletzt ${fmtAgo(p.where.lastShown.at)}: ${frameName(p.where.lastShown.frameId)}.${p.where.shownThisRound ? " Gezeigt in dieser Runde: kommt wieder, wenn der Stapel neu gemischt wird." : ""}`
  if (!p.groupIds.length) return "In der Bibliothek. Noch keiner Gruppe zugeordnet."
  return "Im Stapel, hing noch nie."
}

function Tile({ picture, picked, selecting, onPick }: { picture: Picture; picked: boolean; selecting: boolean; onPick: () => void }) {
  const byId = usePictureMap()
  const frames = useFrameMap()
  const status = statusOf(picture)
  const where = picture.where.hangs ?? picture.where.reserved
  const body = (
    <>
      <div className={cn("relative", picture.paused && "opacity-45")}>
        <Thumb picture={picture} byId={byId} className={cn("w-full", picked && "outline-3 outline-offset-1 outline-blue")} />
        {picture.combo && (
          <span className="absolute top-1 left-1 grid size-6 place-items-center rounded-full bg-bezel/80 text-mat" title="Kombiniertes Bild">
            <Combine className="size-3.5" aria-hidden />
          </span>
        )}
        {picked && (
          <span className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-blue text-on-blue">
            <Check className="size-4" aria-hidden />
          </span>
        )}
      </div>
      <span className="mt-1.5 block truncate text-small font-semibold text-ink">{picture.title}</span>
      <span className={cn("flex items-center gap-1 text-[12px] text-ink-soft", status.key === "haengt" && "font-semibold text-green")}>
        {status.key === "haengt" && where ? (
          <>hängt: {frames.get(where.frameId)?.name}</>
        ) : status.key === "vorgemerkt" && where ? (
          <>
            <Bookmark className="size-3" aria-hidden />
            {frames.get(where.frameId)?.name}
          </>
        ) : status.key === "pause" ? (
          <>
            <Pause className="size-3" aria-hidden />
            pausiert
          </>
        ) : status.key === "ohne" ? (
          <>keine Gruppe</>
        ) : picture.where.shownThisRound ? (
          <>gezeigt in dieser Runde</>
        ) : (
          <>im Stapel</>
        )}
      </span>
    </>
  )
  return selecting ? (
    <button type="button" aria-pressed={picked} onClick={onPick} className="block w-full text-left">
      {body}
    </button>
  ) : (
    <Link to={`/bild/${picture.id}`} className="block no-underline">
      {body}
    </Link>
  )
}

function InboxRow({
  item,
  onAccept,
  onDiscard,
  busy,
  noGroup,
}: {
  item: InboxItem
  onAccept: () => void
  onDiscard: () => void
  busy: boolean
  /** No group shows one of its albums: accepting puts it in the library, but in no deck. */
  noGroup: boolean
}) {
  const byId = usePictureMap()
  const twin = item.duplicateOf ? byId.get(item.duplicateOf) : undefined
  return (
    <motion.li
      layout
      exit={{ opacity: 0, x: -24 }}
      transition={{ duration: 0.18 }}
      className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 border-t border-line py-4"
    >
      <div className={cn("overflow-hidden rounded-picture bg-sunken", item.orientation === "hoch" ? "aspect-9/16 w-[72px]" : "aspect-video w-[104px]")}>
        <ArtImage art={item.art} />
      </div>
      <div className="grid content-start gap-1">
        <strong>{item.title}</strong>
        <span className="text-small text-ink-soft">
          {item.sourceNote}, {fmtWhen(item.receivedAt)}. {item.orientation === "hoch" ? "Hochformat" : "Querformat"}, {item.width} × {item.height}
          {item.albums.length ? `. Album: ${item.albums.join(", ")}` : ". Kein Album"}
        </span>
        {item.artwork && (
          <span className="text-small text-ink-soft">
            {item.artwork.artist}, {item.artwork.date}. {item.artwork.licence}
          </span>
        )}
        {noGroup && (
          <span className="text-small text-ink-soft">
            {item.albums.length ? "Keine Gruppe zeigt dieses Album" : "Ohne Album"}: nach dem Übernehmen liegt es in der Bibliothek, aber in keinem Stapel.
          </span>
        )}
        {item.hints.map((h) => (
          <span key={h} className="flex items-start gap-2 text-[15px] text-yellow-ink">
            {h === "doppelt" ? <Copy className="mt-0.5 size-4 shrink-0" aria-hidden /> : <ScanSearch className="mt-0.5 size-4 shrink-0" aria-hidden />}
            <span>
              {HINT_TEXT[h].long}
              {h === "doppelt" && twin && (
                <>
                  {" "}
                  <Link to={`/bild/${twin.id}`} className="text-yellow-ink">
                    „{twin.title}“ ansehen
                  </Link>
                </>
              )}
            </span>
          </span>
        ))}
      </div>
      <div className="col-span-2 flex flex-wrap gap-2 min-[560px]:col-span-1 min-[560px]:col-start-2">
        {/* Every row has the same three words: the accessible name adds which picture is meant. */}
        <Button size="sm" disabled={busy} onClick={onAccept} aria-label={`„${item.title}“ übernehmen`}>
          Übernehmen
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link to={`/bild/eingang-${item.id}`} aria-label={`„${item.title}“ bearbeiten`}>
            Bearbeiten
          </Link>
        </Button>
        <Button size="sm" variant="ghost" className="text-ink-soft" disabled={busy} onClick={onDiscard} aria-label={`„${item.title}“ verwerfen`}>
          Verwerfen
        </Button>
      </div>
    </motion.li>
  )
}

/** Discarded pictures are kept for a while: this is where they can be found and brought back. */
function Discarded() {
  const { data } = useDiscarded()
  const restore = useAct(api.restoreInbox, (_r, ids) =>
    ids.length === 1
      ? `„${data?.find((i) => i.id === ids[0])?.title ?? "Bild"}“ wiederhergestellt: liegt wieder im Eingang`
      : `${ids.length} Bilder wiederhergestellt: liegen wieder im Eingang`,
  )
  if (!data) return <Skeleton className="h-40 w-full" />
  if (!data.length) {
    return (
      <Empty title="Nichts verworfen">
        <p className="text-ink-soft">Was du im Eingang verwirfst, liegt noch 30 Tage hier und lässt sich so lange wiederherstellen.</p>
      </Empty>
    )
  }
  return (
    <div className="grid gap-4">
      <p className="text-[15px] text-ink-soft">
        Verworfene Bilder kommen auf keinen Rahmen. Sie liegen noch 30 Tage hier und werden danach endgültig gelöscht. Wiederhergestellte Bilder liegen wieder
        im Eingang.
      </p>
      <ul className="m-0 list-none p-0 [&>li:last-child]:border-b">
        <AnimatePresence initial={false}>
          {data.map((item) => (
            <motion.li
              key={item.id}
              layout
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.18 }}
              className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 border-t border-line py-4 min-[560px]:grid-cols-[auto_minmax(0,1fr)_auto]"
            >
              <div
                className={cn(
                  "overflow-hidden rounded-picture bg-sunken opacity-60",
                  item.orientation === "hoch" ? "aspect-9/16 w-[56px]" : "aspect-video w-[84px]",
                )}
              >
                <ArtImage art={item.art} />
              </div>
              <div className="grid content-start gap-0.5">
                <strong>{item.title}</strong>
                <span className="text-small text-ink-soft">
                  Verworfen {fmtWhen(item.discardedAt)}. {item.sourceNote}.
                </span>
                <span className="text-small text-ink-soft">Wird {fmtDay(item.keptUntil)} endgültig gelöscht.</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="col-span-2 w-fit min-[560px]:col-span-1"
                disabled={restore.isPending}
                onClick={() => restore.mutate([item.id])}
                aria-label={`„${item.title}“ wiederherstellen`}
              >
                <Undo2 />
                Wiederherstellen
              </Button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  )
}

function Inbox({ discarded, onView }: { discarded: boolean; onView: (discarded: boolean) => void }) {
  const { data } = useInbox()
  const gone = useDiscarded()
  const filter = (
    <ChipRow label="Eingang">
      <Chip pressed={!discarded} onClick={() => onView(false)} count={data?.length}>
        Neu
      </Chip>
      <Chip pressed={discarded} onClick={() => onView(true)} count={gone.data?.length}>
        Verworfen
      </Chip>
    </ChipRow>
  )
  return (
    <div className="grid gap-4">
      {filter}
      {discarded ? <Discarded /> : <NewInInbox />}
    </div>
  )
}

function NewInInbox() {
  const { data } = useInbox()
  const accept = useAct(api.acceptInbox, (r, ids) => {
    const n = plural(ids.length, "Bild", "Bilder")
    if (r.withoutGroup === 0) return `${n} übernommen: ${ids.length === 1 ? "liegt" : "liegen"} jetzt im Stapel`
    if (r.withoutGroup === ids.length) return `${n} übernommen: in der Bibliothek, noch keiner Gruppe zugeordnet`
    return `${n} übernommen. ${r.withoutGroup} davon noch keiner Gruppe zugeordnet`
  })
  const groups = useGroups()
  const inTheme = (item: InboxItem) => item.albums.some((a) => groups.data?.some((g) => g.albums.includes(a)))
  // Names the picture and offers "Wiederherstellen"; what is discarded stays under "Verworfen" for 30 days.
  const discard = useDiscardInbox()
  if (!data) return <Skeleton className="h-40 w-full" />
  if (!data.length) {
    return (
      <Empty title="Der Eingang ist leer">
        <p className="text-ink-soft">Neue Bilder landen zuerst hier: hochgeladene, solche aus Immich und Kunstwerke aus dem Katalog.</p>
        <Button asChild variant="outline">
          <Link to="/immich">
            <CloudDownload />
            Aus Immich holen
          </Link>
        </Button>
      </Empty>
    )
  }
  const clean = data.filter((i) => i.hints.length === 0)
  const flagged = data.length - clean.length
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-control border border-line bg-surface p-4">
        <p>
          {plural(data.length, "neues Bild wartet", "neue Bilder warten")} hier. Format und Zuschnitt sind schon vorbereitet. Erst nach dem Übernehmen kommt ein
          Bild in die Bibliothek und in die Stapel der Gruppen, die sein Album zeigen.
          {flagged > 0 && ` ${plural(flagged, "Bild hat", "Bilder haben")} einen Hinweis: bitte ansehen.`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!clean.length || accept.isPending} onClick={() => accept.mutate(clean.map((i) => i.id))}>
            Alle {clean.length} ohne Hinweis übernehmen
          </Button>
          <Hint>
            In den Einstellungen kannst du festlegen, dass Bilder ohne Hinweis von selbst übernommen werden. Bilder mit Hinweis bleiben immer hier liegen.
          </Hint>
        </div>
      </div>
      <ul className="m-0 list-none p-0 [&>li:last-child]:border-b">
        <AnimatePresence initial={false}>
          {data.map((item) => (
            <InboxRow
              key={item.id}
              item={item}
              noGroup={!!groups.data && !inTheme(item)}
              busy={accept.isPending || discard.isPending}
              onAccept={() => accept.mutate([item.id])}
              onDiscard={() => discard.mutate([{ id: item.id, title: item.title }])}
            />
          ))}
        </AnimatePresence>
      </ul>
    </div>
  )
}

export function LibraryScreen() {
  const [params, setParams] = useSearchParams()
  const view = params.get("ansicht") === "eingang" ? "eingang" : "bilder"
  const album = params.get("album")
  const format = params.get("format")
  const source = params.get("quelle")
  const status = (params.get("status") as Status | null) ?? "alle"
  const frameId = params.get("rahmen") ?? undefined
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const { data } = usePictures()
  const inbox = useInbox()
  const albums = useAlbums()
  const frames = useFrameMap()
  const [picked, setPicked] = useState<string[]>([])
  const [selecting, setSelecting] = useState(!!frameId)
  const [showOpen, setShowOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [limit, setLimit] = useState(48)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const artOn = useSettings().data?.extras.art ?? false
  const fileInput = useRef<HTMLInputElement>(null)
  const upload = useAct(uploadPictures, (result) => {
    const errors = result.results.filter((item) => item.error)
    for (const item of errors) toast.error(`${item.name}: ${item.error}`)
    const n = result.results.length - errors.length
    return n ? `${plural(n, "Bild liegt", "Bilder liegen")} jetzt im Eingang` : undefined
  })

  const update = useAct(
    ({ ids, paused }: { ids: string[]; paused: boolean }) => Promise.all(ids.map((id) => api.updatePicture(id, { paused }))),
    (_r, a) => `${plural(a.ids.length, "Bild", "Bilder")} ${a.paused ? "pausiert" : "fortgesetzt"}`,
  )
  const remove = useAct(
    (ids: string[]) => Promise.all(ids.map((id) => api.deletePicture(id))),
    (_r, ids) => `${plural(ids.length, "Bild", "Bilder")} gelöscht`,
  )

  const list = (data ?? []).filter(
    (p) =>
      (!album || p.albums.includes(album)) &&
      (!format || p.orientation === format || (p.alsoOther && format !== "kombi")) &&
      (!source || p.source === source) &&
      (status === "alle" || statusOf(p).key === status),
  )
  const toggleParam = (key: string, current: string | null) => (value: string) => set(key, current === value ? null : value)
  const active = [
    { key: "format", option: FORMATS.find((o) => o.value === format) },
    { key: "status", option: STATES.find((o) => o.value === status) },
    { key: "quelle", option: SOURCES.find((o) => o.value === source) },
  ].flatMap((a) => (a.option ? [{ key: a.key, option: a.option }] : []))
  const resetFilters = () => {
    const next = new URLSearchParams(params)
    for (const key of ["format", "status", "quelle"]) next.delete(key)
    setParams(next, { replace: true })
  }
  const pickedPictures = (data ?? []).filter((p) => picked.includes(p.id))
  const allPaused = pickedPictures.length > 0 && pickedPictures.every((p) => p.paused)
  const hanging = pickedPictures.filter((p) => p.where.hangs)
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  const stopSelecting = () => {
    setSelecting(false)
    setPicked([])
  }

  return (
    <div data-wide className="grid gap-5">
      <PageHead title="Bibliothek">
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,image/tiff,image/gif,.heic,.heif"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            if (e.target.files?.length) upload.mutate(Array.from(e.target.files))
            e.target.value = ""
          }}
        />
        <Button variant="outline" disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
          <Upload />
          Hochladen
        </Button>
        <Button variant="outline" asChild>
          <Link to="/immich">
            <CloudDownload />
            Aus Immich holen
          </Link>
        </Button>
        {artOn && (
          <Button variant="outline" asChild>
            <Link to="/kunst">
              <Palette />
              Kunst
            </Link>
          </Button>
        )}
      </PageHead>

      <Segmented
        label="Ansicht"
        value={view}
        onChange={(v) => set("ansicht", v === "eingang" ? "eingang" : null)}
        className="min-[560px]:w-fit min-[560px]:min-w-[340px]"
        options={[
          { value: "bilder", label: `Bilder${data ? ` (${data.length})` : ""}` },
          { value: "eingang", label: `Eingang${inbox.data?.length ? ` (${inbox.data.length} neu)` : ""}` },
        ]}
      />

      {view === "eingang" ? (
        <Inbox discarded={params.get("eingang") === "verworfen"} onView={(d) => set("eingang", d ? "verworfen" : null)} />
      ) : (
        <>
          <div className="grid gap-3">
            {/* Albums are names, so they stay words; they wrap instead of running off the side. */}
            <ChipRow label="Album">
              <Chip pressed={!album} onClick={() => set("album", null)}>
                Alle Alben
              </Chip>
              {albums.data?.map((a) => (
                <Chip key={a.name} pressed={album === a.name} onClick={() => set("album", album === a.name ? null : a.name)} count={a.count}>
                  {a.name}
                </Chip>
              ))}
            </ChipRow>

            {/* From tablet width: three groups of signs. The one that is on spells itself out. */}
            <div className="hidden flex-wrap items-center gap-x-3 gap-y-2 min-[560px]:flex">
              <IconFilter label="Format" options={FORMATS} value={format} onChange={toggleParam("format", format)} />
              <IconFilter label="Zustand" options={STATES} value={status === "alle" ? null : status} onChange={toggleParam("status", status)} />
              <IconFilter label="Quelle" options={SOURCES} value={source} onChange={toggleParam("quelle", source)} />
              {active.length > 0 && (
                <Button variant="ghost" size="sm" onClick={resetFilters}>
                  Zurücksetzen
                </Button>
              )}
            </div>

            {/* On the phone: one button, the filters in a sheet, and what is on as chips that take it off again. */}
            <div className="flex flex-wrap items-center gap-2 min-[560px]:hidden">
              <Button variant="outline" size="sm" className="h-11" onClick={() => setFiltersOpen(true)}>
                <ListFilter />
                Filter
                {active.length > 0 && (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-blue px-1 text-[12px] leading-none font-bold text-on-blue">
                    {active.length}
                    <span className="sr-only"> aktiv</span>
                  </span>
                )}
              </Button>
              {active.map(({ key, option: { label, icon: Icon } }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => set(key, null)}
                  aria-label={`Filter „${label}“ entfernen`}
                  className="inline-flex h-11 items-center gap-1.5 rounded-full border border-ink bg-ink pr-2 pl-3 text-[15px] text-paper"
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                  <X className="size-4 opacity-70" aria-hidden />
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[15px] text-ink-soft">
              {frameId && frames.get(frameId) ? `Bild für ${frames.get(frameId)?.name} aussuchen. ` : ""}
              {data ? plural(list.length, "Bild", "Bilder") : "Lädt …"}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" asChild>
                <Link to="/kombinieren">
                  <Combine />
                  Kombinieren
                </Link>
              </Button>
              <Button variant={selecting ? "secondary" : "outline"} size="sm" onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
                {selecting ? "Fertig" : "Auswählen"}
              </Button>
            </div>
          </div>

          {!data ? (
            <div className="grid grid-cols-3 gap-3 min-[560px]:grid-cols-4 min-[900px]:grid-cols-6">
              {Array.from({ length: 12 }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholders
                <Skeleton key={i} className="aspect-9/16 w-full rounded-picture" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <Empty title="Kein Bild passt zu diesen Filtern">
              <Button
                variant="outline"
                onClick={() => {
                  const next = new URLSearchParams(params)
                  for (const key of ["album", "format", "status", "quelle"]) next.delete(key)
                  setParams(next, { replace: true })
                }}
              >
                Filter zurücksetzen
              </Button>
            </Empty>
          ) : (
            <ul className="m-0 grid list-none grid-cols-3 items-end gap-x-3 gap-y-5 p-0 min-[560px]:grid-cols-4 min-[900px]:grid-cols-6 min-[1200px]:grid-cols-7">
              {list.slice(0, limit).map((p) => (
                <li key={p.id} className="min-w-0">
                  <Tile picture={p} picked={picked.includes(p.id)} selecting={selecting} onPick={() => toggle(p.id)} />
                </li>
              ))}
            </ul>
          )}
          {list.length > limit && (
            <Button variant="outline" className="justify-self-center" onClick={() => setLimit(limit + 48)}>
              Weitere {Math.min(48, list.length - limit)} zeigen
            </Button>
          )}
        </>
      )}

      <AnimatePresence>
        {selecting && view === "bilder" && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface px-4 py-3 min-[900px]:bottom-0 min-[900px]:left-[216px]"
          >
            <div className="mx-auto flex max-w-[1056px] flex-wrap items-center gap-2">
              <span className="mr-auto text-[15px] font-semibold">
                {picked.length ? plural(picked.length, "Bild gewählt", "Bilder gewählt") : "Bilder antippen"}
              </span>
              <Button size="sm" disabled={!picked.length} onClick={() => setShowOpen(true)}>
                Zeigen
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!picked.length || update.isPending}
                onClick={() => update.mutate({ ids: picked, paused: !allPaused })}
              >
                {allPaused ? <Play /> : <Pause />}
                {allPaused ? "Fortsetzen" : "Pausieren"}
              </Button>
              <Button size="sm" variant="destructive" disabled={!picked.length} onClick={() => setConfirmDelete(true)}>
                <Trash2 />
                Löschen
              </Button>
              <Button size="icon-sm" variant="ghost" className="text-ink-soft" aria-label="Auswahl beenden" onClick={stopSelecting}>
                <X />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen} title="Filter" description="Je Zeile höchstens einer. Antippen schaltet ein und wieder aus.">
        {(
          [
            ["Format", FORMATS, format, "format"],
            ["Zustand", STATES, status === "alle" ? null : status, "status"],
            ["Quelle", SOURCES, source, "quelle"],
          ] as const
        ).map(([title, options, value, key]) => (
          <fieldset key={key} className="m-0 grid gap-2 border-0 p-0">
            <legend className="mb-2 p-0 font-semibold">{title}</legend>
            <div className="flex flex-wrap gap-2">
              {options.map(({ value: v, label, icon: Icon }) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={value === v}
                  onClick={() => set(key, value === v ? null : v)}
                  className={cn(
                    "inline-flex h-11 items-center gap-2 rounded-control border px-3 text-[15px]",
                    value === v ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink",
                  )}
                >
                  <Icon className="size-[18px]" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" disabled={!active.length} onClick={resetFilters}>
            Zurücksetzen
          </Button>
          <Button onClick={() => setFiltersOpen(false)}>{data ? `${plural(list.length, "Bild", "Bilder")} zeigen` : "Fertig"}</Button>
        </div>
      </Sheet>

      <ShowSheet pictureIds={picked} open={showOpen} onOpenChange={setShowOpen} frameId={frameId} />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="bg-surface">
          <AlertDialogHeader>
            <AlertDialogTitle>{plural(picked.length, "Bild", "Bilder")} löschen?</AlertDialogTitle>
            <AlertDialogDescription className="text-body text-ink">
              {picked.length === 1 ? "Das Bild ist" : "Die Bilder sind"} dann weg und {picked.length === 1 ? "kommt" : "kommen"} auf keinen Rahmen mehr.
              {hanging.length > 0 &&
                ` ${hanging.length === 1 ? "Eines hängt" : `${hanging.length} hängen`} gerade (${hanging.map((p) => frames.get(p.where.hangs?.frameId ?? "")?.name).join(", ")}) und bleibt dort, bis der Rahmen das nächste Mal wechselt.`}{" "}
              Wenn du es nur eine Weile nicht sehen willst, nimm „Pausieren“.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Behalten</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                remove.mutate(picked)
                stopSelecting()
              }}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
