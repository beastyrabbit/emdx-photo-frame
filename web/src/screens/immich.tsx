import { cn } from "cn"
import { Check, Heart, Search } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router"
import { api } from "@/api"
import { useAct, useImmich, useImmichSearch } from "@/api/hooks"
import type { ImmichQuery } from "@/api/types"
import { Banner, Chip, ChipRow, Empty, PageHead, Section, SettingRow } from "@/components/bits"
import { ArtImage } from "@/components/picture"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { DAY, now } from "@/lib/clock"
import { fmtWhen, plural } from "@/lib/format"

const PERIODS = [
  { id: "alle", label: "Jede Zeit", days: 0 },
  { id: "30", label: "Letzte 30 Tage", days: 30 },
  { id: "365", label: "Letztes Jahr", days: 365 },
  { id: "730", label: "Letzte 2 Jahre", days: 730 },
]
const IDEAS = ["Katze", "Strand", "Berge", "Geburtstag", "Weihnachten"]

export function ImmichScreen() {
  const immich = useImmich()
  const [text, setText] = useState("")
  const [asked, setAsked] = useState("")
  const [people, setPeople] = useState<string[]>([])
  const [album, setAlbum] = useState("alle")
  const [favorites, setFavorites] = useState(false)
  const [period, setPeriod] = useState("alle")
  const [picked, setPicked] = useState<string[]>([])

  const days = PERIODS.find((p) => p.id === period)?.days ?? 0
  const query: ImmichQuery = {
    text: asked || undefined,
    personIds: people.length ? people : undefined,
    albumId: album === "alle" ? undefined : album,
    favorites: favorites || undefined,
    from: days ? now() - days * DAY - ((now() - days * DAY) % DAY) : undefined,
  }
  const found = useImmichSearch(query)
  const load = useAct(
    api.importFromImmich,
    (_r, ids) => `${plural(ids.length, "Bild", "Bilder")} geholt: ${ids.length === 1 ? "liegt" : "liegen"} jetzt im Eingang`,
  )
  const subscribe = useAct(
    ({ id, on }: { id: string; on: boolean }) => api.subscribeAlbum(id, on),
    (_r, a) => (a.on ? "Album abonniert" : "Abo beendet"),
  )
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  const fresh = (found.data ?? []).filter((a) => !a.imported)

  if (immich.data && !immich.data.connected) {
    return (
      <div className="grid gap-6">
        <PageHead title="Aus Immich holen" back={{ to: "/bibliothek", label: "Bibliothek" }} />
        <Banner level="warn" title="Immich ist nicht verbunden">
          <p>Der Schlüssel fehlt oder funktioniert nicht mehr.</p>
          <Link to="/einstellungen/zugaenge" className="font-semibold text-yellow-ink">
            Zugänge öffnen
          </Link>
        </Banner>
      </div>
    )
  }

  return (
    <div data-wide className="grid gap-6">
      <PageHead
        title="Aus Immich holen"
        back={{ to: "/bibliothek", label: "Bibliothek" }}
        lead="Such in deiner Immich-Bibliothek und wähle Bilder aus. Sie werden kopiert und landen im Eingang. In Immich ändert sich nichts."
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
            placeholder="Was ist auf dem Bild? Zum Beispiel: Katze am Fenster"
            aria-label="In Immich suchen"
            className="pl-10"
          />
        </div>
        <Button type="submit">Suchen</Button>
      </form>
      {!asked && (
        <div className="-mt-3 flex flex-wrap items-center gap-2">
          <span className="text-small text-ink-soft">Versuch es mit</span>
          {IDEAS.map((idea) => (
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
        {/* The label sits above the row: inside it, it scrolled under the first chip on the phone. */}
        <span className="-mb-1 text-small text-ink-soft" aria-hidden>
          Personen
        </span>
        <ChipRow label="Personen">
          {immich.data?.people.map((p) => (
            <Chip
              key={p.id}
              pressed={people.includes(p.id)}
              onClick={() => setPeople((cur) => (cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id]))}
              count={p.count}
            >
              {p.name}
            </Chip>
          ))}
        </ChipRow>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={album} onValueChange={setAlbum}>
            <SelectTrigger className="h-9 bg-surface text-[15px]" aria-label="Immich-Album">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="alle">Alle Alben</SelectItem>
              {immich.data?.albums.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} ({a.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="h-9 bg-surface text-[15px]" aria-label="Zeitraum">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Chip pressed={favorites} onClick={() => setFavorites(!favorites)}>
            <Heart className="size-4" aria-hidden />
            Nur Favoriten
          </Chip>
        </div>
      </div>

      <Section
        title={asked ? `Gefunden für „${asked}“` : "Bilder"}
        aside={
          <span className="flex items-center gap-3 text-small text-ink-soft">
            {found.data ? plural(found.data.length, "Bild", "Bilder") : ""}
            {fresh.length > 0 && (
              <button
                type="button"
                className="-my-2 -mr-3 inline-flex min-h-11 min-w-11 items-center justify-center rounded-control px-3 font-semibold text-blue"
                onClick={() => setPicked(picked.length === fresh.length ? [] : fresh.map((a) => a.id))}
              >
                {picked.length === fresh.length ? "Keine wählen" : "Alle wählen"}
              </button>
            )}
          </span>
        }
      >
        {!found.data ? (
          <div className="grid grid-cols-3 gap-2 min-[560px]:grid-cols-5 min-[900px]:grid-cols-7">
            {Array.from({ length: 14 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholders
              <Skeleton key={i} className="aspect-square w-full rounded-picture" />
            ))}
          </div>
        ) : found.data.length === 0 ? (
          <Empty title="Nichts gefunden">
            <p className="text-ink-soft">Versuch ein anderes Wort oder nimm einen Filter heraus.</p>
          </Empty>
        ) : (
          <ul className={cn("m-0 grid list-none grid-cols-3 gap-2 p-0 min-[560px]:grid-cols-5 min-[900px]:grid-cols-7", found.isFetching && "opacity-60")}>
            {found.data.map((a) => {
              const on = picked.includes(a.id)
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    disabled={a.imported}
                    aria-pressed={on}
                    aria-label={`${a.title}${a.album ? `, Album ${a.album}` : ""}${a.imported ? ", schon geholt" : ""}`}
                    onClick={() => toggle(a.id)}
                    className="relative block w-full overflow-hidden rounded-picture"
                  >
                    <div className={cn("aspect-square bg-sunken", a.imported && "opacity-40", on && "outline-3 -outline-offset-3 outline-blue")}>
                      <ArtImage art={a.art} />
                    </div>
                    {on && (
                      <span className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-blue text-on-blue">
                        <Check className="size-4" aria-hidden />
                      </span>
                    )}
                    {a.favorite && <Heart className="absolute bottom-1 left-1 size-4 fill-mat text-mat" aria-label="Favorit" />}
                    {a.imported && <span className="absolute inset-x-0 bottom-0 bg-bezel/80 py-0.5 text-center text-[11px] text-mat">schon geholt</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Section title="Alben abonnieren">
        <p className="text-[15px] text-ink-soft">Kommt in Immich ein Bild in ein abonniertes Album, landet es von selbst im Eingang.</p>
        <div className="grid gap-4">
          {immich.data?.albums.map((a) => (
            <SettingRow
              key={a.id}
              title={a.name}
              text={a.subscribed ? `${a.count} Bilder. Zuletzt abgeglichen ${a.lastSync ? fmtWhen(a.lastSync) : "noch nie"}` : `${a.count} Bilder`}
            >
              <Switch
                checked={a.subscribed}
                disabled={subscribe.isPending}
                onCheckedChange={(on) => subscribe.mutate({ id: a.id, on })}
                aria-label={`${a.name} abonnieren`}
              />
            </SettingRow>
          ))}
        </div>
      </Section>

      {picked.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface px-4 py-3 min-[900px]:bottom-0 min-[900px]:left-[216px]">
          <div className="mx-auto flex max-w-[1056px] items-center gap-3">
            <span className="mr-auto text-[15px]">
              <strong>{plural(picked.length, "Bild", "Bilder")} gewählt.</strong>{" "}
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
