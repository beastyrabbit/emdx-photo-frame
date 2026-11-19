import { cadenceText, firstChangeAfter as firstRegularAfter } from "@/lib/cadence"
import { DAY, HOUR, MINUTE, now } from "@/lib/clock"
import type { PhotoFrameApi, PrototypeControls } from "../client"
import type {
  ArtWork,
  Cadence,
  ConnectionTest,
  Deck,
  DeckCard,
  EventDraft,
  EventEstimate,
  Frame,
  FrameDetail,
  FrameEvent,
  FrameNext,
  Group,
  HistoryEntry,
  Orientation,
  PendingChange,
  PendingKind,
  Picture,
  PictureWhere,
  ShowPlan,
  ShowRequest,
  TimelineItem,
} from "../types"
import { ART_SOURCE_NAME, CATALOGUE } from "./catalogue"
import { COST_PER_CHANGE, COST_PER_DAY, type Db, type FrameRow, seed } from "./seed"

// An in-memory stand-in for the backend. It answers after a short wait and moves
// pending changes along by itself, so the interface can be tried without a frame.

const db: Db = seed()
const undo = new Map<string, () => void>()
let counter = 1000
const nextId = (prefix: string) => `${prefix}${++counter}`

const wait = <T>(value: T, ms = 140 + Math.random() * 180): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), ms))

function frameRow(id: string): FrameRow {
  const f = db.frames.find((x) => x.id === id)
  if (!f) throw new Error(`Rahmen ${id} gibt es nicht`)
  return f
}
const picRow = (id: string) => {
  const p = db.pictures.find((x) => x.id === id)
  if (!p) throw new Error(`Bild ${id} gibt es nicht`)
  return p
}
const reachable = (f: FrameRow) => f.power === "dauerstrom" || f.charging
const runningEvent = (f: FrameRow): FrameEvent | undefined => db.events.find((e) => e.frameIds.includes(f.id) && e.start <= now() && e.end > now())
const openPending = (frameId: string) => db.pending.filter((p) => p.frameId === frameId && p.state !== "bestaetigt")

function log(frameId: string | null, kind: HistoryEntry["kind"], text: string, ok = true, extra: Partial<HistoryEntry> = {}) {
  db.history.unshift({ id: nextId("h"), at: now(), frameId, kind, text, ok, ...extra })
}

/** The rhythm the frame itself runs on: a changed one counts only once the frame confirmed it. */
const deviceCadence = (f: FrameRow): Cadence => (!f.cadence.confirmedAt && f.cadence.deviceValue ? f.cadence.deviceValue : f.cadence.value)
const cadencePending = (f: FrameRow) => !f.cadence.confirmedAt && !!f.cadence.deviceValue

/** A frame added in this session that has not had its first delivery yet. */
const untouched = (f: FrameRow) => !!f.addedAt && !f.lastDelivery

/** How long a picture counts as "hing eben erst" after it left a frame. The backend decides this; the interface never names it. */
const JUST_SHOWN = 2 * DAY
/** How long discarded pictures are kept. */
const KEEP_DISCARDED = 30 * DAY
/** The last successful connection test per address: what it found and how long the frame stays awake after its button. */
const tests = new Map<string, { at: number; steps: ConnectionTest["steps"]; awakeUntil: number | null }>()

/** A change as the history names it: the subject and its values, without the stage it is in. */
function changeText(p: PendingChange, first = false): string {
  const noun = p.kind === "reinigung" ? "Reinigungszeit" : p.kind === "vorrat" ? "Vorrat" : p.title
  const unit = p.kind === "vorrat" ? " Bilder" : ""
  if (first && p.from && p.to) return `${noun} von ${p.from} auf ${p.to}${unit}`
  if (!p.to) return noun
  return p.kind === "event" ? `${noun}: ${p.to}` : `${noun} ${p.to}${unit}`
}

/** "„A“", "„A“, „B“ und „C“", "„A“, „B“, „C“ und 4 weitere". */
function titleList(titles: string[]): string {
  const named = titles.slice(0, 3).map((t) => `„${t}“`)
  const more = titles.length - named.length
  if (more > 0) return `${named.join(", ")} und ${more === 1 ? "1 weiteres" : `${more} weitere`}`
  return named.length <= 1 ? (named[0] ?? "") : `${named.slice(0, -1).join(", ")} und ${named[named.length - 1]}`
}

/** The next `n` times this frame changes its picture. */
function changeTimes(f: FrameRow, n: number): number[] {
  const times: number[] = []
  const event = runningEvent(f)
  let t = f.nextChange
  let first = true
  while (times.length < n) {
    times.push(t)
    if (event && t + event.everyMin * MINUTE < event.end) t += event.everyMin * MINUTE
    // Back to the normal rhythm: its first change after the Event.
    else if (event && t < event.end) t = firstRegularAfter(event.end, f.cadence.value)
    // A waiting rhythm change arrives at the frame's next contact and counts from then on.
    else if (first && cadencePending(f)) t = firstRegularAfter(t, f.cadence.value)
    else t += f.cadence.value.everyMin * MINUTE
    first = false
  }
  return times
}

function nextOnline(f: FrameRow): Frame["nextOnline"] {
  if (reachable(f)) return { at: now(), uncertain: false, immediate: true }
  // A new frame runs on whatever was set before: when it wakes by itself is not known until its first delivery.
  return { at: Math.max(f.nextChange, now()), uncertain: f.missedChanges > 0 || (f.battery?.percent ?? 100) < 10 || untouched(f), immediate: false }
}

function batteryOutlook(f: FrameRow): Frame["battery"] {
  if (!f.battery) return null
  if (f.charging) return { ...f.battery, until: null, changesLeft: null, afterPending: null }
  const percent = f.battery.percent
  const outlook = (everyMin: number) => {
    const days = percent / ((1440 / everyMin) * COST_PER_CHANGE + COST_PER_DAY)
    return { until: now() + days * DAY, changesLeft: Math.floor((days * 1440) / everyMin) }
  }
  const event = runningEvent(f)
  return {
    ...f.battery,
    ...outlook(event ? event.everyMin : deviceCadence(f).everyMin),
    afterPending: cadencePending(f) ? { ...outlook(f.cadence.value.everyMin), cadence: f.cadence.value } : null,
  }
}

const OFF_NOUN: Partial<Record<PendingKind, string>> = { reinigung: "Reinigungszeit", rhythmus: "Wechselrhythmus", vorrat: "Vorrat" }

/** A frame that reports another value than the one set needs a decision, even if everything else is fine. */
function healthOf(f: FrameRow): Frame["health"] {
  const off = db.pending.find((p) => p.frameId === f.id && p.state === "abweichend")
  if (!off || f.health.level !== "ok") return f.health
  return { level: "warn", title: `${OFF_NOUN[off.kind] ?? off.title} weicht ab`, text: `Eingestellt ${off.to}, am Rahmen ${off.deviceValue}.` }
}

/** The picture after the current one, for the overview's "Als Nächstes". */
function upNext(f: FrameRow): FrameNext | null {
  const next = buildTimeline(f).find((i) => i.state !== "haengt")
  if (!next || next.state === "haengt") return null
  return { pictureId: next.pictureId, at: next.at, state: next.state, uncertain: nextOnline(f).uncertain }
}

function toFrame(f: FrameRow): Frame {
  const open = openPending(f.id)
  return {
    id: f.id,
    name: f.name,
    device: f.device,
    ip: f.ip,
    orientation: f.orientation,
    upsideDown: f.upsideDown,
    groupId: f.groupId,
    tags: f.tags,
    power: f.power,
    charging: f.charging,
    health: healthOf(f),
    battery: batteryOutlook(f),
    // A test card stays on the panel until the frame's next change.
    current: {
      pictureId: f.current.pictureId,
      since: f.current.since,
      unsure: f.current.unsure,
      card: f.current.card ? { kind: f.current.card, until: f.nextChange } : null,
    },
    nextChange: f.nextChange,
    nextOnline: nextOnline(f),
    lastOnline: f.lastOnline,
    missedChanges: f.missedChanges,
    justUpdated: f.justUpdated,
    watching: !reachable(f) && open.length > 0 && !f.justUpdated ? { everySec: 5, until: now() + 12 * HOUR } : null,
    cadence: f.cadence,
    cleaning: f.cleaning,
    buffer: f.buffer,
    bufferLeft: f.queue.length,
    pendingCount: open.length,
    eventId: runningEvent(f)?.id ?? null,
    upNext: upNext(f),
  }
}

