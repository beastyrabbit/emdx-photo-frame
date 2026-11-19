import { Pause, Play, RotateCcw, Trash2 } from "lucide-react"
import { useEffect, useId, useState } from "react"
import Cropper from "react-easy-crop"
import "react-easy-crop/react-easy-crop.css"
import { Link, useNavigate, useParams } from "react-router"
import { api } from "@/api"
import { useAct, useAlbums, useDiscardInbox, useGroups, useInbox, usePicture } from "@/api/hooks"
import { useFrameMap, usePictureMap } from "@/api/lookups"
import type { Art, Crop, Group, Orientation } from "@/api/types"
import { Banner, Chip, Field, Hint, PageHead, Section, SettingRow } from "@/components/bits"
import { FrameObject, PictureImage, Thumb } from "@/components/picture"
import { Segmented } from "@/components/segmented"
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { artUrl } from "@/lib/art"
import { listDe } from "@/lib/format"
import { ART_SOURCES } from "./art"
import { whereText } from "./library"

const AUTO: Crop = { x: 50, y: 50, zoom: 1, auto: true }
const formatName = (o: Orientation) => (o === "hoch" ? "Hochformat" : "Querformat")
const other = (o: Orientation): Orientation => (o === "hoch" ? "quer" : "hoch")

/** The crop window always has the shape of the frame; the picture moves under it. */
function CropEditor({
  art,
  width,
  height,
  orientation,
  crop,
  onChange,
}: {
  art: Art
  width: number
  height: number
  orientation: Orientation
  crop: Crop
  onChange: (crop: Crop) => void
}) {
  // react-easy-crop keeps its position in pixels; we only store zoom and whether it is still the suggestion.
  const [position, setPosition] = useState(() => (crop.auto ? { x: 0, y: 0 } : { x: (crop.x - 50) * 10, y: (crop.y - 50) * 10 }))
  const helpId = useId()
  // biome-ignore lint/correctness/useExhaustiveDependencies: recentre when the suggestion is restored or the format changes
  useEffect(() => {
    if (crop.auto) setPosition({ x: 0, y: 0 })
  }, [crop.auto, orientation])
  return (
    <div className="grid gap-3">
      <div className="relative h-[52vh] max-h-[460px] min-h-[300px] overflow-hidden rounded-control bg-bezel">
        <Cropper
          image={artUrl(art, Math.round(width / 4), Math.round(height / 4))}
          aspect={orientation === "hoch" ? 9 / 16 : 16 / 9}
          crop={position}
          zoom={crop.zoom}
          minZoom={1}
          maxZoom={3}
          showGrid={false}
          keyboardStep={8}
          cropperProps={{ role: "group", "aria-label": "Zuschnitt: Bild unter dem Fenster verschieben", "aria-describedby": helpId }}
          onCropChange={(p) => {
            setPosition(p)
            if (p.x !== 0 || p.y !== 0) onChange({ ...crop, x: 50 + p.x / 10, y: 50 + p.y / 10, auto: false })
          }}
          onZoomChange={(zoom) => onChange({ ...crop, zoom, auto: false })}
          onCropComplete={(area) => {
            const rect = { x: area.x / 100, y: area.y / 100, width: area.width / 100, height: area.height / 100 }
            if (!crop.auto && JSON.stringify(crop.rect) !== JSON.stringify(rect)) onChange({ ...crop, rect })
          }}
          style={{ cropAreaStyle: { border: "3px solid var(--bezel)", outline: "1px solid rgb(255 255 255 / 0.7)", color: "rgb(10 12 11 / 0.6)" } }}
        />
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[15px] text-ink-soft" aria-hidden>
          Größe
        </span>
        <Slider
          thumbLabel="Bild vergrößern"
          valueText={(zoom) => `${Math.round(zoom * 100)} Prozent`}
          min={1}
          max={3}
          step={0.02}
          value={[crop.zoom]}
          onValueChange={([zoom]) => onChange({ ...crop, zoom, auto: zoom === 1 && crop.auto })}
          className="flex-1"
        />
        <Button variant="ghost" size="sm" disabled={crop.auto} onClick={() => onChange({ ...AUTO })}>
          <RotateCcw />
          Zurück zum Vorschlag
        </Button>
      </div>
      <p className="text-small text-ink-soft">
        {crop.auto
          ? "Automatischer Zuschnitt: Beim Vorbereiten achtet der Server auf Gesichter. Dieses Fenster zeigt zunächst die Bildmitte."
          : "Dein eigener Zuschnitt."}{" "}
        <span id={helpId}>
          Das Fenster hat die Form des Rahmens. Verschieb das Bild darunter mit dem Finger, der Maus oder den Pfeiltasten und vergrößere es mit zwei Fingern
          oder dem Regler.
        </span>
      </p>
    </div>
  )
}

