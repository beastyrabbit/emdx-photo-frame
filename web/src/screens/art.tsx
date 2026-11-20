import { cn } from "cn"
import { Check, RectangleHorizontal, RectangleVertical, Search, Star, ZoomIn } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router"
import { api } from "@/api"
import { useAct, useArtSearch, useOverview, usePhotoSearch, useSettings } from "@/api/hooks"
import type { ArtQuery, ArtSource, ArtWork, Orientation, PhotoQuery } from "@/api/types"
import { Banner, Chip, ChipRow, Empty, PageHead, Section } from "@/components/bits"
import { IconFilter } from "@/components/icon-filter"
import { Segmented } from "@/components/segmented"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { artUrl } from "@/lib/art"
import { plural } from "@/lib/format"

export const ART_SOURCES: Record<ArtSource, string> = {
  wikimedia: "Wikimedia Commons",
  met: "Metropolitan Museum of Art",
  cleveland: "Cleveland Museum of Art",
  smk: "SMK Kopenhagen",
  aic: "Art Institute of Chicago",
  wordpress: "WordPress-Fotoverzeichnis",
}
const SHORT: Record<ArtSource, string> = {
  wikimedia: "Wikimedia Commons",
  met: "Met Museum",
  cleveland: "Cleveland Museum",
  smk: "SMK",
  aic: "Art Institute of Chicago",
  wordpress: "Foto",
}
// The collections to choose from. The catalogue's 25 Chicago works are no longer one of them.
const COLLECTIONS: ArtSource[] = ["wikimedia", "met", "cleveland", "smk"]
// The museums and photo directories search in English.
const IDEAS = { werke: ["Monet", "Hokusai", "flowers", "sea", "night"], fotos: ["flowers", "mountains", "autumn forest", "sea", "city"] }
const SHAPE = { hoch: 9 / 16, quer: 16 / 9 }

/**
 * How well a work suits the shape of the frames: the frame crops what does not fit.
 * Says which format it suits and how much of the work is left.
 */
export function fitOf(work: Pick<ArtWork, "width" | "height">): { format: Orientation; kept: number; text: string } {
  const ratio = work.width / work.height
  const format: Orientation = work.height >= work.width ? "hoch" : "quer"
  const kept = Math.min(ratio, SHAPE[format]) / Math.max(ratio, SHAPE[format])
  const name = format === "hoch" ? "Hochformat" : "Querformat"
  const text = kept >= 0.8 ? `passt gut ins ${name}` : kept >= 0.62 ? `passt ins ${name}, am Rand fehlt etwas` : `fürs ${name} wird viel abgeschnitten`
  return { format, kept, text }
}

function Work({ work, picked, onPick, frames }: { work: ArtWork; picked: boolean; onPick: () => void; frames: Record<Orientation, number> }) {
  const fit = fitOf(work)
  const Shape = fit.format === "hoch" ? RectangleVertical : RectangleHorizontal
  return (
    <li className="min-w-0">
      <button
        type="button"
        disabled={work.taken}
        aria-pressed={picked}
        aria-label={`${work.title}, ${work.artist}${work.taken ? ", schon geholt" : ""}`}
        onClick={onPick}
        className="group relative block w-full text-left"
      >
        {/* A work of art is shown whole, in its own shape; the frame's cut is only a hint below. */}
        <span
          className={cn(
            "relative block overflow-hidden rounded-picture bg-sunken",
            picked && "outline-3 outline-offset-2 outline-blue",
            work.taken && "opacity-45",
          )}
        >
          <img
            src={artUrl(work.art, work.width, work.height)}
            alt=""
            draggable={false}
            className="block w-full"
            style={{ aspectRatio: `${work.width} / ${work.height}` }}
          />
        </span>
        {picked && (
          <span className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-blue text-on-blue">
            <Check className="size-4" aria-hidden />
          </span>
        )}
        {work.topPick && !picked && (
          <span className="absolute top-1.5 left-1.5 grid size-6 place-items-center rounded-full bg-bezel/80 text-mat" title="Auswahl des Katalogs">
            <Star className="size-3.5 fill-current" aria-hidden />
          </span>
        )}
        {work.taken && <span className="absolute inset-x-0 top-0 bg-bezel/80 py-0.5 text-center text-[11px] text-mat">schon geholt</span>}
      </button>
      <div className="mt-2 grid gap-0.5">
        <strong className="text-[15px] leading-snug">{work.title}</strong>
        <span className="text-small text-ink-soft">{[work.artist, work.date].filter(Boolean).join(", ")}</span>
        <span className="text-small text-ink-soft">
          {SHORT[work.source]}. {work.licence}
        </span>
        {work.small && (
          <span className="flex items-start gap-1.5 text-small text-yellow-ink">
            <ZoomIn className="mt-px size-4 shrink-0" aria-hidden />
            <span>
              Kleines Bild ({work.width} × {work.height}): der Rahmen vergrößert es
            </span>
          </span>
        )}
        <span className={cn("flex items-start gap-1.5 text-small", fit.kept >= 0.62 ? "text-ink" : "text-yellow-ink")}>
          <Shape className="mt-px size-4 shrink-0" aria-hidden />
          <span>
            {fit.text
              .replace(/^./, (c) => c.toUpperCase())}
            {frames[fit.format] ? ` (${plural(frames[fit.format], "Rahmen", "Rahmen")})` : ": so hängt bei dir kein Rahmen"}
          </span>
        </span>
      </div>
    </li>
  )
}