type LineupItem = Pick<TimelineItem, "pictureId" | "at" | "state" | "pinned" | "locked" | "change">

/** How far the owner's change that put this picture in front has got: the "Zeigen" that names it, or a new order. */
function changeOf(f: FrameRow, pictureId: string): TimelineItem["change"] {
  const open = openPending(f.id)
  const own = open.find((p) => p.pictureIds?.includes(pictureId) && (p.kind === "zeigen-jetzt" || p.kind === "zeigen-naechstes"))
  return (own ?? open.find((p) => p.kind === "reihenfolge"))?.state ?? null
}

/**
 * Every picture that is reserved for a frame, in the order it will show them:
 * the one a sleeping frame changes to before it reports in (fixed), then what the owner
 * put in front (`own`), then the rest of its buffer. `used` is how many change times that takes.
 */
function lineup(f: FrameRow): { items: LineupItem[]; used: number } {
  // A sleeping frame changes to its next picture before it can be told anything else.
  const fixed = reachable(f) ? [] : f.queue.slice(0, 1)
  const jetzt = db.pending.find((p) => p.frameId === f.id && p.kind === "zeigen-jetzt" && p.state !== "bestaetigt")
  const own = f.own.filter((id) => !fixed.includes(id))
  const nowIds = own.filter((id) => jetzt?.pictureIds?.includes(id))
  const nextIds = own.filter((id) => !nowIds.includes(id))
  const rest = f.queue.filter((id) => !fixed.includes(id) && !own.includes(id))
  const times = changeTimes(f, fixed.length + nextIds.length + rest.length + 1)
  const items: LineupItem[] = []
  let i = 0
  for (const id of fixed) items.push({ pictureId: id, at: times[i++], state: "am-rahmen", pinned: false, locked: true, change: null })
  for (const id of nowIds) items.push({ pictureId: id, at: nextOnline(f).at, state: "wartet", pinned: true, locked: false, change: changeOf(f, id) })
  for (const id of nextIds)
    items.push({ pictureId: id, at: times[i++], state: f.queue.includes(id) ? "am-rahmen" : "wartet", pinned: true, locked: false, change: changeOf(f, id) })
  for (const id of rest) items.push({ pictureId: id, at: times[i++], state: "am-rahmen", pinned: false, locked: false, change: null })
  return { items, used: i }
}

/** A combined picture and its members share their locks. */
function familyOf(id: string): Set<string> {
  const p = picRow(id)
  const family = new Set<string>([id, ...(p.combo?.memberIds ?? [])])
  for (const other of db.pictures) if (other.combo?.memberIds.includes(id)) family.add(other.id)
  return family
}

/** `pictureId` is the member of the family that really has the place on the frame. */
function reservedOf(family: Set<string>): { frameId: string; at: number; locked: boolean; pictureId: string } | null {
  for (const f of db.frames) {
    const hit = lineup(f).items.find((i) => family.has(i.pictureId))
    if (hit) return { frameId: f.id, at: hit.at, locked: hit.locked, pictureId: hit.pictureId }
  }
  return null
}

function whereOf(id: string): PictureWhere {
  const family = familyOf(id)
  let hangs: PictureWhere["hangs"] = null
  for (const f of db.frames) if (f.current.pictureId && family.has(f.current.pictureId)) hangs = { frameId: f.id, since: f.current.since }
  const r = reservedOf(family)
  let lastShown: PictureWhere["lastShown"] = null
  for (const member of family) {
    const s = db.shown[member]
    if (s && (!lastShown || s.at > lastShown.at)) lastShown = s
  }
  // `db.shown` holds the current round: what is in it has had its turn until the deck is reshuffled.
  return {
    hangs,
    reserved: r ? { frameId: r.frameId, at: r.at } : null,
    lastShown,
    shownThisRound: !!lastShown,
    justShown: !!lastShown && now() - lastShown.at < JUST_SHOWN,
  }
}

/** A card that can be dealt: it hangs nowhere, is reserved nowhere and has not had its turn in this round. */
function isFree(id: string): boolean {
  const w = whereOf(id)
  return !w.hangs && !w.reserved && !w.shownThisRound
}

/**
 * The deck is through: a new round begins. What was shown goes back in, the pictures shown most recently
 * to the back. A picture that left a frame only just now stays out a little longer, so it cannot turn up
 * on a second frame right away (it may be in several groups' decks).
 */
function reshuffle(key: string) {
  const deck = db.decks[key] ?? []
  const back = deck.filter((id) => db.shown[id]).sort((a, b) => db.shown[a].at - db.shown[b].at)
  for (const id of back) if (now() - db.shown[id].at >= JUST_SHOWN) delete db.shown[id]
  db.decks[key] = [...deck.filter((id) => !back.includes(id)), ...back]
}

/** Groups that show the picture: through an album of their theme, or because they mix works of art in. */
const groupsOf = (p: Db["pictures"][number]) =>
  db.groups.filter((g) => p.albums.some((a) => g.albums.includes(a)) || ORIENTATIONS.some((o) => db.decks[`${g.id}/${o}`]?.includes(p.id))).map((g) => g.id)
const toPicture = (p: Db["pictures"][number]): Picture => ({ ...p, where: whereOf(p.id), groupIds: groupsOf(p) })

/** Who will probably get which card of a group's deck, and when. */
function forecast(groupId: string, orientation: Orientation) {
  const frames = db.frames.filter((f) => f.groupId === groupId && f.orientation === orientation)
  const order = db.decks[`${groupId}/${orientation}`] ?? []
  const free = order.filter(isFree)
  const byPicture = new Map<string, { frameId: string; at: number }>()
  const byFrame = new Map<string, { pictureId: string; at: number }[]>(frames.map((f) => [f.id, []]))
  if (!frames.length) return { byPicture, byFrame, free }
  const slots = frames.map((f) => {
    const used = lineup(f).used
    return { f, times: changeTimes(f, used + 12), i: used }
  })
  for (const id of free.slice(0, frames.length * 10)) {
    slots.sort((a, b) => a.times[a.i] - b.times[b.i])
    const s = slots[0]
    if (s.i >= s.times.length) break
    const entry = { frameId: s.f.id, at: s.times[s.i] }
    byPicture.set(id, entry)
    byFrame.get(s.f.id)?.push({ pictureId: id, at: entry.at })
    s.i++
  }
  return { byPicture, byFrame, free }
}

