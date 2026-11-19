import { ImageOff } from "lucide-react"
import { usePictureMap } from "@/api/lookups"
import type { Frame, TestCardKind } from "@/api/types"
import { FrameObject, PictureImage } from "@/components/picture"
import { Skeleton } from "@/components/ui/skeleton"
import { dayDiff, fmtDay, fmtTime, fmtWhen } from "@/lib/format"

const BARS = ["#1c1c1c", "#b5302a", "#e3b400", "#2f7a4c", "#24509a", "#f2f2ee"]

/** "Heute 09:38 bis 10:00", or "Heute 09:38 bis morgen 07:00" when the card stays over night. */
export function cardSlot(from: number, until: number): string {
  const end = dayDiff(until, from) === 0 ? fmtTime(until) : fmtWhen(until)
  return `${fmtDay(from).replace(/^./, (c) => c.toUpperCase())} ${fmtTime(from)} bis ${end}`
}

/**
 * What the frame shows for an Erkennungsbild or a Testbild.
 * Test content always says what it is for and when: the frame, the time slot, what is being checked.
 */
export function TestCard({
  kind,
  frame,
  groupName,
  from,
  until,
  className,
}: {
  kind: TestCardKind
  frame: Pick<Frame, "name" | "device" | "ip" | "orientation">
  groupName: string
  /** When the card appears on the panel. */
  from: number
  /** The frame's next change after that: the card stays until then. */
  until: number
  className?: string
}) {
  const slot = cardSlot(from, until)
  const hoch = frame.orientation === "hoch"
  return (
    <FrameObject
      orientation={frame.orientation}
      className={className}
      label={`${kind === "erkennungsbild" ? "Erkennungsbild" : "Testbild"} für ${frame.name}, ${slot}`}
    >
      {/* Text sizes follow the card's width, so the preview reads the same at any size. */}
      <div className="@container size-full bg-[#f2f2ee] text-[#1c1c1c]">
        <div className={`flex size-full flex-col items-center justify-between text-center ${hoch ? "p-[7cqw]" : "p-[4cqw]"}`}>
          <div className="grid justify-items-center">
            <span className={`leading-none font-bold ${hoch ? "text-[9cqw]" : "text-[5cqw]"}`}>▲ OBEN</span>
          </div>
          {kind === "erkennungsbild" ? (
            <div className="grid gap-[1.5cqw]">
              <span className={hoch ? "text-[5cqw]" : "text-[3cqw]"}>Erkennungsbild: Das ist der Rahmen</span>
              <span className={`leading-[1.05] font-bold ${hoch ? "text-[13cqw]" : "text-[8cqw]"}`}>{frame.name}</span>
              <span className={hoch ? "text-[5cqw]" : "text-[3cqw]"}>
                {frame.device}, {frame.ip}
                <br />
                Gruppe {groupName}
              </span>
            </div>
          ) : (
            <div className="grid w-full gap-[2cqw]">
              <span className={hoch ? "text-[5cqw]" : "text-[3cqw]"}>Testbild für</span>
              <span className={`leading-[1.05] font-bold ${hoch ? "text-[11cqw]" : "text-[7cqw]"}`}>{frame.name}</span>
              <div className={`mx-auto flex w-[78%] border border-[#1c1c1c] ${hoch ? "h-[26cqw]" : "h-[11cqw]"}`}>
                {BARS.map((c) => (
                  <span key={c} className="flex-1" style={{ background: c }} />
                ))}
              </div>
              <span className={hoch ? "text-[4.4cqw]" : "text-[2.7cqw]"}>
                Geprüft wird: Ist OBEN oben? Sind es sechs klare Farben: Schwarz, Rot, Gelb, Grün, Blau, Weiß? Ist die Schrift scharf?
              </span>
            </div>
          )}
          <span className={hoch ? "text-[4.4cqw]" : "text-[2.7cqw]"}>
            {slot}
            <br />
            Danach kommt das nächste Bild.
          </span>
        </div>
      </div>
    </FrameObject>
  )
}

/**
 * The frame as an object with what its panel shows right now: a picture, a test card the frame
 * confirmed, or nothing of ours yet (a frame that was just added).
 */
export function FramePanel({
  frame,
  groupName,
  className,
}: {
  frame: Pick<Frame, "name" | "device" | "ip" | "orientation" | "current">
  groupName: string
  className?: string
}) {
  const pictures = usePictureMap()
  const { card, pictureId, since, unsure } = frame.current
  if (card) return <TestCard kind={card.kind} frame={frame} groupName={groupName} from={since} until={card.until} className={className} />
  const picture = pictureId ? pictures.get(pictureId) : undefined
  return (
    <FrameObject
      orientation={frame.orientation}
      unsure={unsure}
      className={className}
      label={picture ? `Am Rahmen: ${picture.title}` : pictureId ? undefined : `${frame.name}: noch kein Bild von hier`}
    >
      {picture ? (
        <PictureImage picture={picture} byId={pictures} />
      ) : pictureId ? (
        <Skeleton className="size-full rounded-none" />
      ) : (
        <div className="grid size-full place-items-center text-ink-soft">
          <ImageOff className="size-1/4 max-h-8 max-w-8" aria-hidden />
        </div>
      )}
    </FrameObject>
  )
}
