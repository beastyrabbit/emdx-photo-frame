import { Undo2 } from "lucide-react"
import { Link } from "react-router"
import { usePictureMap } from "@/api/lookups"
import type { HistoryEntry } from "@/api/types"
import { ConfirmMark } from "@/components/marks"

const LINK = "inline-flex min-h-11 items-center text-small font-semibold text-blue"

/**
 * One entry of the Verlauf: what it is about (with the frame's name), the stage a change reached
 * with it, and where it leads. Setting, transfer and confirmation of one change carry the same id,
 * so "Alle Schritte dieser Änderung" shows them together.
 */
export function HistoryLine({
  entry,
  frameName,
  followed = false,
}: {
  entry: HistoryEntry
  /** Shown in front, as a link to the frame. Left out where the frame is clear from the page. */
  frameName?: string
  /** The list already shows only this entry's change. */
  followed?: boolean
}) {
  const pictures = usePictureMap()
  const picture = entry.pictureId ? pictures.get(entry.pictureId) : undefined
  const state = entry.change?.state
  const hasLinks = (entry.change && !followed) || picture || entry.inbox || entry.eventId
  return (
    <div className="grid min-w-0">
      <span className={entry.ok ? "" : "text-red"}>
        {frameName && entry.frameId && (
          <>
            <Link to={`/rahmen/${entry.frameId}`} className="font-semibold text-ink no-underline hover:underline">
              {frameName}
            </Link>
            {": "}
          </>
        )}
        {entry.text}
        {entry.battery !== undefined && entry.ok && <span className="text-ink-soft">, Akku {entry.battery} %</span>}
      </span>
      {(state || hasLinks) && (
        <span className="-my-1 flex min-h-11 flex-wrap items-center gap-x-4">
          {state === "zurueckgenommen" ? (
            <span className="inline-flex items-center gap-1.5 text-small font-semibold text-ink-soft">
              <Undo2 className="size-4" aria-hidden />
              zurückgenommen
            </span>
          ) : state ? (
            <ConfirmMark state={state} note={entry.change?.how} />
          ) : null}
          {entry.change && !followed && (
            <Link to={`/verlauf?aenderung=${entry.change.id}`} className={LINK} aria-label={`Alle Schritte dieser Änderung: ${entry.text}`}>
              Alle Schritte<span className="max-[559px]:sr-only">&nbsp;dieser Änderung</span>
            </Link>
          )}
          {picture && (
            <Link to={`/bild/${picture.id}`} className={LINK} aria-label={`Bild „${picture.title}“ ansehen`}>
              Bild ansehen
            </Link>
          )}
          {entry.inbox && (
            <Link to={entry.inbox === "verworfen" ? "/bibliothek?ansicht=eingang&eingang=verworfen" : "/bibliothek?ansicht=eingang"} className={LINK}>
              {entry.inbox === "verworfen" ? "Verworfene Bilder ansehen" : "Eingang öffnen"}
            </Link>
          )}
          {entry.eventId && (
            <Link to={`/events/${entry.eventId}`} className={LINK}>
              Event ansehen
            </Link>
          )}
        </span>
      )}
    </div>
  )
}