function buildDeck(groupId: string, orientation: Orientation): Deck {
  const order = db.decks[`${groupId}/${orientation}`] ?? []
  const plan = forecast(groupId, orientation)
  const rank = { haengt: 0, vorgemerkt: 1, stapel: 2, gezeigt: 3 }
  const cards: DeckCard[] = order.map((pictureId) => {
    const w = whereOf(pictureId)
    // A combined picture and its members share their locks: only one of them has the place on the frame.
    const shared = (holder: string | null | undefined) => (holder && holder !== pictureId ? holder : null)
    if (w.hangs) {
      const onPanel = db.frames.find((f) => f.id === w.hangs?.frameId)?.current.pictureId
      return { pictureId, state: "haengt", frameId: w.hangs.frameId, expectedAt: null, locked: true, sharedWith: shared(onPanel) }
    }
    if (w.reserved) {
      const r = reservedOf(familyOf(pictureId))
      return {
        pictureId,
        state: "vorgemerkt",
        frameId: w.reserved.frameId,
        expectedAt: w.reserved.at,
        locked: r?.locked ?? false,
        sharedWith: shared(r?.pictureId),
      }
    }
    if (w.shownThisRound) return { pictureId, state: "gezeigt", frameId: w.lastShown?.frameId ?? null, expectedAt: null, locked: false, sharedWith: null }
    const p = plan.byPicture.get(pictureId)
    return { pictureId, state: "stapel", frameId: p?.frameId ?? null, expectedAt: p?.at ?? null, locked: false, sharedWith: null }
  })
  cards.sort((a, b) => rank[a.state] - rank[b.state])
  const frames = db.frames.filter((f) => f.groupId === groupId && f.orientation === orientation)
  const needed = frames.reduce((sum, f) => sum + f.buffer + 1, 0)
  const usable = cards.filter((c) => c.state !== "gezeigt").length
  return { groupId, orientation, cards, shortBy: Math.max(0, needed - usable) }
}

function buildTimeline(f: FrameRow): TimelineItem[] {
  const event = runningEvent(f)
  const plan = (forecast(f.groupId, f.orientation).byFrame.get(f.id) ?? []).slice(0, 8)
  const { items: reserved, used } = lineup(f)
  const times = changeTimes(f, used + plan.length + 1)
  const inEvent = (t: number) => (event && t < event.end ? event.id : null)
  // While a test card is on the panel, or before a new frame got anything, no picture hangs: the list starts with what comes next.
  const hanging: TimelineItem[] = f.current.pictureId
    ? [{ pictureId: f.current.pictureId, at: f.current.since, state: "haengt", eventId: event?.id ?? null, pinned: false, locked: true, change: null }]
    : []
  return [
    ...hanging,
    ...reserved.map((i) => ({ ...i, eventId: i.pinned ? null : inEvent(i.at) })),
    ...plan.map((p, n) => ({
      pictureId: p.pictureId,
      at: times[used + n] ?? p.at,
      state: "geplant" as const,
      eventId: null,
      pinned: false,
      locked: false,
      change: null,
    })),
  ]
}

const ORIENTATIONS: Orientation[] = ["hoch", "quer"]
const fitsFormat = (p: Db["pictures"][number], o: Orientation) => p.orientation === o || p.alsoOther
const isTopPick = (p: Db["pictures"][number]) => !!CATALOGUE.find((w) => w.id === p.artwork?.workId)?.topPick
const bestFormat = (width: number, height: number): Orientation => (height >= width ? "hoch" : "quer")

/** A catalogue work as a library picture. */
function pictureOf(work: (typeof CATALOGUE)[number], id: string): Db["pictures"][number] {
  const o = bestFormat(work.width, work.height)
  const { workId, artist, date, source, licence } = work
  return {
    id,
    title: work.title,
    art: work.art,
    width: work.width,
    height: work.height,
    takenAt: now(),
    addedAt: now(),
    orientation: o,
    detected: o,
    alsoOther: false,
    crops: { hoch: { x: 50, y: 50, zoom: 1, auto: true }, quer: { x: 50, y: 50, zoom: 1, auto: true } },
    albums: ["Kunst"],
    source: "kunst",
    paused: false,
    combo: null,
    hints: [],
    artwork: { workId, artist, date, source, licence },
  }
}

/** "Auswahl des Katalogs": the service adds the catalogue's top picks by itself; they do not pass the Eingang. */
function ensureTopPicks() {
  for (const work of CATALOGUE.filter((w) => w.topPick)) {
    if (!db.pictures.some((p) => p.artwork?.workId === work.id)) db.pictures.push(pictureOf(work, nextId("b")))
  }
}

/**
 * The decks of a group: every picture of its theme, and with "Kunst untermischen" a work of art as every n-th card.
 * The order that is already there is kept.
 */
function rebuildDecks(g: Group) {
  const mixing = db.settings.extras.art && g.art.every > 0
  if (mixing && g.art.from === "katalog") ensureTopPicks()
  for (const o of ORIENTATIONS) {
    const key = `${g.id}/${o}`
    const inTheme = (p: Db["pictures"][number]) => p.albums.some((a) => g.albums.includes(a))
    const themed = db.pictures.filter((p) => !p.paused && inTheme(p) && fitsFormat(p, o)).map((p) => p.id)
    const kept = (db.decks[key] ?? []).filter((id) => themed.includes(id))
    const base = [...kept, ...themed.filter((id) => !kept.includes(id))]
    const works = mixing
      ? db.pictures
          .filter((p) => p.source === "kunst" && !p.paused && fitsFormat(p, o) && !inTheme(p) && (g.art.from === "bibliothek" || isTopPick(p)))
          .map((p) => p.id)
      : []
    // Art goes between the cards that can still be dealt; what hangs, is reserved or was shown keeps its place behind them.
    const free = base.filter(isFree)
    const deck: string[] = []
    let n = 0
    for (const id of free) {
      deck.push(id)
      // Every n-th card is a work of art, as long as there are works left for this round.
      if (n < works.length && deck.length % g.art.every === g.art.every - 1) deck.push(works[n++])
    }
    db.decks[key] = [...deck, ...base.filter((id) => !free.includes(id))]
  }
}

function addPending(frameId: string, kind: PendingKind, title: string, extra: Partial<PendingChange>, revert?: () => void): PendingChange {
  const change: PendingChange = { id: nextId("p"), frameId, kind, title, state: "eingestellt", setAt: now(), extraRedraw: false, ...extra }
  db.pending.unshift(change)
  if (revert) undo.set(change.id, revert)
  // The history names the change and its values; transfer and confirmation follow under the same id.
  log(frameId, "aenderung", changeText(change, true), true, { change: { id: change.id, state: "eingestellt" }, pictureId: change.pictureIds?.[0] })
  // A frame on mains power or on the charger is always reachable: nothing waits, it goes out now.
  const f = db.frames.find((x) => x.id === frameId)
  if (f && reachable(f)) setTimeout(() => deliver(frameId, f.power === "dauerstrom" ? "am Strom" : "am Ladegerät"), 0)
  return change
}

function applyConfirmed(change: PendingChange) {
  const f = frameRow(change.frameId)
  if (change.kind === "zeigen-jetzt" && change.pictureIds?.length) {
    const [first, ...rest] = change.pictureIds
    if (f.current.pictureId) db.shown[f.current.pictureId] = { frameId: f.id, at: now() }
    f.current = { pictureId: first, since: now(), unsure: false }
    f.own = [...rest, ...f.own.filter((id) => !change.pictureIds?.includes(id))]
  }
  // The frame confirmed a test card: that card is on the panel now, in place of the picture, until the next change.
  if (change.kind === "erkennungsbild" || change.kind === "testbild") {
    if (f.current.pictureId) db.shown[f.current.pictureId] = { frameId: f.id, at: now() }
    f.current = { pictureId: null, since: now(), unsure: false, card: change.kind }
  }
  if (change.kind === "rhythmus") {
    f.cadence = { value: f.cadence.value, confirmedAt: now() }
    // The new rhythm counts from now on, unless an Event sets the pace.
    if (!runningEvent(f)) f.nextChange = firstRegularAfter(now(), f.cadence.value)
  }
  if (change.kind === "reinigung") f.cleaning = { value: f.cleaning.value, confirmedAt: now() }
}

/**
 * The frame is online and gets a fresh buffer: what the owner put in front comes first, in the owner's order,
 * then what was there before. Nothing is dropped; pictures beyond the buffer size stay pinned for the next time.
 */