function InboxEdit({ id }: { id: string }) {
  const { data } = useInbox()
  const navigate = useNavigate()
  const byId = usePictureMap()
  const item = data?.find((i) => i.id === id)
  const [orientation, setOrientation] = useState<Orientation | null>(null)
  const [crop, setCrop] = useState<Crop>({ ...AUTO })
  const accept = useAct(
    (edit: { id: string; orientation: Orientation; crop: Crop }) =>
      api.acceptInbox([edit.id], { [edit.id]: { orientation: edit.orientation, crop: edit.crop } }),
    (r, edit) =>
      r.withoutGroup
        ? `Übernommen als ${formatName(edit.orientation)}: in der Bibliothek, noch keiner Gruppe zugeordnet`
        : `Übernommen als ${formatName(edit.orientation)}${edit.crop.auto ? "" : " mit deinem Zuschnitt"}: liegt jetzt im Stapel`,
  )
  const discard = useDiscardInbox()
  if (!data) return <Skeleton className="h-64 w-full" />
  if (!item) return <Banner level="plain" title="Dieses Bild ist nicht mehr im Eingang" />
  const o = orientation ?? item.orientation
  const twin = item.duplicateOf ? byId.get(item.duplicateOf) : undefined
  return (
    <div className="grid gap-6">
      <PageHead title={item.title} back={{ to: "/bibliothek?ansicht=eingang", label: "Eingang" }} lead={`${item.sourceNote}. Noch nicht in der Bibliothek.`} />
      {item.hints.includes("doppelt") && (
        <Banner level="warn" title="Sieht aus wie ein Bild, das du schon hast">
          {twin && (
            <div className="flex items-center gap-3">
              <Thumb picture={twin} byId={byId} className="w-9" />
              <Link to={`/bild/${twin.id}`} className="text-yellow-ink">
                „{twin.title}“ in der Bibliothek
              </Link>
            </div>
          )}
          <p>Übernimmst du es trotzdem, kann dasselbe Bild zweimal im Haus hängen.</p>
        </Banner>
      )}
      {item.hints.includes("zu-klein") && (
        <Banner level="warn" title={`Zu klein: ${item.width} × ${item.height} Punkte`}>
          <p>Der Rahmen hat 2560 × 1440. Das Bild wird stark vergrößert und wirkt unscharf.</p>
        </Banner>
      )}
      {item.hints.includes("unscharf") && <Banner level="warn" title="Wirkt unscharf oder verwackelt" />}
      <Section title="Zuschnitt">
        <Segmented
          label="Format"
          value={o}
          onChange={(v) => {
            setOrientation(v)
            setCrop({ ...AUTO })
          }}
          options={(["hoch", "quer"] as Orientation[]).map((v) => ({ value: v, label: formatName(v), note: v === item.orientation ? "erkannt" : undefined }))}
        />
        <CropEditor art={item.art} width={item.width} height={item.height} orientation={o} crop={crop} onChange={setCrop} />
        <p className="text-[15px]">
          Beim Übernehmen kommt das Bild als <strong>{formatName(o)}</strong> in die Bibliothek,{" "}
          {crop.auto ? "mit dem automatischen Vorschlag als Zuschnitt" : "mit deinem Zuschnitt"}.
        </p>
      </Section>
      <div className="grid gap-2 min-[560px]:flex">
        <Button
          disabled={accept.isPending}
          onClick={() => accept.mutate({ id: item.id, orientation: o, crop }, { onSuccess: () => navigate("/bibliothek?ansicht=eingang") })}
        >
          Übernehmen
        </Button>
        <Button
          variant="ghost"
          className="text-ink-soft"
          onClick={() => discard.mutate([{ id: item.id, title: item.title }], { onSuccess: () => navigate("/bibliothek?ansicht=eingang") })}
        >
          Verwerfen
        </Button>
      </div>
    </div>
  )
}

