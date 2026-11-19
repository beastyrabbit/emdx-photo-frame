import { cn } from "cn"
import { Plus } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router"
import { api } from "@/api"
import { useAct, usePictures } from "@/api/hooks"
import { usePictureMap } from "@/api/lookups"
import type { ComboLayout, Orientation } from "@/api/types"
import { PageHead, Section } from "@/components/bits"
import { ArtImage, FrameObject, Thumb } from "@/components/picture"
import { PicturePicker } from "@/components/picture-picker"
import { Button } from "@/components/ui/button"

const LAYOUTS: { id: ComboLayout; name: string; count: number; result: Orientation; grid: string; members: Orientation }[] = [
  { id: "2-uebereinander", name: "2 übereinander", count: 2, result: "hoch", grid: "grid-rows-2", members: "quer" },
  { id: "2x2", name: "4 im Quadrat", count: 4, result: "hoch", grid: "grid-cols-2 grid-rows-2", members: "hoch" },
  { id: "2-nebeneinander", name: "2 nebeneinander", count: 2, result: "quer", grid: "grid-cols-2", members: "hoch" },
  { id: "3-nebeneinander", name: "3 nebeneinander", count: 3, result: "quer", grid: "grid-cols-3", members: "hoch" },
]

/** Builds a new picture out of 2 to 4 pictures. It gets its own place in the deck. */
export function CombineScreen() {
  const navigate = useNavigate()
  const { data } = usePictures()
  const byId = usePictureMap()
  const [layoutId, setLayoutId] = useState<ComboLayout>("2-uebereinander")
  const [ids, setIds] = useState<string[]>([])
  const [picking, setPicking] = useState(false)
  const create = useAct(() => api.createCombo(layoutId, ids), "Kombiniertes Bild angelegt: liegt jetzt im Stapel")
  const layout = LAYOUTS.find((l) => l.id === layoutId) ?? LAYOUTS[0]
  const slots = Array.from({ length: layout.count }, (_, i) => ids[i])

  // Suggestions: two pictures of the fitting shape from the same album, taken close together.
  const pool = (data ?? []).filter((p) => !p.combo && !p.paused && p.orientation === layout.members && !p.where.hangs)
  const suggestions: string[][] = []
  for (let i = 0; i + layout.count <= pool.length && suggestions.length < 3; i += layout.count + 3) {
    const group = pool.slice(i, i + layout.count)
    if (group.every((g) => g.albums[0] === group[0].albums[0])) suggestions.push(group.map((g) => g.id))
  }

  return (
    <div className="grid gap-7">
      <PageHead
        title="Bilder kombinieren"
        back={{ to: "/bibliothek", label: "Bibliothek" }}
        lead="Mehrere Bilder werden zu einem neuen Bild. Es liegt als eigene Karte im Stapel; die einzelnen Bilder kommen weiterhin auch allein vor."
      />

      <Section title="Anordnung">
        <div role="radiogroup" aria-label="Anordnung" className="grid grid-cols-2 gap-3 min-[560px]:grid-cols-4">
          {LAYOUTS.map((l) => (
            // biome-ignore lint/a11y/useSemanticElements: a picture choice, styled as a card
            <button
              key={l.id}
              type="button"
              role="radio"
              aria-checked={l.id === layoutId}
              onClick={() => {
                setLayoutId(l.id)
                setIds([])
              }}
              className={cn(
                "grid justify-items-center gap-2 rounded-control border bg-surface px-2 py-3 text-[15px]",
                l.id === layoutId ? "border-ink font-semibold outline-2 outline-ink" : "border-line",
              )}
            >
              <span className={cn("grid gap-0.5 rounded-[2px] bg-bezel p-0.5", l.grid, l.result === "hoch" ? "h-16 w-9" : "h-9 w-16")}>
                {Array.from({ length: l.count }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed diagram cells
                  <span key={i} className="bg-sunken" />
                ))}
              </span>
              {l.name}
              <span className="text-small font-normal text-ink-soft">für {l.result === "hoch" ? "Hochformat" : "Querformat"}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Bilder">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-5">
          <FrameObject orientation={layout.result} className={layout.result === "hoch" ? "w-[150px]" : "w-[230px] max-w-[50vw]"}>
            <div className={cn("grid size-full gap-px bg-mat", layout.grid)}>
              {slots.map((id, i) => {
                const p = id ? byId.get(id) : undefined
                return p ? (
                  <ArtImage key={id} art={p.art} className="min-h-0 min-w-0" />
                ) : (
                  <button
                    // biome-ignore lint/suspicious/noArrayIndexKey: empty slots have no id
                    key={i}
                    type="button"
                    onClick={() => setPicking(true)}
                    aria-label={`Bild ${i + 1} wählen`}
                    className="grid place-items-center bg-sunken text-ink-soft"
                  >
                    <Plus className="size-5" />
                  </button>
                )
              })}
            </div>
          </FrameObject>
          <div className="grid content-start gap-3">
            <p className="text-[15px]">
              {ids.length < layout.count
                ? `Wähle ${layout.count} Bilder. Am besten passen Bilder im ${layout.members === "hoch" ? "Hochformat" : "Querformat"}.`
                : "So sieht es auf dem Rahmen aus."}
            </p>
            <Button variant="outline" className="w-fit" onClick={() => setPicking(true)}>
              {ids.length ? "Bilder ändern" : "Bilder wählen"}
            </Button>
          </div>
        </div>
      </Section>

      {suggestions.length > 0 && ids.length === 0 && (
        <Section title="Vorschläge">
          <p className="text-[15px] text-ink-soft">Bilder aus demselben Album, die zusammenpassen könnten. Nichts wird von selbst kombiniert.</p>
          <ul className="m-0 grid list-none gap-3 p-0">
            {suggestions.map((s) => (
              <li key={s.join()} className="flex items-center gap-3 border-t border-line pt-3">
                <div className="flex gap-1">
                  {s.map((id) => {
                    const p = byId.get(id)
                    return p ? <Thumb key={id} picture={p} byId={byId} className={p.orientation === "hoch" ? "w-9" : "w-16"} /> : null
                  })}
                </div>
                <span className="min-w-0 flex-1 truncate text-[15px]">{s.map((id) => byId.get(id)?.title).join(" + ")}</span>
                <Button size="sm" variant="outline" onClick={() => setIds(s)}>
                  Übernehmen
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="grid gap-2">
        <p className="text-[15px] text-ink-soft">
          Das neue Bild kommt in den Stapel für {layout.result === "hoch" ? "Hochformat" : "Querformat"}. Auf einem Rahmen erscheint es erst, wenn es an der
          Reihe ist oder du es zeigst.
        </p>
        <Button
          className="w-fit"
          disabled={ids.length !== layout.count || create.isPending}
          onClick={() => create.mutate(undefined, { onSuccess: (r) => navigate(`/bild/${r.id}`) })}
        >
          Kombiniertes Bild anlegen
        </Button>
      </div>

      <PicturePicker
        open={picking}
        onOpenChange={setPicking}
        title={`${layout.count} Bilder wählen`}
        selected={ids}
        onDone={setIds}
        max={layout.count}
        filter={(p) => !p.combo}
      />
    </div>
  )
}