function reloadBuffer(f: FrameRow) {
  const wanted = [...f.own, ...f.queue.filter((id) => !f.own.includes(id))].filter((id) => id !== f.current.pictureId)
  f.queue = wanted.slice(0, Math.max(f.buffer, f.queue.length))
  f.own = f.own.filter((id) => !f.queue.includes(id) && id !== f.current.pictureId)
  // Every contact tops the buffer up from the top of the group's deck.
  const key = `${f.groupId}/${f.orientation}`
  let reshuffled = false
  while (f.queue.length < f.buffer) {
    const next = (db.decks[key] ?? []).find(isFree)
    if (next) f.queue.push(next)
    else if (!reshuffled) {
      reshuffle(key)
      reshuffled = true
    } else break
  }
  f.lastDelivery = now()
}

const CONTENT: PendingKind[] = ["zeigen-jetzt", "zeigen-naechstes", "reihenfolge", "erkennungsbild", "testbild", "zuschnitt"]

/** The frame is reachable: everything waiting goes out, settings first, pictures last. */
function deliver(frameId: string, how: string) {
  const f = frameRow(frameId)
  const open = db.pending
    .filter((p) => p.frameId === frameId && (p.state === "eingestellt" || p.state === "wartet"))
    .sort((a, b) => Number(CONTENT.includes(a.kind)) - Number(CONTENT.includes(b.kind)))
  if (!open.length) return
  f.lastOnline = { at: now(), secondsAfterChange: null }
  for (const p of open) {
    p.state = "uebertragen"
    p.sentAt = now()
    log(frameId, "uebertragung", changeText(p), true, {
      battery: f.battery?.percent,
      change: { id: p.id, state: "uebertragen", how },
      pictureId: p.pictureIds?.[0],
    })
  }
  setTimeout(() => {
    // The frame may have been removed in the meantime.
    if (!db.frames.includes(f)) return
    // With this contact the frame also confirms what reached it earlier.
    for (const p of db.pending.filter((x) => x.frameId === frameId && x.state === "uebertragen").reverse()) {
      p.state = "bestaetigt"
      p.confirmedAt = now()
      undo.delete(p.id)
      applyConfirmed(p)
      log(frameId, "aenderung", changeText(p), true, { change: { id: p.id, state: "bestaetigt" }, pictureId: p.pictureIds?.[0] })
    }
    reloadBuffer(f)
    f.current.unsure = false
    if (f.addedAt && f.health.title === "Neu verbunden") f.health = { level: "ok", title: "Alles in Ordnung", text: "" }
    if (!reachable(f)) f.justUpdated = { at: now() }
  }, 3500)
}

// Time passes: reachable frames get their changes at once, the others are waited for.
setInterval(() => {
  for (const f of db.frames) {
    const fresh = db.pending.filter((p) => p.frameId === f.id && p.state === "eingestellt" && now() - p.setAt > 1500)
    if (!fresh.length) continue
    if (reachable(f)) deliver(f.id, f.power === "dauerstrom" ? "am Strom" : "am Ladegerät")
    else for (const p of fresh) p.state = "wartet"
  }
}, 1000)

function planShow(request: ShowRequest): ShowPlan {
  const warnings: ShowPlan["warnings"] = []
  const unplaced: string[] = []
  const perFrame = new Map<string, string[]>()
  const targets = request.scope === "haus" ? db.frames : [frameRow(request.scope.frameId)]
  let turn = 0
  for (const id of request.pictureIds) {
    const p = picRow(id)
    const fits = targets.filter((f) => f.orientation === p.orientation || p.alsoOther).sort((a, b) => nextOnline(a).at - nextOnline(b).at)
    if (!fits.length) {
      unplaced.push(id)
      continue
    }
    const target = fits[turn++ % fits.length]
    const w = whereOf(id)
    if (w.hangs && w.hangs.frameId !== target.id) warnings.push({ pictureId: id, reason: "haengt", frameId: w.hangs.frameId, at: null })
    else if (w.reserved && w.reserved.frameId !== target.id)
      warnings.push({ pictureId: id, reason: "vorgemerkt", frameId: w.reserved.frameId, at: w.reserved.at })
    else if (w.justShown && w.lastShown && w.lastShown.frameId !== target.id)
      warnings.push({ pictureId: id, reason: "eben", frameId: w.lastShown.frameId, at: w.lastShown.at })
    if (!request.force && warnings.some((x) => x.pictureId === id)) continue
    perFrame.set(target.id, [...(perFrame.get(target.id) ?? []), id])
  }
  const lines: ShowPlan["lines"] = [...perFrame].map(([frameId, pictureIds]) => {
    const f = frameRow(frameId)
    const online = nextOnline(f)
    // A sleeping frame first changes to the picture it already has and only then reports in:
    // what it is given at that moment shows from the regular change after it.
    const times = changeTimes(f, pictureIds.length + 2).slice(online.immediate ? 0 : 1)
    const items = pictureIds.map((pictureId, i) => ({ pictureId, at: request.when === "jetzt" ? (i === 0 ? online.at : times[i - 1]) : times[i] }))
    return {
      frameId,
      pictureIds,
      items,
      transferAt: online.at,
      at: items[0].at,
      uncertain: online.uncertain,
      immediate: online.immediate,
      extraRedraw: request.when === "jetzt",
    }
  })
  return { lines, warnings, unplaced }
}

function estimateEvent(draft: EventDraft): EventEstimate {
  const duration = Math.max(0, draft.end - draft.start)
  const perFrame = draft.frameIds.map((frameId) => {
    const f = frameRow(frameId)
    const changes = Math.max(1, Math.ceil(duration / (draft.everyMin * MINUTE)))
    const usual = duration / (f.cadence.value.everyMin * MINUTE)
    const extra = f.battery ? Math.max(0, Math.round((changes - usual) * COST_PER_CHANGE * 10) / 10) : null
    const online = nextOnline(f)
    const sleeping = !reachable(f)
    // The Event travels with the pictures delivered at a contact before its start.
    const pressReason =
      !sleeping || draft.start <= now() ? null : online.uncertain ? ("verpasst" as const) : online.at > draft.start ? ("zu-spaet" as const) : null
    const fits = draft.pictureIds.some((id) => {
      const p = db.pictures.find((x) => x.id === id)
      return p && (p.orientation === f.orientation || p.alsoOther)
    })
    const overlap = db.events.find(
      (e) => e.id !== draft.id && e.state !== "vorbei" && e.frameIds.includes(frameId) && e.start < draft.end && e.end > draft.start,
    )
    return {
      frameId,
      changes,
      extraBattery: extra,
      batteryAfter: f.battery && extra !== null ? Math.max(0, Math.round(f.battery.percent - extra - usual * COST_PER_CHANGE)) : null,
      pressReason,
      nextContact: sleeping ? online.at : null,
      missingFormat: draft.pictureIds.length > 0 && !fits,
      overlapsWith: overlap?.name ?? null,
    }
  })
  const most = Math.max(0, ...perFrame.map((p) => p.changes))
  const share = draft.sameOnAll ? draft.pictureIds.length : Math.floor(draft.pictureIds.length / Math.max(1, draft.frameIds.length))
  return { perFrame, repeats: draft.pictureIds.length > 0 && most > share }
}

/** The last `n` changes of a frame, newest first: Event changes back to the Event's start, regular ones before. */
function pastChanges(f: FrameRow, n: number): number[] {
  const event = runningEvent(f)
  const c = deviceCadence(f)
  const times: number[] = []
  let t = f.nextChange - (event ? event.everyMin : c.everyMin) * MINUTE
  while (times.length < n) {
    times.push(t)
    if (event && t - event.everyMin * MINUTE >= event.start) t -= event.everyMin * MINUTE
    else if (event && t >= event.start) {
      let before = firstRegularAfter(event.start - 2 * DAY, c)
      while (before + Math.min(c.everyMin, 1440) * MINUTE < event.start) before += Math.min(c.everyMin, 1440) * MINUTE
      t = before
    } else t -= c.everyMin * MINUTE
  }
  return times
}

