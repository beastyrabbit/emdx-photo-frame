import { cn } from "cn"
import { Clock, Crop, IdCard, Image, ListOrdered, Package, PartyPopper, PencilLine, Power, ScanLine, Sparkles, Undo2 } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { Link } from "react-router"
import { api } from "@/api"
import { useAct } from "@/api/hooks"
import { useFrameMap, usePictureMap } from "@/api/lookups"
import type { Frame, PendingChange, PendingKind } from "@/api/types"
import { ConfirmMark } from "@/components/marks"
import { Thumb } from "@/components/picture"
import { Button } from "@/components/ui/button"
import { now } from "@/lib/clock"
import { fmtTime, fmtWhen, plural } from "@/lib/format"

export const PENDING_ICON: Record<PendingKind, React.ComponentType<{ className?: string }>> = {
  "zeigen-jetzt": Image,
  "zeigen-naechstes": Image,
  reihenfolge: ListOrdered,
  rhythmus: Clock,
  reinigung: Sparkles,
  vorrat: Package,
  event: PartyPopper,
  erkennungsbild: IdCard,
  testbild: ScanLine,
  zuschnitt: Crop,
}

/** A change in three or four words, for places with little room: "Reinigung 05:50", "Bild jetzt zeigen". */
export function pendingShort(change: PendingChange): string {
  switch (change.kind) {
    case "zeigen-jetzt":
      return (change.pictureIds?.length ?? 1) > 1 ? `${change.pictureIds?.length} Bilder jetzt zeigen` : "Bild jetzt zeigen"
    case "zeigen-naechstes":
      return (change.pictureIds?.length ?? 1) > 1 ? `${change.pictureIds?.length} Bilder als Nächstes` : "Bild als Nächstes"
    case "reihenfolge":
      return change.title.startsWith("Bilder neu") ? "Bilder neu laden" : "Neue Reihenfolge"
    case "rhythmus":
      return `Rhythmus ${change.to ?? ""}`.trim()
    case "reinigung":
      return `Reinigung ${change.to ?? ""}`.trim()
    case "vorrat":
      return `Vorrat ${change.to ?? ""} Bilder`
    case "event":
      return change.title
    case "erkennungsbild":
      return "Erkennungsbild"
    case "testbild":
      return "Testbild"
    default:
      return "Neuer Zuschnitt"
  }
}

/**
 * Where a change that already reached the frame is corrected. It cannot be taken back any more;
 * the correction is a new change, made at the place the first one came from.
 */
function correctionOf(change: PendingChange, frame?: Frame): { to: string; label: string } {
  const settings = `/einstellungen/rahmen/${change.frameId}`
  switch (change.kind) {
    case "rhythmus":
      return { to: `${settings}#rhythmus`, label: "Wechselrhythmus korrigieren" }
    case "reinigung":
      return { to: `${settings}#reinigung`, label: "Reinigungszeit korrigieren" }
    case "vorrat":
      return { to: `${settings}#vorrat`, label: "Vorrat korrigieren" }
    case "reihenfolge":
      return { to: `/zeitplan?rahmen=${change.frameId}`, label: "Reihenfolge korrigieren" }
    case "event":
      return { to: "/events", label: "Event korrigieren" }
    case "zuschnitt":
      return { to: change.pictureIds?.[0] ? `/bild/${change.pictureIds[0]}` : "/bibliothek", label: "Zuschnitt korrigieren" }
    default:
      return { to: `/bibliothek?rahmen=${change.frameId}${frame ? `&format=${frame.orientation}` : ""}`, label: "Anderes Bild zeigen" }
  }
}

/** The rail: from now to the moment the frame is next online. */
function Rail({ frame }: { frame: Frame }) {
  const online = frame.nextOnline
  return (
    <div className="grid grid-cols-[auto_minmax(40px,1fr)_auto] items-center gap-2 text-small">
      <span className="grid">
        <span>jetzt</span>
        <span className="text-ink-soft">{fmtTime(now())}</span>
      </span>
      <span className="relative h-[22px]" aria-hidden>
        <span className="absolute top-[10px] right-[9px] left-0 border-t-2 border-dashed border-blue" />
        <span className="absolute top-[6px] left-0 size-2.5 rounded-full bg-ink" />
        <span className="absolute top-1 right-0 size-3.5 rounded-full border-[2.5px] border-blue bg-surface" />
      </span>
      <span className="grid text-right font-semibold text-blue">
        <span>{online.immediate ? "geht sofort raus" : `${frame.name} meldet sich`}</span>
        <span className="font-normal">
          {online.immediate
            ? frame.charging
              ? "hängt am Ladegerät"
              : "ist am Strom"
            : `${online.uncertain ? "frühestens" : "voraussichtlich"} ${fmtWhen(online.at)}`}
        </span>
      </span>
    </div>
  )
}

