import { cn } from "cn"
import { Link } from "react-router"
import type { Frame, Group } from "@/api/types"
import { FramePanel } from "@/components/test-card"

const DOT = { ok: "", warn: "bg-yellow", bad: "bg-red" }

function Mini({ frame, groupName, small }: { frame: Frame; groupName: string; small?: boolean }) {
  return (
    <span className="relative block">
      <FramePanel frame={frame} groupName={groupName} className={frame.orientation === "hoch" ? (small ? "w-6" : "w-8") : small ? "w-[38px]" : "w-14"} />
      {frame.health.level !== "ok" && (
        <span aria-hidden className={cn("absolute -top-1 -right-1 size-2.5 rounded-full shadow-[0_0_0_2px_var(--paper)]", DOT[frame.health.level])} />
      )}
    </span>
  )
}

/** A stack of cards: the deck of a group. */
function DeckGlyph() {
  return (
    <span aria-hidden className="relative block h-[46px] w-[38px]">
      <span className="absolute inset-x-0 top-0 h-9 rotate-[-8deg] rounded-[3px] border border-line bg-sunken" />
      <span className="absolute inset-x-0 top-1 h-9 rotate-[5deg] rounded-[3px] border border-line bg-surface" />
      <span className="absolute inset-x-0 top-2.5 h-9 rounded-[3px] border-2 border-ink bg-surface" />
    </span>
  )
}

const TILE =
  "grid w-[84px] justify-items-center gap-1 rounded-control border-2 border-transparent px-1 pt-2 pb-1.5 text-center text-[12px] leading-tight text-ink no-underline hover:bg-sunken aria-[current=true]:border-ink aria-[current=true]:bg-surface aria-[current=true]:font-semibold"

/**
 * Picks a frame by its picture: the frames as they hang, group by group.
 * With `deckTo`, every group also offers its deck. `compact` is one row of pictures without names,
 * for switching between frames on a frame's own page.
 */
export function FramePicker({
  frames,
  groups,
  frameId,
  groupId,
  frameTo,
  deckTo,
  compact = false,
  label,
}: {
  frames: Frame[]
  groups: Group[]
  /** The chosen frame, or the chosen group's deck. */
  frameId?: string
  groupId?: string
  frameTo: (frame: Frame) => string
  deckTo?: (group: Group) => string
  compact?: boolean
  label: string
}) {
  const groupName = (id: string) => groups.find((g) => g.id === id)?.name ?? ""
  if (compact) {
    return (
      <nav aria-label={label} className="flex flex-wrap items-end gap-y-1">
        {groups.flatMap((g, n) =>
          frames
            .filter((f) => f.groupId === g.id)
            .map((f, i) => (
              <Link
                key={f.id}
                to={frameTo(f)}
                replace
                title={f.name}
                aria-label={f.id === frameId ? `${f.name}, dieser Rahmen` : f.name}
                aria-current={f.id === frameId ? "true" : undefined}
                className={cn(
                  "grid h-[58px] min-w-11 flex-1 place-items-end justify-center border-b-[3px] border-transparent px-[3px] pb-1.5 hover:bg-sunken aria-[current=true]:border-ink min-[560px]:flex-none",
                  // A hairline where one group ends and the next begins.
                  n > 0 && i === 0 && "shadow-[-1px_0_0_var(--line)]",
                )}
              >
                <Mini frame={f} groupName={g.name} small />
              </Link>
            )),
        )}
      </nav>
    )
  }
  return (
    <nav aria-label={label} className="flex flex-wrap gap-x-5 gap-y-3">
      {groups.map((g) => {
        const own = frames.filter((f) => f.groupId === g.id)
        return (
          <section key={g.id} aria-label={g.name} className="grid content-start gap-1">
            <h2 className="px-1 text-small font-normal text-ink-soft">{g.name}</h2>
            <ul className="m-0 flex list-none flex-wrap items-stretch p-0">
              {own.map((f) => (
                <li key={f.id} className="flex">
                  <Link to={frameTo(f)} replace aria-label={f.name} aria-current={f.id === frameId ? "true" : undefined} className={TILE}>
                    <span className="grid h-[57px] place-items-end">
                      <Mini frame={f} groupName={groupName(f.groupId)} />
                    </span>
                    <span>{f.name}</span>
                  </Link>
                </li>
              ))}
              {deckTo && (
                <li className="flex">
                  <Link to={deckTo(g)} replace aria-current={g.id === groupId ? "true" : undefined} aria-label={`Stapel von ${g.name}`} className={TILE}>
                    <span className="grid h-[57px] place-items-end">
                      <DeckGlyph />
                    </span>
                    <span>Stapel</span>
                  </Link>
                </li>
              )}
            </ul>
          </section>
        )
      })}
    </nav>
  )
}
