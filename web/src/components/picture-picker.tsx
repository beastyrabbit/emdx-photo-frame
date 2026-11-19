import { cn } from "cn"
import { Check } from "lucide-react"
import { useEffect, useState } from "react"
import { useAlbums, usePictures } from "@/api/hooks"
import { usePictureMap } from "@/api/lookups"
import type { Orientation, Picture } from "@/api/types"
import { Chip, ChipRow } from "@/components/bits"
import { Thumb } from "@/components/picture"
import { Sheet } from "@/components/sheet"
import { Button } from "@/components/ui/button"
import { plural } from "@/lib/format"

/** Pick several pictures from the library, e.g. for an Event or a combined picture. */
export function PicturePicker({
  open,
  onOpenChange,
  title,
  selected,
  onDone,
  filter,
  max,
  orientation,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  selected: string[]
  onDone: (ids: string[]) => void
  filter?: (p: Picture) => boolean
  max?: number
  orientation?: Orientation
}) {
  const { data } = usePictures()
  const albums = useAlbums()
  const byId = usePictureMap()
  const [album, setAlbum] = useState<string | null>(null)
  const [ids, setIds] = useState<string[]>(selected)
  // biome-ignore lint/correctness/useExhaustiveDependencies: start from the current selection each time it opens
  useEffect(() => {
    if (open) setIds(selected)
  }, [open])

  const list = (data ?? []).filter(
    (p) => !p.paused && (!filter || filter(p)) && (!album || p.albums.includes(album)) && (!orientation || p.orientation === orientation),
  )
  const toggle = (id: string) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : max && cur.length >= max ? cur : [...cur, id]))
  const addAlbum = () => setIds((cur) => [...cur, ...list.map((p) => p.id).filter((id) => !cur.includes(id))].slice(0, max ?? Infinity))

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={max ? `Bis zu ${max} Bilder. Die Reihenfolge ist die, in der du sie antippst.` : "Die Reihenfolge ist die, in der du sie antippst."}
    >
      <ChipRow label="Album">
        <Chip pressed={!album} onClick={() => setAlbum(null)}>
          Alle
        </Chip>
        {albums.data?.map((a) => (
          <Chip key={a.name} pressed={album === a.name} onClick={() => setAlbum(a.name)} count={a.count}>
            {a.name}
          </Chip>
        ))}
      </ChipRow>
      {album && !max && (
        <Button variant="outline" size="sm" className="w-fit" onClick={addAlbum}>
          Alle {list.length} aus „{album}“ dazunehmen
        </Button>
      )}
      <ul className="m-0 grid max-h-[46vh] list-none grid-cols-4 gap-2 overflow-y-auto p-0.5 min-[560px]:grid-cols-5">
        {list.map((p) => {
          const n = ids.indexOf(p.id)
          return (
            <li key={p.id}>
              <button type="button" aria-pressed={n >= 0} aria-label={p.title} onClick={() => toggle(p.id)} className="relative block w-full rounded-picture">
                <Thumb picture={p} byId={byId} orientation="hoch" className={cn("w-full", n >= 0 && "outline-3 outline-offset-1 outline-blue")} />
                {n >= 0 && (
                  <span className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-blue text-[12px] font-bold text-on-blue">
                    {max ? <Check className="size-4" /> : n + 1}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[15px] text-ink-soft">{plural(ids.length, "Bild gewählt", "Bilder gewählt")}</span>
        <div className="flex gap-2">
          {ids.length > 0 && (
            <Button variant="ghost" onClick={() => setIds([])}>
              Leeren
            </Button>
          )}
          <Button
            onClick={() => {
              onDone(ids)
              onOpenChange(false)
            }}
          >
            Übernehmen
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
