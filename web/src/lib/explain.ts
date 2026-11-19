import type { Frame, PendingState, ShowPlan, ShowWhen } from "@/api/types"
import { fmtWhen, plural } from "./format"

// One place for the sentences that say what will happen and when,
// so the same action reads the same on every screen.

/** "voraussichtlich Sa 06:00, oder sofort per Knopf" */
export function whenOnline(frame: Pick<Frame, "nextOnline" | "power" | "charging">): string {
  if (frame.nextOnline.immediate) return frame.charging ? "geht sofort raus, er hängt am Ladegerät" : "geht sofort raus, er ist am Strom"
  const t = fmtWhen(frame.nextOnline.at)
  return frame.nextOnline.uncertain ? `frühestens ${t}, sicher nur per Knopf am Rahmen` : `voraussichtlich ${t}, oder sofort per Knopf`
}

/**
 * What "Zeigen" will do on one frame: when the change reaches the frame, and from when the picture is to be seen.
 * The two are different moments on a sleeping frame, so they are never folded into one time.
 */
export function showSentence(line: ShowPlan["lines"][number], frame: Frame, when: ShowWhen): string {
  const transfer = fmtWhen(line.transferAt)
  const battery = frame.power === "akku" && !frame.charging
  if (when === "jetzt") {
    if (line.immediate) return "Geht sofort raus. Zu sehen in wenigen Sekunden."
    const cost = battery ? " Kostet einen zusätzlichen Bildaufbau." : ""
    if (line.uncertain) return `Übertragung frühestens ${transfer}, sicher nur per Knopf am Rahmen. Zu sehen gleich danach.${cost}`
    return `Übertragung voraussichtlich ${transfer}, oder sofort per Knopf am Rahmen. Zu sehen gleich danach.${cost}`
  }
  const seen = fmtWhen(line.at)
  if (line.immediate) return `Geht sofort raus. Zu sehen ab dem nächsten Wechsel, ${seen}. Kein zusätzlicher Bildaufbau.`
  if (line.uncertain)
    return `Übertragung frühestens ${transfer}, sicher nur per Knopf am Rahmen. Zu sehen ab dem regulären Wechsel danach, voraussichtlich ${seen}. Kein zusätzlicher Bildaufbau.`
  return `Übertragung voraussichtlich ${transfer}. Zu sehen ab ${seen}. Kein zusätzlicher Bildaufbau. Drückt vorher jemand den Knopf am Rahmen, ist es einen Wechsel früher zu sehen.`
}

/** When one picture of a "Zeigen" will be on the panel, for the list under a frame. */
export function showItemWhen(line: ShowPlan["lines"][number], index: number, at: number, when: ShowWhen): string {
  if (when === "jetzt" && index === 0) return line.immediate ? "in wenigen Sekunden" : "gleich nach der Übertragung"
  return `${line.uncertain ? "frühestens" : "voraussichtlich"} ${fmtWhen(at)}`
}

/**
 * What "Als Nächstes" means for the frames in question. A sleeping frame changes to the picture it
 * already has before it reports in, so a new picture shows one regular change later.
 */
export function nextNote(frames: Pick<Frame, "nextOnline">[]): string {
  return frames.length > 0 && frames.every((f) => f.nextOnline.immediate) ? "beim nächsten Wechsel" : "beim regulären Wechsel nach der nächsten Meldung"
}

/** Why an Event needs a button press at this frame before it starts. */
export function eventPressSentence(frame: Frame, reason: "verpasst" | "zu-spaet", start: number, nextContact: number | null): string {
  const s = fmtWhen(start)
  if (reason === "zu-spaet")
    return `${frame.name} meldet sich erst ${nextContact ? fmtWhen(nextContact) : "später"} wieder, also nach dem Beginn. Drück vor ${s} den Knopf an diesem Rahmen, sonst beginnt das Event dort erst mit dieser Meldung.`
  const low = (frame.battery?.percent ?? 100) < 20
  const why =
    frame.missedChanges > 0
      ? `${frame.name} hat ${frame.missedChanges === 1 ? "eine Meldung" : "mehrere Meldungen"} verpasst.`
      : low
        ? `Der Akku von ${frame.name} ist fast leer.`
        : `${frame.name} ist neu und hat sich noch nach keinem Wechsel gemeldet.`
  return `${why} Der Start ${s} ist deshalb unsicher. ${low ? "Lade ihn und drück" : "Drück"} vor Beginn den Knopf, damit die Event-Bilder rechtzeitig ankommen.`
}

/** For a setting that has to reach the frame. */
export function settingSentence(frame: Frame, what: string): string {
  const many = what.includes(",")
  if (frame.nextOnline.immediate) return `${what} ${many ? "gehen" : "geht"} sofort an ${frame.name}.`
  return `${what} ${many ? "gelten" : "gilt"}, sobald sich ${frame.name} meldet: ${whenOnline(frame)}. Bis dahin kannst du es zurücknehmen.`
}

/**
 * Until when a test card stays on the panel: the frame's first change after the card arrives.
 * A sleeping frame gets the card when it reports in after a change, so the card stays until the change after that.
 */
export function cardUntil(frame: Pick<Frame, "nextChange" | "cadence">, from: number, eventEveryMin?: number): number {
  if (frame.nextChange > from) return frame.nextChange
  const step = (eventEveryMin ?? frame.cadence.value.everyMin) * 60_000
  return frame.nextChange + (Math.floor((from - frame.nextChange) / step) + 1) * step
}

/** Where a change is, for a sentence about one picture or one order: bound to what really happened to it. */
export function transferNote(change: PendingState | null, immediate: boolean): string {
  if (change === "uebertragen") return "übertragen, noch nicht bestätigt"
  if (change === "abweichend") return "der Rahmen meldet etwas anderes"
  if (change === "eingestellt" || change === "wartet") return immediate ? "geht gerade raus" : "wartet auf den Rahmen"
  return change === "bestaetigt" ? "am Rahmen bestätigt" : "liegt am Rahmen bereit"
}

export const pendingCountText = (n: number) => plural(n, "Änderung wartet", "Änderungen warten")
