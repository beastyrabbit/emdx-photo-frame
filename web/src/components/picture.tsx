import { cn } from "cn"
import type { Art, ComboLayout, Orientation, Picture } from "@/api/types"
import { artUrl } from "@/lib/art"

const COMBO_GRID: Record<ComboLayout, string> = {
  "2-nebeneinander": "grid-cols-2",
  "3-nebeneinander": "grid-cols-3",
  "2-uebereinander": "grid-rows-2",
  "2x2": "grid-cols-2 grid-rows-2",
}

/** One picture as an image that fills its box. */
export function ArtImage({ art, className, alt = "" }: { art: Art; className?: string; alt?: string }) {
  return <img src={artUrl(art)} alt={alt} draggable={false} className={cn("block size-full object-cover", className)} />
}

/** A picture or a combined picture, filling its box. */
export function PictureImage({
  picture,
  byId,
  className,
}: {
  picture: Pick<Picture, "art" | "combo" | "title">
  byId?: Map<string, Picture>
  className?: string
}) {
  if (picture.combo && byId) {
    return (
      <div className={cn("grid size-full gap-px bg-mat", COMBO_GRID[picture.combo.layout], className)}>
        {picture.combo.memberIds.map((id) => {
          const member = byId.get(id)
          return member ? <ArtImage key={id} art={member.art} className="min-h-0 min-w-0" /> : <div key={id} className="bg-sunken" />
        })}
      </div>
    )
  }
  return <ArtImage art={picture.art} className={className} />
}

/**
 * A frame as an object: dark bezel, nearly square corners, its real shape.
 * `unsure` hatches the picture: the server does not know whether the panel shows it.
 */
export function FrameObject({
  orientation,
  unsure = false,
  className,
  children,
  label,
}: {
  orientation: Orientation
  unsure?: boolean
  className?: string
  children: React.ReactNode
  label?: string
}) {
  return (
    <div
      {...(label ? { role: "img", "aria-label": label } : {})}
      className={cn(
        "relative shrink-0 rounded-[3px] bg-bezel p-[3px] shadow-(--shadow-frame)",
        orientation === "hoch" ? "aspect-9/16" : "aspect-video",
        className,
      )}
    >
      <div className={cn("relative size-full overflow-hidden rounded-[1px] bg-sunken", unsure && "hatched")}>{children}</div>
    </div>
  )
}

/** A small picture for lists, in the shape of the deck it is in. */
export function Thumb({
  picture,
  byId,
  orientation,
  className,
}: {
  picture: Pick<Picture, "art" | "combo" | "title" | "orientation">
  byId?: Map<string, Picture>
  orientation?: Orientation
  className?: string
}) {
  const o = orientation ?? picture.orientation
  return (
    <div className={cn("shrink-0 overflow-hidden rounded-picture bg-sunken", o === "hoch" ? "aspect-9/16" : "aspect-video", className)}>
      <PictureImage picture={picture} byId={byId} />
    </div>
  )
}
