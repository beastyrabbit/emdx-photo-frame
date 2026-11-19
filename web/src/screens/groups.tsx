import { ChevronRight, Plus } from "lucide-react"
import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { api } from "@/api"
import { useAct, useAlbums, useGroups, useOverview, usePictures, useSettings } from "@/api/hooks"
import type { ArtMix, Orientation } from "@/api/types"
import { Banner, Chip, Field, Hint, PageHead, Section } from "@/components/bits"
import { StateMark } from "@/components/marks"
import { Segmented } from "@/components/segmented"
import { FramePanel } from "@/components/test-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { listDe, plural } from "@/lib/format"
import { DeckView } from "./schedule"

export function GroupsScreen() {
  const { data } = useOverview()
  const artOn = useSettings().data?.extras.art ?? false
  return (
    <div className="grid gap-6">
      <PageHead title="Gruppen" lead="Jeder Rahmen gehört zu genau einer Gruppe. Die Gruppe bestimmt das Thema: aus welchen Alben ihre Rahmen Bilder bekommen.">
        <Button asChild variant="outline">
          <Link to="/gruppen/neu">
            <Plus />
            Gruppe anlegen
          </Link>
        </Button>
      </PageHead>
      {!data ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <ul className="m-0 list-none p-0 [&>li:last-child]:border-b">
          {data.groups.map((g) => {
            const frames = data.frames.filter((f) => f.groupId === g.id)
            return (
              <li key={g.id} className="border-t border-line">
                <Link to={`/gruppen/${g.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-4 text-ink no-underline">
                  <div className="grid gap-2">
                    <strong className="text-title">{g.name}</strong>
                    <span className="text-[15px]">
                      Thema: {g.albums.length ? listDe(g.albums) : "noch keine Alben"}
                      {artOn && g.art.every > 0 ? `. Jedes ${g.art.every}. Bild ein Kunstwerk` : ""}
                    </span>
                    <div className="flex items-end gap-2">
                      {frames.map((f) => (
                        <FramePanel key={f.id} frame={f} groupName={g.name} className={f.orientation === "hoch" ? "w-9" : "w-16"} />
                      ))}
                    </div>
                    <span className="text-small text-ink-soft">{frames.length ? listDe(frames.map((f) => f.name)) : "Noch kein Rahmen"}</span>
                  </div>
                  <ChevronRight className="size-5 text-ink-soft" aria-hidden />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-[15px] text-ink-soft">
        Im ganzen Haus gilt: Von selbst kommt kein Bild auf einen zweiten Rahmen, solange es woanders hängt, vorgemerkt ist oder eben erst hing. Das gilt auch
        für Bilder, die zu mehreren Gruppen gehören.
      </p>
    </div>
  )
}

export function GroupDetailScreen() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const isNew = id === "neu"
  const groups = useGroups()
  const { data: overview } = useOverview()
  const albums = useAlbums()
  const group = groups.data?.find((g) => g.id === id)
  const [name, setName] = useState<string | null>(null)
  const [newAlbums, setNewAlbums] = useState<string[]>([])
  const [format, setFormat] = useState<Orientation | null>(null)
  const save = useAct(api.saveGroup)
  const artOn = useSettings().data?.extras.art ?? false
  const pictures = usePictures()

  if (!groups.data || !overview) return <Skeleton className="h-64 w-full" />
  if (!isNew && !group) return <Banner level="plain" title="Diese Gruppe gibt es nicht" />

  const frames = overview.frames.filter((f) => f.groupId === id)
  const current = group ?? { name: "", albums: newAlbums, frameIds: [] }
  const chosen = isNew ? newAlbums : current.albums
  const formats = (["hoch", "quer"] as Orientation[]).filter((o) => frames.some((f) => f.orientation === o))
  const o = format ?? formats[0] ?? "hoch"
  // Works of art the owner took into the library, per format: what "Kunst untermischen" can draw on.
  const works = (pictures.data ?? []).filter((p) => p.source === "kunst" && !p.paused)
  const worksIn = (format: Orientation) => works.filter((p) => p.orientation === format || p.alsoOther).length
  const setArt = (art: ArtMix) => group && save.mutate({ ...group, art })
  const toggleAlbum = (a: string) => {
    const next = chosen.includes(a) ? chosen.filter((x) => x !== a) : [...chosen, a]
    if (isNew) setNewAlbums(next)
    else if (group) save.mutate({ ...group, albums: next })
  }

  return (
    <div className="grid gap-8">
      <PageHead title={isNew ? "Gruppe anlegen" : current.name} back={{ to: "/gruppen", label: "Gruppen" }} />

      <Field label="Name" htmlFor="gruppe-name">
        <Input
          id="gruppe-name"
          value={name ?? current.name}
          placeholder="Obergeschoss"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => group && name?.trim() && name !== group.name && save.mutate({ ...group, name: name.trim() })}
        />
      </Field>

      <Section
        title="Thema"
        aside={
          <Hint>
            Alle Bilder aus diesen Alben kommen in die Stapel der Gruppe. Ein Bild kann in mehreren Alben sein und damit in mehreren Gruppen vorkommen.
          </Hint>
        }
      >
        <div className="flex flex-wrap gap-2">
          {albums.data?.map((a) => (
            <Chip key={a.name} pressed={chosen.includes(a.name)} onClick={() => toggleAlbum(a.name)} count={a.count}>
              {a.name}
            </Chip>
          ))}
        </div>
        <p className="text-small text-ink-soft">
          {chosen.length
            ? "Änderungen am Thema wirken ab den nächsten Bildern, die ein Rahmen bekommt. Was schon an einem Rahmen liegt, bleibt."
            : "Wähle mindestens ein Album."}
        </p>
      </Section>

      {isNew ? (
        <div className="grid gap-2">
          <p className="text-[15px] text-ink-soft">Rahmen ordnest du der Gruppe danach in den Einstellungen des jeweiligen Rahmens zu.</p>
          <Button
            className="w-fit"
            disabled={!name?.trim() || !newAlbums.length || save.isPending}
            onClick={() =>
              save.mutate(
                { name: name?.trim() ?? "", albums: newAlbums, frameIds: [], art: { every: 0, from: "bibliothek" } },
                { onSuccess: (r) => navigate(`/gruppen/${r.id}`) },
              )
            }
          >
            Gruppe anlegen
          </Button>
        </div>
      ) : (
        <>
          <Section title="Rahmen" aside={<span className="text-small text-ink-soft">{plural(frames.length, "Rahmen", "Rahmen")}</span>}>
            {frames.length === 0 ? (
              <p className="text-ink-soft">Noch kein Rahmen in dieser Gruppe. Du ordnest ihn in den Einstellungen des Rahmens zu.</p>
            ) : (
              <ul className="m-0 list-none p-0 [&>li:last-child]:border-b">
                {frames.map((f) => (
                  <li key={f.id} className="border-t border-line">
                    <Link to={`/rahmen/${f.id}`} className="flex min-h-12 items-center gap-3 py-2 text-ink no-underline">
                      <span className="min-w-0 flex-1">
                        <strong>{f.name}</strong>
                        <span className="text-small text-ink-soft">
                          {" "}
                          {f.orientation === "hoch" ? "Hochformat" : "Querformat"}, {f.device}
                        </span>
                      </span>
                      <StateMark level={f.health.level} className="text-[15px] font-normal">
                        {f.health.title}
                      </StateMark>
                      <ChevronRight className="size-5 text-ink-soft" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {artOn && group && (
            <Section
              title="Kunst untermischen"
              aside={
                <Hint>
                  Zwischen den Bildern aus dem Thema liegt dann regelmäßig ein Kunstwerk im Stapel. Für Kunstwerke gilt dasselbe wie für alle Bilder: keines
                  hängt doppelt.
                </Hint>
              }
            >
              <Segmented
                label="Kunst untermischen"
                value={String(group.art.every)}
                onChange={(v) => setArt({ ...group.art, every: Number(v) as ArtMix["every"] })}
                className="min-[560px]:w-fit min-[560px]:min-w-[420px]"
                options={[
                  { value: "0", label: "Aus" },
                  { value: "3", label: "Jedes 3." },
                  { value: "5", label: "Jedes 5." },
                  { value: "10", label: "Jedes 10." },
                ]}
              />
              {group.art.every === 0 ? (
                <p className="text-[15px] text-ink-soft">Die Rahmen dieser Gruppe zeigen nur Bilder aus dem Thema.</p>
              ) : (
                <>
                  <p className="text-[15px]">Jedes {group.art.every}. Bild in den Stapeln dieser Gruppe ist ein Kunstwerk.</p>
                  <Segmented
                    label="Welche Kunstwerke"
                    value={group.art.from}
                    onChange={(v) => setArt({ ...group.art, from: v })}
                    className="min-[560px]:w-fit min-[560px]:min-w-[420px]"
                    options={[
                      { value: "bibliothek", label: "Meine Kunstwerke", note: `${works.length} in der Bibliothek` },
                      { value: "katalog", label: "Auswahl des Katalogs", note: "kommt von selbst" },
                    ]}
                  />
                  {group.art.from === "katalog" ? (
                    <p className="text-small text-ink-soft">
                      Die Auswahl des Katalogs kommt ohne Umweg über den Eingang in die Bibliothek. Du findest die Werke dort unter der Quelle „Kunst“ und
                      kannst jedes pausieren.
                    </p>
                  ) : works.length === 0 ? (
                    <Banner level="warn" title="Noch kein Kunstwerk in der Bibliothek">
                      <p>Solange keines da ist, bleibt es bei den Bildern aus dem Thema.</p>
                      <Link to="/kunst" className="font-semibold text-yellow-ink">
                        Kunst aussuchen
                      </Link>
                    </Banner>
                  ) : (
                    <p className="text-small text-ink-soft">
                      Bereit: {worksIn("hoch")} im Hochformat, {worksIn("quer")} im Querformat. <Link to="/kunst">Mehr Kunst aussuchen</Link>
                    </p>
                  )}
                </>
              )}
            </Section>
          )}

          {frames.length > 0 && (
            <Section
              title="Stapel"
              aside={
                <Hint>
                  Jede Gruppe hat einen gemischten Stapel pro Format. Ist er leer, wird neu gemischt; was zuletzt hing, kommt nach unten. Du kannst die
                  Reihenfolge selbst ändern.
                </Hint>
              }
            >
              {formats.length > 1 && (
                <Segmented
                  label="Format"
                  value={o}
                  onChange={setFormat}
                  className="min-[560px]:w-fit min-[560px]:min-w-[320px]"
                  options={formats.map((v) => ({ value: v, label: v === "hoch" ? "Hochformat" : "Querformat" }))}
                />
              )}
              <DeckView groupId={id} orientation={o} key={`${id}/${o}`} />
            </Section>
          )}
        </>
      )}
    </div>
  )
}