export function PictureEditScreen() {
  const { id = "" } = useParams()
  if (id.startsWith("eingang-")) return <InboxEdit id={id.slice(8)} />
  return <LibraryEdit id={id} key={id} />
}

function LibraryEdit({ id }: { id: string }) {
  const { data: p } = usePicture(id)
  const albums = useAlbums()
  const groups = useGroups()
  const frames = useFrameMap()
  const byId = usePictureMap()
  const navigate = useNavigate()
  const useForGroup = useAct(
    ({ group, album }: { group: Group; album: string }) => api.saveGroup({ ...group, albums: [...group.albums, album] }),
    (_r, a) => `${a.group.name} zeigt jetzt auch das Album „${a.album}“`,
  )
  const [tab, setTab] = useState<Orientation | null>(null)
  const [crops, setCrops] = useState<Record<Orientation, Crop> | null>(null)
  const [title, setTitle] = useState<string | null>(null)
  const [showOpen, setShowOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const patch = useAct((body: Parameters<typeof api.updatePicture>[1]) => api.updatePicture(id, body))
  const saveCrop = useAct(
    (body: Parameters<typeof api.updatePicture>[1]) => api.updatePicture(id, body),
    () =>
      p?.where.hangs || p?.where.reserved ? "Zuschnitt gespeichert. Der Rahmen bekommt ihn, wenn er sich das nächste Mal meldet" : "Zuschnitt gespeichert",
  )
  const remove = useAct(() => api.deletePicture(id), "Bild gelöscht")

  if (!p) {
    return (
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-[320px] w-full" />
      </div>
    )
  }
  const frameName = (fid: string) => frames.get(fid)?.name ?? "einem Rahmen"
  const o = tab ?? p.orientation
  const current = (crops ?? p.crops)[o]
  const dirty = crops !== null && JSON.stringify(crops[o]) !== JSON.stringify(p.crops[o])
  const onFrame = p.where.hangs ?? p.where.reserved
  const secondName = formatName(other(p.orientation))
  const usedIn = [...byId.values()].filter((x) => x.combo?.memberIds.includes(p.id))
  const inGroups = (groups.data ?? []).filter((g) => p.groupIds.includes(g.id))
  const noGroup = !p.paused && p.groupIds.length === 0

  return (
    <div className="grid gap-7">
      <PageHead title={p.title} back={{ to: "/bibliothek", label: "Bibliothek" }}>
        <Button onClick={() => setShowOpen(true)} disabled={p.paused}>
          Zeigen
        </Button>
      </PageHead>

      <p className="-mt-3">{whereText(p, frameName)}</p>

      {noGroup && (
        <Banner level="plain" title="Noch keiner Gruppe zugeordnet">
          <p>
            {p.albums.length
              ? `Keine Gruppe zeigt ${p.albums.length === 1 ? `das Album „${p.albums[0]}“` : "eines der Alben dieses Bildes"}. Das Bild liegt deshalb in keinem Stapel und kommt von selbst auf keinen Rahmen.`
              : "Das Bild ist in keinem Album. Es liegt deshalb in keinem Stapel und kommt von selbst auf keinen Rahmen."}{" "}
            Mit „Zeigen“ kannst du es trotzdem auf einen Rahmen bringen.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => document.getElementById("alben")?.focus()}>
              Album zuordnen
            </Button>
            {p.albums.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" disabled={useForGroup.isPending}>
                    Für eine Gruppe verwenden
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="bg-surface">
                  {groups.data?.map((g) => (
                    <DropdownMenuItem key={g.id} className="min-h-11 text-body" onSelect={() => useForGroup.mutate({ group: g, album: p.albums[0] })}>
                      {g.name}: Album „{p.albums[0]}“ aufnehmen
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </Banner>
      )}

      {p.combo ? (
        <Section title="Kombiniertes Bild">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-5">
            <FrameObject orientation={p.orientation} className={p.orientation === "hoch" ? "w-[150px]" : "w-[240px] max-w-[52vw]"}>
              <PictureImage picture={p} byId={byId} />
            </FrameObject>
            <div className="grid content-start gap-2 text-[15px]">
              <p>
                Aus {p.combo.memberIds.length} Bildern, liegt im Stapel für {formatName(p.orientation)}. Die einzelnen Bilder kommen weiterhin auch allein vor.
              </p>
              <p className="text-ink-soft">Hängt die Kombination, sind auch ihre Einzelbilder für die Zeit gesperrt, und umgekehrt.</p>
              <ul className="m-0 grid list-none gap-1 p-0">
                {p.combo.memberIds.map((m) => (
                  <li key={m}>
                    <Link to={`/bild/${m}`}>{byId.get(m)?.title ?? m}</Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Section>
      ) : (
        <Section
          title="Zuschnitt"
          aside={
            <Hint>
              Der Rahmen zeigt Bilder randlos. Deshalb hat das Fenster immer die Form des Rahmens. Der Zuschnitt legt fest, ob ein Bild im Hochformat- oder im
              Querformat-Stapel liegt.
            </Hint>
          }
        >
          <Segmented
            label="Format"
            value={o}
            onChange={(v) => setTab(v)}
            options={(["hoch", "quer"] as Orientation[]).map((v) => ({
              value: v,
              label: formatName(v),
              note:
                v === p.orientation
                  ? v === p.detected
                    ? "erkannt, im Stapel"
                    : "im Stapel"
                  : p.alsoOther
                    ? "zweiter Zuschnitt"
                    : v === p.detected
                      ? "erkannt"
                      : undefined,
            }))}
          />
          <CropEditor
            art={p.art}
            width={p.width}
            height={p.height}
            orientation={o}
            crop={current}
            onChange={(c) => setCrops({ ...(crops ?? p.crops), [o]: c })}
          />
          {o !== p.orientation && !p.alsoOther && (
            <Banner level="plain" title={`Dieses Bild liegt bisher im Stapel für ${formatName(p.orientation)}`}>
              <p>
                Du kannst es ganz ins {formatName(o)} umziehen oder zusätzlich als {formatName(o)} verwenden.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={patch.isPending} onClick={() => patch.mutate({ orientation: o })}>
                  Nur noch als {formatName(o)}
                </Button>
                <Button size="sm" variant="outline" disabled={patch.isPending} onClick={() => patch.mutate({ alsoOther: true })}>
                  Auch als {formatName(o)} verwenden
                </Button>
              </div>
            </Banner>
          )}
          {dirty && (
            <div className="grid gap-2 rounded-control border border-blue bg-surface p-3">
              <p className="text-[15px]">
                {onFrame
                  ? `${p.where.hangs ? "Hängt gerade" : "Liegt schon bereit"}: ${frameName(onFrame.frameId)}. Der neue Zuschnitt kommt dort an, wenn sich der Rahmen das nächste Mal meldet. Kostet keinen zusätzlichen Bildaufbau.`
                  : "Der neue Zuschnitt gilt ab dem nächsten Mal, wenn das Bild gezeigt wird."}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={saveCrop.isPending}
                  onClick={() => saveCrop.mutate({ crop: { orientation: o, crop: current } }, { onSuccess: () => setCrops(null) })}
                >
                  Zuschnitt speichern
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCrops(null)}>
                  Verwerfen
                </Button>
              </div>
            </div>
          )}
          <SettingRow
            title={`Auch als ${secondName} verwenden`}
            text={`Legt einen zweiten Zuschnitt an. Das Bild liegt dann in beiden Stapeln, hängt aber nie an zwei Rahmen zugleich.`}
          >
            <Switch
              checked={p.alsoOther}
              disabled={patch.isPending}
              onCheckedChange={(v) => {
                patch.mutate({ alsoOther: v })
                if (v) setTab(other(p.orientation))
              }}
              aria-label={`Auch als ${secondName} verwenden`}
            />
          </SettingRow>
        </Section>
      )}

      <Section title="Angaben">
        <Field label="Name" htmlFor="titel">
          <Input
            id="titel"
            value={title ?? p.title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title?.trim() && title !== p.title && patch.mutate({ title: title.trim() })}
          />
        </Field>
        <div
          id="alben"
          tabIndex={-1}
          className="grid scroll-mt-6 gap-1.5 outline-none focus-visible:[&>div]:outline-2 focus-visible:[&>div]:outline-offset-4 focus-visible:[&>div]:outline-blue"
        >
          <span className="font-semibold">Alben</span>
          <div className="flex flex-wrap gap-2 rounded-control">
            {albums.data?.map((a) => {
              const on = p.albums.includes(a.name)
              return (
                <Chip key={a.name} pressed={on} onClick={() => patch.mutate({ albums: on ? p.albums.filter((x) => x !== a.name) : [...p.albums, a.name] })}>
                  {a.name}
                </Chip>
              )
            })}
          </div>
          <p className="text-small text-ink-soft">
            Über die Alben entscheidet sich, in welchen Gruppen das Bild gezeigt wird.{" "}
            {inGroups.length ? `Im Moment: ${listDe(inGroups.map((g) => g.name))}.` : "Im Moment in keiner."}
          </p>
        </div>
        <p className="text-small text-ink-soft">
          {{ upload: "Hochgeladen", immich: "Aus Immich", kunst: "Aus dem Kunstkatalog", erzeugt: "Aus einem Text erzeugt" }[p.source]}, {p.width} × {p.height}{" "}
          Punkte.{p.artwork ? ` ${p.artwork.artist}, ${p.artwork.date}. ${ART_SOURCES[p.artwork.source]}, ${p.artwork.licence}.` : ""}
          {usedIn.length > 0 && (
            <>
              {" "}
              Teil von:{" "}
              {usedIn.map((c) => (
                <Link key={c.id} to={`/bild/${c.id}`}>
                  {c.title}
                </Link>
              ))}
            </>
          )}
        </p>
      </Section>

      <Section title="Aus dem Stapel nehmen">
        <div className="grid gap-3">
          <div className="grid gap-2 min-[560px]:grid-cols-[1fr_auto] min-[560px]:items-center">
            <p className="text-[15px]">
              <strong>{p.paused ? "Fortsetzen" : "Pausieren"}:</strong>{" "}
              {p.paused ? "Das Bild kommt zurück in den Stapel." : "Das Bild bleibt in der Bibliothek, kommt aber auf keinen Rahmen, bis du es fortsetzt."}
            </p>
            <Button variant="outline" disabled={patch.isPending} onClick={() => patch.mutate({ paused: !p.paused })}>
              {p.paused ? <Play /> : <Pause />}
              {p.paused ? "Fortsetzen" : "Pausieren"}
            </Button>
          </div>
          <div className="grid gap-2 min-[560px]:grid-cols-[1fr_auto] min-[560px]:items-center">
            <p className="text-[15px]">
              <strong>Löschen:</strong> Das Bild ist dann weg.
              {p.where.hangs ? ` Es bleibt hängen (${frameName(p.where.hangs.frameId)}), bis der Rahmen das nächste Mal wechselt.` : ""}
            </p>
            <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 />
              Löschen
            </Button>
          </div>
        </div>
      </Section>

      <ShowSheet pictureIds={[p.id]} open={showOpen} onOpenChange={setShowOpen} />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="bg-surface">
          <AlertDialogHeader>
            <AlertDialogTitle>„{p.title}“ löschen?</AlertDialogTitle>
            <AlertDialogDescription className="text-body text-ink">
              Das Bild ist dann weg und kommt auf keinen Rahmen mehr.
              {p.where.hangs ? ` Es hängt gerade (${frameName(p.where.hangs.frameId)}) und bleibt dort bis zum nächsten Wechsel.` : ""}
              {usedIn.length ? " Kombinierte Bilder, in denen es vorkommt, werden mit gelöscht." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Behalten</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => remove.mutate(undefined, { onSuccess: () => navigate("/bibliothek") })}>
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