function detail(f: FrameRow): FrameDetail {
  const [ch, cm] = f.cleaning.value.split(":").map(Number)
  const clock = (mins: number) => `${String(Math.floor(((mins + 1440) % 1440) / 60)).padStart(2, "0")}:${String((mins + 1440) % 60).padStart(2, "0")}`
  const total = (db.decks[`${f.groupId}/${f.orientation}`] ?? []).length
  const ahead = lineup(f)
  // A frame added in this session has no past: nothing is made up for it.
  const fresh = !!f.addedAt
  return {
    ...toFrame(f),
    batteryLog: f.batteryLog,
    delivery: untouched(f)
      ? null
      : {
          sentAt: f.lastDelivery ?? f.lastOnline.at,
          pictures: f.queue.length,
          endsAt: changeTimes(f, ahead.used + 1)[Math.max(0, ahead.used - 1)] ?? f.nextChange,
          usedUp: f.queue.length === 0 && f.missedChanges > 0,
        },
    changes: fresh
      ? []
      : pastChanges(f, 6).map((t, i) => ({ at: t, onlineAfterSec: 9 + ((i * 3) % 4), battery: f.battery ? Math.min(100, f.battery.percent + i) : null })),
    changeStats: fresh ? { watched: 0, online: 0 } : { watched: 16, online: 16 },
    sleep: {
      mode: "tiefschlaf",
      asleep: !reachable(f),
      since: reachable(f) ? null : f.lastOnline.at + 90_000,
      onWifi: reachable(f) || !!f.justUpdated,
      bySelf: true,
    },
    lightSleep: null,
    deepSleepAttempt: null,
    checks: { everyMin: 30, last: fresh ? { at: f.lastOnline.at, awake: true } : { at: now() - 9 * MINUTE, awake: reachable(f) }, foundAwake: [] },
    cleaningWindow: {
      quietFrom: clock(ch * 60 + cm - 15),
      quietUntil: clock(ch * 60 + cm + 30),
      readAt: f.cleaning.confirmedAt ?? (fresh ? null : now() - 13 * HOUR),
    },
    deviceCheck: fresh
      ? null
      : {
          at: now() - 3 * DAY,
          name: f.device,
          firmware: "T-EM32DXAKUC-1023.4",
          networkStandby: f.power === "dauerstrom" ? "an" : "aus",
          sleepAfter: f.power === "dauerstrom" ? "nie" : "sofort",
          sleepAfterUpdate: f.power === "dauerstrom" ? "aus" : "an",
          lowPowerWifi: "an",
        },
    round: { n: 2, shown: Math.round(total * 0.45), total },
    lastProblem: null,
    testPattern: null,
    setupTest: f.setupTest ?? null,
    // What really happened at this frame, where the seed tells a story.
    ...f.story,
  }
}

function notes() {
  const list: { level: "ok" | "warn" | "bad"; text: string; link?: string }[] = []
  for (const g of db.groups) {
    for (const o of ["hoch", "quer"] as Orientation[]) {
      const deck = buildDeck(g.id, o)
      if (deck.shortBy > 0 && db.frames.some((f) => f.groupId === g.id && f.orientation === o)) {
        list.push({
          level: "warn",
          text: `${g.name} hat zu wenige Bilder im ${o === "hoch" ? "Hochformat" : "Querformat"}: es fehlen ${deck.shortBy}. Bis dahin bleiben Bilder länger hängen.`,
          link: `/gruppen/${g.id}`,
        })
      }
    }
  }
  return list
}