export function ArtScreen() {
  const settings = useSettings()
  const { data: overview } = useOverview()
  const on = settings.data?.extras.art ?? false
  const [kind, setKind] = useState<"werke" | "fotos">("werke")
  const [text, setText] = useState("")
  const [asked, setAsked] = useState("")
  const [source, setSource] = useState<ArtSource | null>(null)
  const [fits, setFits] = useState<Orientation | null>(null)
  const [topPicks, setTopPicks] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const photos = kind === "fotos"
  const query: ArtQuery = { text: asked || undefined, source: source ?? undefined, fits: fits ?? undefined, topPicks: topPicks || undefined }
  const photoQuery: PhotoQuery = { text: asked || undefined, fits: fits ?? undefined }
  const works = useArtSearch(query, on && !photos)
  const shots = usePhotoSearch(photoQuery, on && photos)
  const found = photos ? shots : works
  const list = found.data?.pages.flatMap((p) => p.items)
  const failed = [...new Set(found.data?.pages.at(-1)?.failed ?? [])]
  const loadWorks = useAct(
    api.importArt,
    (_r, ids) => `${plural(ids.length, "Kunstwerk", "Kunstwerke")} geholt: ${ids.length === 1 ? "liegt" : "liegen"} jetzt im Eingang`,
  )
  const loadPhotos = useAct(
    api.importPhotos,
    (_r, ids) => `${plural(ids.length, "Foto", "Fotos")} geholt: ${ids.length === 1 ? "liegt" : "liegen"} jetzt im Eingang`,
  )
  const load = photos ? loadPhotos : loadWorks
  const switchKind = (next: "werke" | "fotos") => {
    setKind(next)
    setPicked([])
  }
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  const frames = {
    hoch: overview?.frames.filter((f) => f.orientation === "hoch").length ?? 0,
    quer: overview?.frames.filter((f) => f.orientation === "quer").length ?? 0,
  }

  if (settings.data && !on) {
    return (
      <div className="grid gap-6">
        <PageHead title="Kunst" />
        <Banner level="plain" title="Der Kunstkatalog ist ausgeschaltet">
          <p>Eingeschaltet kannst du hier gemeinfreie Kunstwerke aus Museen suchen und in den Eingang holen.</p>
          <Link to="/einstellungen" className="font-semibold text-blue">
            In den Einstellungen einschalten
          </Link>
        </Banner>
      </div>
    )
  }

  return (
    <div data-wide className="grid gap-6">
      <PageHead
        title="Kunst"
        lead="Gemeinfreie Werke aus Museen und Wikimedia Commons, und freie Fotos. Was du auswählst, wird kopiert und landet im Eingang, wie ein Bild aus Immich."
      />

      <Segmented
        label="Was du suchst"
        value={kind}
        onChange={switchKind}
        className="min-[560px]:w-[340px]"
        options={[
          { value: "werke", label: "Kunstwerke" },
          { value: "fotos", label: "Fotos" },
        ]}
      />

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setAsked(text.trim())
        }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-3 left-3 size-5 text-ink-soft" aria-hidden />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={photos ? "Motiv auf Englisch, zum Beispiel: flowers" : "Künstlerin oder Motiv auf Englisch, zum Beispiel: flowers"}
            aria-label={photos ? "Fotos suchen" : "Kunstwerke suchen"}
            className="pl-10"
          />
        </div>
        <Button type="submit">Suchen</Button>
      </form>
      {!asked && (
        <div className="-mt-3 flex flex-wrap items-center gap-2">
          <span className="text-small text-ink-soft">Versuch es mit</span>
          {IDEAS[kind].map((idea) => (
            <Chip
              key={idea}
              pressed={false}
              onClick={() => {
                setText(idea)
                setAsked(idea)
              }}
            >
              {idea}
            </Chip>
          ))}
        </div>
      )}

      <div className="grid gap-2">
        {!photos && (
          <ChipRow label="Sammlung">
            <Chip pressed={!source} onClick={() => setSource(null)}>
              Alle Sammlungen
            </Chip>
            {COLLECTIONS.map((s) => (
              <Chip key={s} pressed={source === s} onClick={() => setSource(source === s ? null : s)}>
                {ART_SOURCES[s]}
              </Chip>
            ))}
          </ChipRow>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <IconFilter
            label="Passt zu Rahmen im"
            value={fits}
            onChange={(v) => setFits(fits === v ? null : (v as Orientation))}
            options={[
              { value: "hoch", label: "Hochformat", icon: RectangleVertical },
              { value: "quer", label: "Querformat", icon: RectangleHorizontal },
            ]}
          />
          {!photos && (
            <Chip pressed={topPicks} onClick={() => setTopPicks(!topPicks)}>
              <Star className="size-4" aria-hidden />
              Auswahl des Katalogs
            </Chip>
          )}
        </div>
      </div>

      <Section
        title={
          asked ? `Gefunden für „${asked}“` : photos ? "Neueste Fotos" : topPicks || !source || source === "wikimedia" ? "Auswahl des Katalogs" : "Gemälde"
        }
        aside={
          <span className="text-small text-ink-soft">
            {list ? `${plural(list.length, photos ? "Foto" : "Werk", photos ? "Fotos" : "Werke")}${found.hasNextPage ? ", es gibt mehr" : ""}` : ""}
          </span>
        }
      >
        {failed.length > 0 && (
          <Banner level="warn" title={`${failed.join(", ")} ${failed.length === 1 ? "hat" : "haben"} gerade nicht geantwortet`}>
            <p>Die Treffer der anderen Sammlungen stehen unten. „Mehr laden“ fragt noch einmal.</p>
          </Banner>
        )}
        {found.isError && !list ? (
          <Empty title="Die Suche hat nicht geklappt">
            <p className="text-ink-soft">{found.error.message}</p>
          </Empty>
        ) : !list ? (
          <div className="grid grid-cols-2 gap-4 min-[560px]:grid-cols-3 min-[1100px]:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholders
              <Skeleton key={i} className="aspect-4/3 w-full rounded-picture" />
            ))}
          </div>
        ) : list.length === 0 && !found.hasNextPage ? (
          <Empty title="Nichts gefunden">
            <p className="text-ink-soft">Versuch ein anderes Wort, auf Englisch, oder nimm einen Filter heraus.</p>
          </Empty>
        ) : (
          <ul
            className={cn(
              "m-0 grid list-none grid-cols-2 items-start gap-x-4 gap-y-7 p-0 min-[560px]:grid-cols-3 min-[1100px]:grid-cols-4",
              found.isFetching && !found.isFetchingNextPage && "opacity-60",
            )}
          >
            {list.map((w) => (
              <Work key={w.id} work={w} picked={picked.includes(w.id)} onPick={() => toggle(w.id)} frames={frames} />
            ))}
          </ul>
        )}
        {found.isFetchNextPageError && (
          <Banner level="warn" title="Weitere Treffer kamen nicht an">
            <p>{found.error?.message} „Mehr laden“ versucht es noch einmal.</p>
          </Banner>
        )}
        {found.hasNextPage && (
          <Button variant="outline" className="justify-self-center" disabled={found.isFetchingNextPage} onClick={() => found.fetchNextPage()}>
            {found.isFetchingNextPage ? "Lädt …" : "Mehr laden"}
          </Button>
        )}
        <p className="text-small text-ink-soft">
          {photos ? (
            <>Alle Fotos stehen unter CC0 und kommen aus dem WordPress-Fotoverzeichnis. Wer sie gemacht hat, bleibt am Bild stehen.</>
          ) : (
            <>
              Alle Werke sind gemeinfrei oder unter CC0 freigegeben. Künstler, Jahr, Sammlung und Lizenz bleiben am Bild stehen. Eine Gruppe kann Kunstwerke von
              selbst untermischen: <Link to="/gruppen">Gruppen öffnen</Link>
            </>
          )}
        </p>
      </Section>

      {picked.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface px-4 py-3 min-[900px]:bottom-0 min-[900px]:left-[216px]">
          <div className="mx-auto flex max-w-[1056px] items-center gap-3">
            <span className="mr-auto text-[15px]">
              <strong>{plural(picked.length, photos ? "Foto" : "Werk", photos ? "Fotos" : "Werke")} gewählt.</strong>{" "}
              <span className="text-ink-soft">Kopien landen im Eingang, noch nicht auf einem Rahmen.</span>
            </span>
            <Button disabled={load.isPending} onClick={() => load.mutate(picked, { onSuccess: () => setPicked([]) })}>
              In den Eingang holen
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