function ChangeRow({ change, showFrame }: { change: PendingChange; showFrame?: string }) {
  const pictures = usePictureMap()
  const frames = useFrameMap()
  const delivered = change.state === "uebertragen" || change.state === "bestaetigt"
  const correction = correctionOf(change, frames.get(change.frameId))
  const withdraw = useAct(api.withdrawPending, "Zurückgenommen")
  const resolve = useAct(
    ({ id, keep }: { id: string; keep: "unser" | "rahmen" }) => api.resolvePending(id, keep),
    (_r, a) => (a.keep === "unser" ? "Wird erneut gesendet" : "Wert vom Rahmen übernommen"),
  )
  const Icon = PENDING_ICON[change.kind]
  const first = change.pictureIds?.[0] ? pictures.get(change.pictureIds[0]) : undefined
  const canUndo = change.state === "eingestellt" || change.state === "wartet"
  const stateAt =
    change.state === "bestaetigt" ? change.confirmedAt : change.state === "eingestellt" || change.state === "wartet" ? change.setAt : change.sentAt
  return (
    <motion.li
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="overflow-hidden"
    >
      <div className="flex gap-3 border-t border-line py-3">
        {first ? <Thumb picture={first} byId={pictures} className="w-8 self-start" /> : <Icon className="mx-1.5 mt-0.5 size-5 shrink-0 text-ink-soft" />}
        <div className="grid min-w-0 flex-1 justify-items-start gap-1">
          <div>
            {showFrame && <span className="text-small text-ink-soft">{showFrame}: </span>}
            <span className="font-semibold">{change.title}</span>
            {change.from && change.to && (
              <span>
                : <s className="text-ink-soft">{change.from}</s> <span aria-hidden>→</span>
                <span className="sr-only">wird zu</span> {change.to}
              </span>
            )}
            {!change.from && change.to && <span>: {change.to}</span>}
          </div>
          <ConfirmMark state={change.state} at={stateAt} />
          {change.state === "abweichend" && (
            <p className="text-[15px]">
              Der Rahmen meldet <strong>{change.deviceValue}</strong>, eingestellt ist <strong>{change.to}</strong>. Vielleicht wurde es in der Samsung-App
              geändert.
            </p>
          )}
          {change.extraRedraw && canUndo && <p className="text-small text-ink-soft">Kostet einen zusätzlichen Bildaufbau.</p>}
          {canUndo && (
            <Button variant="ghost" size="sm" className="-ml-3 w-fit" disabled={withdraw.isPending} onClick={() => withdraw.mutate(change.id)}>
              <Undo2 />
              Zurücknehmen
            </Button>
          )}
          {delivered && (
            <>
              <p className="text-small text-ink-soft">Schon übertragen. Deine Korrektur wird als neue Änderung vorgemerkt.</p>
              <Button asChild variant="ghost" size="sm" className="-ml-3 w-fit">
                <Link to={correction.to} aria-label={`${correction.label}: ${change.title}`}>
                  <PencilLine />
                  Korrigieren
                </Link>
              </Button>
            </>
          )}
          {change.state === "abweichend" && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: change.id, keep: "unser" })}>
                {change.to} erneut senden
              </Button>
              <Button size="sm" variant="outline" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: change.id, keep: "rahmen" })}>
                {change.deviceValue} übernehmen
              </Button>
            </div>
          )}
        </div>
      </div>
    </motion.li>
  )
}

/**
 * Everything that waits for one frame, with the moment it will arrive.
 * Changes reach the frame together, the next time it is online.
 */
export function PendingQueue({ frame, changes, compact = false }: { frame: Frame; changes: PendingChange[]; compact?: boolean }) {
  const open = changes.filter((c) => c.state !== "bestaetigt")
  const done = changes.filter((c) => c.state === "bestaetigt")
  const waiting = open.filter((c) => c.state === "eingestellt" || c.state === "wartet")
  if (!open.length && (compact || !done.length)) {
    return (
      <div className="rounded-control border border-line bg-surface px-4 py-3 text-[15px] text-ink-soft">
        {frame.nextOnline.immediate
          ? "Dieser Rahmen ist immer erreichbar. Was du änderst, geht sofort raus und steht hier, bis er es bestätigt hat."
          : "Nichts wartet auf diesen Rahmen. Was du änderst, erscheint hier, bis der Rahmen es bestätigt hat."}
      </div>
    )
  }
  return (
    <div className={cn("grid gap-3 rounded-control border bg-surface p-4", open.length ? "border-blue" : "border-line")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3>
          {!open.length
            ? "Zuletzt bestätigt"
            : frame.nextOnline.immediate
              ? plural(open.length, "Änderung geht gerade raus", "Änderungen gehen gerade raus")
              : plural(open.length, "Änderung für diesen Rahmen", "Änderungen für diesen Rahmen")}
        </h3>
        {waiting.length > 1 && !frame.nextOnline.immediate && <span className="text-small text-ink-soft">kommen zusammen an</span>}
      </div>
      {waiting.length > 0 && !frame.nextOnline.immediate && (
        <>
          <Rail frame={frame} />
          {
            <p className="flex items-start gap-2 text-small text-ink-soft">
              <Power className="mt-px size-[18px] shrink-0 text-blue" aria-hidden />
              <span>
                Schneller geht es mit einem Druck auf den Knopf am Rahmen.{" "}
                {frame.watching
                  ? `Der Server schaut gerade alle ${frame.watching.everySec} Sekunden nach ihm.`
                  : frame.justUpdated
                    ? "Er wurde gerade aktualisiert und wird bis zum nächsten Wechsel in Ruhe gelassen."
                    : ""}
              </span>
            </p>
          }
        </>
      )}
      <ul className="m-0 grid list-none p-0">
        <AnimatePresence initial={false}>
          {open.map((c) => (
            <ChangeRow key={c.id} change={c} />
          ))}
          {!compact && done.map((c) => <ChangeRow key={c.id} change={c} />)}
        </AnimatePresence>
      </ul>
    </div>
  )
}