export const mockApi: PhotoFrameApi = {
  getOverview: () =>
    wait({
      frames: db.frames.map(toFrame),
      groups: db.groups,
      events: db.events,
      notes: notes(),
      inboxCount: db.inbox.length,
      discardedCount: db.discarded.length,
      at: now(),
    }),
  getFrame: (id) => wait(detail(frameRow(id))),

  async updateFrame(id, patch) {
    const f = frameRow(id)
    if (patch.name !== undefined) f.name = patch.name
    if (patch.tags !== undefined) f.tags = patch.tags
    if (patch.upsideDown !== undefined) f.upsideDown = patch.upsideDown
    if (patch.groupId !== undefined && patch.groupId !== f.groupId) {
      for (const g of db.groups) g.frameIds = g.frameIds.filter((x) => x !== id)
      db.groups.find((g) => g.id === patch.groupId)?.frameIds.push(id)
      f.groupId = patch.groupId
    }
    if (patch.power !== undefined) {
      f.power = patch.power
      if (patch.power === "dauerstrom") f.battery = null
    }
    if (patch.cadence) {
      const before = f.cadence
      const from = cadenceText(before.deviceValue ?? before.value)
      f.cadence = { value: patch.cadence, confirmedAt: null, deviceValue: before.deviceValue ?? before.value }
      db.pending = db.pending.filter((p) => !(p.frameId === id && p.kind === "rhythmus" && p.state !== "bestaetigt"))
      addPending(id, "rhythmus", "Wechselrhythmus", { from, to: cadenceText(patch.cadence) }, () => {
        f.cadence = before
      })
    }
    if (patch.cleaning) {
      const before = f.cleaning
      const from = before.deviceValue ?? before.value
      f.cleaning = { value: patch.cleaning, confirmedAt: null, deviceValue: from }
      db.pending = db.pending.filter((p) => !(p.frameId === id && p.kind === "reinigung" && p.state !== "bestaetigt"))
      addPending(id, "reinigung", "Reinigung des Bildschirms", { from, to: patch.cleaning }, () => {
        f.cleaning = before
      })
    }
    if (patch.buffer !== undefined && patch.buffer !== f.buffer) {
      const before = f.buffer
      f.buffer = patch.buffer
      addPending(id, "vorrat", "Bilder auf Vorrat", { from: String(before), to: String(patch.buffer) }, () => {
        f.buffer = before
      })
    }
    return wait(undefined)
  },

  async frameAction(id, action) {
    const f = frameRow(id)
    if (action === "erkennungsbild") addPending(id, "erkennungsbild", "Erkennungsbild zeigen", { extraRedraw: true })
    if (action === "testbild") addPending(id, "testbild", "Testbild zeigen", { extraRedraw: true })
    if (action === "neu-senden") addPending(id, "reihenfolge", "Bilder neu auf den Rahmen laden", {})
    if (action === "pruefen")
      log(
        id,
        "aenderung",
        reachable(f) ? "Rahmen geprüft: Akku und Einstellungen gelesen" : "Rahmen prüfen: er schläft, die Prüfung läuft bei seinem nächsten Melden",
      )
    if (action === "tiefschlaf") log(id, "aenderung", reachable(f) ? "In den Tiefschlaf geschickt" : "Tiefschlaf: der Rahmen ist schon vom WLAN weg")
    return wait(undefined, 500)
  },

  async addFrame(frame) {
    const id = nextId("f")
    const group = db.groups.find((g) => g.id === frame.groupId)
    group?.frameIds.push(id)
    const t = now()
    const test = tests.get(frame.ip)
    // Nothing is known about the panel yet: no picture of ours hangs there. The first regular change
    // follows the chosen rhythm, and the same time is used everywhere the new frame is described.
    db.frames.push({
      id,
      name: frame.name,
      device: frame.device,
      ip: frame.ip,
      orientation: frame.orientation,
      upsideDown: frame.upsideDown,
      groupId: frame.groupId,
      tags: [],
      power: frame.power,
      charging: false,
      health: { level: "ok", title: "Neu verbunden", text: "" },
      battery: frame.power === "akku" ? { percent: 96, at: test?.at ?? t } : null,
      current: { pictureId: null, since: t, unsure: true },
      nextChange: firstRegularAfter(t, frame.cadence),
      lastOnline: { at: test?.at ?? t, secondsAfterChange: null },
      missedChanges: 0,
      justUpdated: null,
      cadence: { value: frame.cadence, confirmedAt: null },
      cleaning: { value: frame.cleaning, confirmedAt: null },
      buffer: frame.buffer,
      queue: [],
      own: [],
      batteryLog: [],
      addedAt: t,
      setupTest: test ? { at: test.at, steps: test.steps } : null,
    })
    log(id, "aenderung", `Rahmen „${frame.name}“ hinzugefügt (${frame.device}, ${frame.ip})`)
    // Rhythm and cleaning time have to reach the frame like any other setting; the Erkennungsbild goes last.
    addPending(id, "rhythmus", "Wechselrhythmus", { to: cadenceText(frame.cadence) })
    addPending(id, "reinigung", "Reinigung des Bildschirms", { to: frame.cleaning })
    addPending(id, "erkennungsbild", "Erkennungsbild zeigen", { extraRedraw: frame.power === "akku" })
    // A battery frame is still awake from the button press of the connection test: it gets everything at once.
    if (frame.power === "akku" && test?.awakeUntil && test.awakeUntil > t) setTimeout(() => deliver(id, "nach Knopfdruck"), 0)
    return wait({ id }, 400)
  },

  testConnection: (ip, power) => {
    const known = db.frames.some((f) => f.ip === ip)
    const steps: ConnectionTest["steps"] = [
      { label: "Rahmen im Netz gefunden", ok: true, note: `${ip}, Port 1515 offen` },
      { label: "Mit der Geräte-PIN angemeldet", ok: true },
      known
        ? { label: "Diese Adresse gehört schon einem anderen Rahmen", ok: false, note: "Bitte die IP-Adresse prüfen" }
        : power === "dauerstrom"
          ? { label: "Einstellungen gelesen", ok: true, note: "Am Strom, Netzwerk-Standby an, Ausrichtung passt" }
          : { label: "Akku und Einstellungen gelesen", ok: true, note: "Akku 96 %, Tiefschlaf an, Ausrichtung passt" },
    ]
    // The test takes a moment; the frame was woken by its button and stays awake for about a minute and a half.
    const at = now() + 1800
    const result = { ok: !known, steps, awakeUntil: power === "akku" && !known ? at + 90_000 : null }
    if (result.ok) tests.set(ip, { at, steps, awakeUntil: result.awakeUntil })
    return wait(result, 1800)
  },

  async removeFrame(id) {
    const f = frameRow(id)
    db.frames = db.frames.filter((x) => x.id !== id)
    for (const g of db.groups) g.frameIds = g.frameIds.filter((x) => x !== id)
    db.pending = db.pending.filter((p) => p.frameId !== id)
    log(null, "aenderung", `Rahmen „${f.name}“ entfernt. Seine vorgemerkten Bilder sind zurück im Stapel`)
    return wait(undefined)
  },

  listPending: (frameId) => wait(db.pending.filter((p) => !frameId || p.frameId === frameId)),

  async withdrawPending(id) {
    const p = db.pending.find((x) => x.id === id)
    if (!p) return wait(undefined)
    if (p.state !== "eingestellt" && p.state !== "wartet") throw new Error("Schon am Rahmen: lässt sich nicht mehr zurücknehmen")
    undo.get(id)?.()
    undo.delete(id)
    if (p.pictureIds) {
      const f = frameRow(p.frameId)
      f.own = f.own.filter((x) => !p.pictureIds?.includes(x))
    }
    db.pending = db.pending.filter((x) => x.id !== id)
    log(p.frameId, "aenderung", changeText(p, true), true, { change: { id: p.id, state: "zurueckgenommen" }, pictureId: p.pictureIds?.[0] })
    return wait(undefined)
  },

  async resolvePending(id, keep) {
    const p = db.pending.find((x) => x.id === id)
    if (!p) return wait(undefined)
    const f = frameRow(p.frameId)
    if (keep === "rahmen") {
      if (p.kind === "reinigung" && p.deviceValue) f.cleaning = { value: p.deviceValue, confirmedAt: now() }
      db.pending = db.pending.filter((x) => x.id !== id)
      log(p.frameId, "aenderung", `${changeText(p)}: stattdessen den Wert vom Rahmen übernommen (${p.deviceValue})`, true, { change: { id: p.id } })
    } else {
      p.state = "eingestellt"
      p.setAt = now()
      p.deviceValue = undefined
      log(p.frameId, "aenderung", `${changeText(p)}: wird erneut gesendet`, true, { change: { id: p.id, state: "eingestellt" } })
    }
    return wait(undefined)
  },

  listGroups: () => wait(db.groups),
  async saveGroup(group) {
    const existing = db.groups.find((g) => g.id === group.id)
    if (existing) Object.assign(existing, group)
    const id = existing?.id ?? nextId("g")
    if (!existing) db.groups.push({ ...group, id })
    const saved = db.groups.find((g) => g.id === id)
    if (saved) rebuildDecks(saved)
    return wait({ id })
  },
  getDeck: (groupId, orientation) => wait(buildDeck(groupId, orientation)),
  async moveDeckCard(groupId, orientation, pictureId, toIndex) {
    const key = `${groupId}/${orientation}`
    const movable = buildDeck(groupId, orientation)
      .cards.filter((c) => c.state === "stapel")
      .map((c) => c.pictureId)
    const from = movable.indexOf(pictureId)
    if (from < 0) return wait(undefined)
    movable.splice(from, 1)
    movable.splice(Math.max(0, Math.min(toIndex, movable.length)), 0, pictureId)
    const rest = db.decks[key].filter((x) => !movable.includes(x))
    db.decks[key] = [...movable, ...rest]
    return wait(undefined, 120)
  },
  getTimeline: (frameId) => wait(buildTimeline(frameRow(frameId))),
  async moveTimelineItem(frameId, pictureId, toIndex) {
    // The frame's movable pictures are pinned to it in their new order.
    // Moving never drops a picture: everything that was reserved for the frame stays reserved,
    // only the order changes. A picture from the deck that is moved in front of a reserved one joins them.
    const f = frameRow(frameId)
    const before = buildTimeline(f).filter((i) => !i.locked)
    const movable = before.map((i) => i.pictureId)
    const from = movable.indexOf(pictureId)
    if (from < 0) return wait(undefined)
    movable.splice(from, 1)
    movable.splice(Math.max(0, Math.min(toIndex, movable.length)), 0, pictureId)
    const reservedBefore = before.filter((i) => i.state !== "geplant").map((i) => i.pictureId)
    const lastReserved = Math.max(-1, ...reservedBefore.map((id) => movable.indexOf(id)))
    const reservedNow = movable.slice(0, lastReserved + 1)
    // The deck keeps its order. Only this frame's probable pictures swap places among themselves,
    // so a new order here does not reshuffle what the other frames of the group will probably get.
    const key = `${f.groupId}/${f.orientation}`
    const planned = movable.filter((id) => !reservedNow.includes(id))
    const deck = [...(db.decks[key] ?? [])]
    const places = deck.flatMap((id, n) => (planned.includes(id) ? [n] : [])).slice(0, planned.length)
    places.forEach((n, i) => {
      deck[n] = planned[i]
    })
    db.decks[key] = deck
    if (reservedNow.join() !== reservedBefore.join()) {
      const pinnedBefore = [...f.own]
      f.own = reservedNow
      // One change carries the order while it has not gone out; an order changed after that is a new change.
      const has = db.pending.some((p) => p.frameId === frameId && p.kind === "reihenfolge" && (p.state === "eingestellt" || p.state === "wartet"))
      if (!has)
        addPending(frameId, "reihenfolge", "Reihenfolge der nächsten Bilder geändert", {}, () => {
          f.own = pinnedBefore
        })
    }
    return wait(undefined, 120)
  },

  listPictures: () => wait(db.pictures.map(toPicture)),
  getPicture: (id) => wait(toPicture(picRow(id))),
  listAlbums: () => {
    const counts = new Map<string, number>()
    for (const p of db.pictures) for (const a of p.albums) counts.set(a, (counts.get(a) ?? 0) + 1)
    return wait([...counts].map(([name, count]) => ({ name, count })))
  },
  async updatePicture(id, patch) {
    const p = picRow(id)
    if (patch.title !== undefined) p.title = patch.title
    if (patch.albums !== undefined) p.albums = patch.albums
    if (patch.paused !== undefined) p.paused = patch.paused
    if (patch.orientation !== undefined) p.orientation = patch.orientation
    if (patch.alsoOther !== undefined) p.alsoOther = patch.alsoOther
    if (patch.crop) p.crops[patch.crop.orientation] = patch.crop.crop
    for (const g of db.groups) rebuildDecks(g)
    const hanging = db.frames.find((f) => f.current.pictureId === id || f.queue.includes(id))
    if (patch.crop && hanging) addPending(hanging.id, "zuschnitt", `Neuer Zuschnitt für „${p.title}“`, { pictureIds: [id] })
    return wait(undefined)
  },
  async deletePicture(id) {
    db.pictures = db.pictures.filter((p) => p.id !== id && !p.combo?.memberIds.includes(id))
    for (const key of Object.keys(db.decks)) db.decks[key] = db.decks[key].filter((x) => x !== id)
    for (const f of db.frames) {
      f.queue = f.queue.filter((x) => x !== id)
      f.own = f.own.filter((x) => x !== id)
    }
    return wait(undefined)
  },
  async createCombo(layout, memberIds) {
    const members = memberIds.map(picRow)
    const id = nextId("k")
    const hoch = layout === "2-uebereinander" || layout === "2x2"
    db.pictures.unshift({
      id,
      title:
        members
          .map((m) => m.title)
          .slice(0, 2)
          .join(" + ") + (members.length > 2 ? ` + ${members.length - 2}` : ""),
      art: members[0].art,
      width: hoch ? 1440 : 2560,
      height: hoch ? 2560 : 1440,
      takenAt: members[0].takenAt,
      addedAt: now(),
      orientation: hoch ? "hoch" : "quer",
      detected: hoch ? "hoch" : "quer",
      alsoOther: false,
      crops: { hoch: { x: 50, y: 50, zoom: 1, auto: true }, quer: { x: 50, y: 50, zoom: 1, auto: true } },
      albums: [...new Set(members.flatMap((m) => m.albums))],
      source: "upload",
      paused: false,
      combo: { layout, memberIds },
      hints: [],
    })
    for (const g of db.groups) {
      const key = `${g.id}/${hoch ? "hoch" : "quer"}`
      if (members.some((m) => m.albums.some((a) => g.albums.includes(a)))) db.decks[key] = [id, ...(db.decks[key] ?? [])]
    }
    return wait({ id })
  },
  planShow: (request) => wait(planShow(request), 90),
  async show(request) {
    const plan = planShow(request)
    for (const line of plan.lines) {
      const f = frameRow(line.frameId)
      for (const other of db.frames) {
        if (other.id !== f.id) other.own = other.own.filter((x) => !line.pictureIds.includes(x))
      }
      f.own = [...line.pictureIds, ...f.own.filter((x) => !line.pictureIds.includes(x))]
      const names = line.pictureIds.length === 1 ? `„${picRow(line.pictureIds[0]).title}“` : `${line.pictureIds.length} Bilder`
      const title = request.when === "jetzt" ? `${names} jetzt zeigen` : `${names} als Nächstes zeigen`
      addPending(line.frameId, request.when === "jetzt" ? "zeigen-jetzt" : "zeigen-naechstes", title, {
        pictureIds: line.pictureIds,
        extraRedraw: line.extraRedraw,
      })
    }
    return wait(plan)
  },

  listInbox: () => wait(db.inbox),
  async acceptInbox(ids, edits = {}) {
    let withoutGroup = 0
    const taken = db.inbox.filter((i) => ids.includes(i.id))
    const made: string[] = []
    for (const item of taken) {
      const id = nextId("b")
      made.push(id)
      // Format and crop chosen in the Eingang stay with the picture.
      const edit = edits[item.id]
      const orientation = edit?.orientation ?? item.orientation
      const crops = { hoch: { x: 50, y: 50, zoom: 1, auto: true }, quer: { x: 50, y: 50, zoom: 1, auto: true } }
      if (edit) crops[orientation] = edit.crop
      db.pictures.unshift({
        id,
        title: item.title,
        art: item.art,
        width: item.width,
        height: item.height,
        takenAt: item.receivedAt - 3 * DAY,
        addedAt: now(),
        orientation,
        detected: item.orientation,
        alsoOther: false,
        crops,
        albums: item.albums,
        source: item.source,
        paused: false,
        combo: null,
        hints: item.hints,
        artwork: item.artwork ?? null,
      })
      const groups = db.groups.filter((g) => item.albums.some((a) => g.albums.includes(a)))
      for (const g of groups) db.decks[`${g.id}/${orientation}`]?.unshift(id)
      // A work of art also counts as placed when a group mixes kept works in.
      const mixed = item.source === "kunst" && db.settings.extras.art && db.groups.some((g) => g.art.every > 0 && g.art.from === "bibliothek")
      if (!groups.length && !mixed) withoutGroup++
    }
    db.inbox = db.inbox.filter((i) => !ids.includes(i.id))
    if (taken.some((i) => i.source === "kunst")) for (const g of db.groups) if (g.art.every > 0) rebuildDecks(g)
    if (taken.length === 1) log(null, "eingang", `„${taken[0].title}“ in die Bibliothek übernommen`, true, { pictureId: made[0] })
    else if (taken.length) log(null, "eingang", `${taken.length} Bilder in die Bibliothek übernommen: ${titleList(taken.map((i) => i.title))}`)
    return wait({ withoutGroup })
  },
  async discardInbox(ids) {
    const gone = db.inbox.filter((i) => ids.includes(i.id))
    db.inbox = db.inbox.filter((i) => !ids.includes(i.id))
    db.discarded.unshift(...gone.map((i) => ({ ...i, discardedAt: now(), keptUntil: now() + KEEP_DISCARDED })))
    if (gone.length)
      log(
        null,
        "eingang",
        gone.length === 1 ? `„${gone[0].title}“ verworfen` : `${gone.length} Bilder verworfen: ${titleList(gone.map((i) => i.title))}`,
        true,
        {
          inbox: "verworfen",
        },
      )
    return wait(undefined)
  },
  listDiscarded: () => wait(db.discarded),
  async restoreInbox(ids) {
    const back = db.discarded.filter((i) => ids.includes(i.id))
    db.discarded = db.discarded.filter((i) => !ids.includes(i.id))
    db.inbox.unshift(...back.map(({ discardedAt: _d, keptUntil: _k, ...item }) => item))
    if (back.length)
      log(
        null,
        "eingang",
        back.length === 1
          ? `„${back[0].title}“ wiederhergestellt: liegt wieder im Eingang`
          : `${back.length} Bilder wiederhergestellt: ${titleList(back.map((i) => i.title))}`,
        true,
        { inbox: "neu" },
      )
    return wait(undefined)
  },

  listEvents: () => wait(db.events),
  estimateEvent: (draft) => wait(estimateEvent(draft), 90),
  async saveEvent(draft) {
    const state = draft.start <= now() && draft.end > now() ? "laeuft" : draft.end <= now() ? "vorbei" : "geplant"
    const existing = db.events.find((e) => e.id === draft.id)
    const id = existing?.id ?? nextId("e")
    if (existing) Object.assign(existing, draft, { state })
    else db.events.push({ ...draft, id, state })
    for (const frameId of draft.frameIds) {
      db.pending = db.pending.filter((p) => !(p.frameId === frameId && p.kind === "event" && p.state !== "bestaetigt"))
      addPending(frameId, "event", `Event „${draft.name}“`, { to: existing ? "geändert" : "neu" })
    }
    log(null, "event", `Event „${draft.name}“ ${existing ? "geändert" : "angelegt"}`)
    return wait({ id })
  },
  async endEvent(id) {
    const e = db.events.find((x) => x.id === id)
    if (!e) return wait(undefined)
    e.end = now()
    e.state = "vorbei"
    for (const frameId of e.frameIds) addPending(frameId, "event", `Event „${e.name}“ beenden`, { to: "zurück zum normalen Rhythmus" })
    log(null, "event", `Event „${e.name}“ beendet`)
    return wait(undefined)
  },
  async deleteEvent(id) {
    const e = db.events.find((x) => x.id === id)
    db.events = db.events.filter((x) => x.id !== id)
    if (e) log(null, "event", `Event „${e.name}“ gelöscht`)
    return wait(undefined)
  },

  getImmich: () =>
    wait({
      connected: db.keys[0].status === "funktioniert",
      version: "3.4.2",
      people: db.immich.people.map((p) => ({ ...p, count: db.immich.assets.filter((a) => a.people.includes(p.id)).length })),
      albums: db.immich.albums.map((a) => ({ ...a, count: db.immich.assets.filter((x) => x.album === a.name).length })),
    }),
  searchImmich: (query) => {
    const text = query.text?.trim().toLowerCase()
    const album = db.immich.albums.find((a) => a.id === query.albumId)
    // Stands in for Immich's smart search: matches what is in the picture.
    const words: Record<string, string[]> = {
      katze: ["katze1", "katze2", "katze3"],
      tier: ["katze1", "katze2", "katze3"],
      strand: ["meer"],
      meer: ["meer", "leuchtturm"],
      boot: ["meer"],
      berg: ["berge"],
      wandern: ["berge"],
      leuchtturm: ["leuchtturm"],
      weihnacht: ["baum", "kerze"],
      baum: ["baum"],
      kerze: ["kerze"],
      kuchen: ["kuchen"],
      geburtstag: ["kuchen"],
      familie: ["familie1", "familie2", "familie3", "familie4", "familie5"],
      kind: ["familie1", "familie2", "familie5"],
    }
    const motifs = text
      ? Object.entries(words)
          .filter(([w]) => text.includes(w) || w.includes(text))
          .flatMap(([, m]) => m)
      : null
    const found = db.immich.assets.filter(
      (a) =>
        (!motifs || motifs.includes(a.art.motif) || a.title.toLowerCase().includes(text ?? "")) &&
        (!album || a.album === album.name) &&
        (!query.favorites || a.favorite) &&
        (!query.personIds?.length || query.personIds.some((p) => a.people.includes(p))) &&
        (!query.from || a.takenAt >= query.from) &&
        (!query.to || a.takenAt <= query.to + DAY),
    )
    return wait(found, 350)
  },
  async importFromImmich(assetIds) {
    for (const a of db.immich.assets.filter((x) => assetIds.includes(x.id))) {
      a.imported = true
      db.inbox.unshift({
        id: nextId("n"),
        title: a.title,
        art: a.art,
        width: a.width,
        height: a.height,
        orientation: a.height > a.width ? "hoch" : "quer",
        source: "immich",
        sourceNote: a.album ? `Immich-Album „${a.album}“` : "Aus Immich",
        receivedAt: now(),
        albums: a.album ? [a.album.replace(/ \d{4}$/, "")] : [],
        hints: [],
        duplicateOf: null,
      })
    }
    const fetched = db.immich.assets.filter((x) => assetIds.includes(x.id)).map((a) => a.title)
    if (fetched.length)
      log(
        null,
        "eingang",
        fetched.length === 1 ? `„${fetched[0]}“ aus Immich geholt: liegt im Eingang` : `${fetched.length} Bilder aus Immich geholt: ${titleList(fetched)}`,
        true,
        { inbox: "neu" },
      )
    return wait(undefined, 600)
  },
  async subscribeAlbum(albumId, on) {
    const a = db.immich.albums.find((x) => x.id === albumId)
    if (a) Object.assign(a, { subscribed: on, lastSync: on ? now() : null })
    return wait(undefined)
  },

  searchArt: (query) => {
    const text = query.text?.trim().toLowerCase()
    const taken = new Set([...db.pictures, ...db.inbox].flatMap((p) => (p.artwork ? [p.artwork.workId] : [])))
    const found: ArtWork[] = CATALOGUE.filter(
      (w) =>
        (!text || `${w.title} ${w.artist} ${w.words}`.toLowerCase().includes(text)) &&
        (!query.source || w.source === query.source) &&
        (!query.fits || bestFormat(w.width, w.height) === query.fits) &&
        (!query.topPicks || w.topPick),
    ).map(({ words: _w, ...w }) => ({ ...w, taken: taken.has(w.id) }))
    return wait(found, 350)
  },
  async importArt(workIds) {
    const works = CATALOGUE.filter((w) => workIds.includes(w.id))
    for (const w of works) {
      const { workId, artist, date, source, licence } = w
      db.inbox.unshift({
        id: nextId("n"),
        title: w.title,
        art: w.art,
        width: w.width,
        height: w.height,
        orientation: bestFormat(w.width, w.height),
        source: "kunst",
        sourceNote: `Kunstkatalog, ${ART_SOURCE_NAME[w.source]}`,
        receivedAt: now(),
        albums: ["Kunst"],
        hints: [],
        duplicateOf: null,
        artwork: { workId, artist, date, source, licence },
      })
    }
    if (works.length)
      log(
        null,
        "eingang",
        works.length === 1
          ? `„${works[0].title}“ aus dem Kunstkatalog geholt: liegt im Eingang`
          : `${works.length} Kunstwerke aus dem Katalog geholt: ${titleList(works.map((w) => w.title))}`,
        true,
        { inbox: "neu" },
      )
    return wait(undefined, 600)
  },

  getSettings: () => wait(db.settings),
  async updateSettings(patch) {
    Object.assign(db.settings, patch)
    // Switching the art catalogue on or off puts the works into the decks or takes them out again.
    if (patch.extras) for (const g of db.groups) rebuildDecks(g)
    return wait(undefined)
  },
  listKeys: () => wait(db.keys),
  async saveKey(id, key) {
    const k = db.keys.find((x) => x.id === id)
    if (k) {
      // The key itself is dropped here: nothing in the mock or the interface keeps it.
      const good = !key.toLowerCase().startsWith("falsch")
      Object.assign(k, {
        source: "hier",
        saved: true,
        status: good ? "funktioniert" : "funktioniert-nicht",
        statusNote: good ? "Schlüssel angenommen" : "Der Dienst lehnt diesen Schlüssel ab",
        testedAt: now(),
      })
    }
    return wait(undefined, 700)
  },
  async removeKey(id) {
    const k = db.keys.find((x) => x.id === id)
    if (k) Object.assign(k, { source: null, saved: false, status: "fehlt", statusNote: "Noch kein Schlüssel hinterlegt", testedAt: null })
    return wait(undefined)
  },
  async testKey(id) {
    const k = db.keys.find((x) => x.id === id)
    if (!k) throw new Error("Unbekannter Zugang")
    if (k.saved) k.testedAt = now()
    return wait(k, 1200)
  },

  listHistory: (frameId) => wait(db.history.filter((h) => !frameId || h.frameId === frameId)),
}

export const mockControls: PrototypeControls = {
  async pressButton(frameId) {
    const f = frameRow(frameId)
    log(frameId, "aenderung", "Knopf gedrückt: der Rahmen hat sich gemeldet", true, { battery: f.battery?.percent })
    if (f.battery) f.battery = { ...f.battery, at: now() }
    f.justUpdated = null
    // The frame is back: what the story said about its last delivery and problem is over.
    if (f.story) f.story = { ...f.story, lastProblem: null }
    delete f.story?.delivery
    if (f.missedChanges) {
      f.missedChanges = 0
      f.health =
        (f.battery?.percent ?? 100) < 10
          ? { level: "bad", title: "Akku fast leer", text: "Der Rahmen ist wieder da und hat neue Bilder. Bitte jetzt laden." }
          : { level: "ok", title: "Alles in Ordnung", text: "" }
    }
    deliver(frameId, "nach Knopfdruck")
    return wait(undefined, 300)
  },
}
