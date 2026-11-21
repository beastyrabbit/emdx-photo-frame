// Data shapes shared by the interface and the backend.
// Times are milliseconds since 1970; ids are opaque strings.

export type Orientation = "hoch" | "quer"
export type PowerMode = "akku" | "dauerstrom"
export type HealthLevel = "ok" | "warn" | "bad"

/** How often a frame changes its picture. `everyMin` is the gap between two changes, `at` the first change of a day. */
export interface Cadence {
  everyMin: number
  at: string
  /** Last daily change, inclusive; earlier than `at` means after midnight. */
  until?: string
}

/**
 * A value the owner sets and the frame has to take over.
 * `confirmedAt` is when the frame last reported `value` itself.
 * `deviceValue` is set only when the frame reports something else.
 */
export interface Setting<T> {
  value: T
  confirmedAt: number | null
  deviceValue?: T
}

export type TestCardKind = "erkennungsbild" | "testbild"

export interface BatteryReading {
  at: number
  percent: number
  charging: boolean
}

export interface Frame {
  id: string
  /** Free name of the place, e.g. "Wohnzimmer links". */
  name: string
  /** Device name as the Samsung app shows it, e.g. "Frame 3". */
  device: string
  ip: string
  orientation: Orientation
  upsideDown: boolean
  groupId: string
  tags: string[]
  power: PowerMode
  /** A battery frame on the charger: reachable like one on mains power. */
  charging: boolean
  health: { level: HealthLevel; title: string; text: string }
  /** null for a frame on mains power. */
  battery: {
    percent: number
    at: number
    /** Outlook on the rhythm the frame confirmed, not on a change that still waits. */
    until: number | null
    changesLeft: number | null
    /** Outlook once a waiting rhythm change has arrived; null when none waits. */
    afterPending: { until: number; changesLeft: number; cadence: Cadence } | null
  } | null
  current: {
    /** null while the panel shows a test card, or while the frame has no picture from this service yet. */
    pictureId: string | null
    since: number
    unsure: boolean
    /** Set once the frame confirmed an Erkennungsbild or Testbild: the panel shows that card until `until`. */
    card: { kind: TestCardKind; until: number } | null
  }
  nextChange: number
  /** When the frame is next reachable. `uncertain` when the battery is nearly empty or changes were missed. */
  nextOnline: { at: number; uncertain: boolean; immediate: boolean }
  lastOnline: { at: number; secondsAfterChange: number | null }
  missedChanges: number
  /** After a delivery the frame can stay on the Wi-Fi for a while; it is left alone until then. */
  justUpdated: { at: number } | null
  /** Set while the server looks for the frame every few seconds to catch a button press. */
  watching: { everySec: number; until: number } | null
  cadence: Setting<Cadence>
  cleaning: Setting<string>
  /** Pictures kept on the frame ahead of the current one (1 to 5). */
  buffer: number
  /** Pictures on the frame ahead of the current one right now. */
  bufferLeft: number
  /** Changes waiting for this frame, not yet confirmed. */
  pendingCount: number
  /** An Event running on this frame right now. */
  eventId: string | null
  /** The picture this frame shows after the current one; null when nothing is known yet. */
  upNext: FrameNext | null
}

/**
 * What a frame shows next, for the overview's "Als Nächstes".
 * `state` as in `TimelineItem`: "am-rahmen" is already on the frame, "wartet" goes over at its next
 * online moment, "geplant" will probably be drawn from the deck. `uncertain`: the time is only a guess,
 * because the frame missed changes or has not reported yet.
 */
export interface FrameNext {
  pictureId: string
  at: number
  state: Exclude<TimelineState, "haengt">
  uncertain: boolean
}

/** Everything today's status page shows for one frame. */
export interface FrameDetail extends Frame {
  batteryLog: BatteryReading[]
  delivery: { sentAt: number; pictures: number; endsAt: number; usedUp: boolean } | null
  changes: { at: number; onlineAfterSec: number | null; battery: number | null }[]
  /** `watched` is 0 for a frame that has not changed its picture since it was added. */
  changeStats: { watched: number; online: number }
  sleep: { mode: "tiefschlaf" | "standby"; asleep: boolean; since: number | null; onWifi: boolean; bySelf: boolean }
  lightSleep: {
    since: number
    until: number | null
    tries: { at: number; result: string }[]
    gaveUp: boolean
    /** Battery at the start and the end of the light sleep. */
    batteryFrom: number | null
    batteryTo: number | null
  } | null
  deepSleepAttempt: { at: number; result: string; ok: boolean } | null
  checks: {
    everyMin: number
    last: { at: number; awake: boolean }
    foundAwake: { at: number; battery: number | null; charging: boolean; note: string }[]
  }
  cleaningWindow: { quietFrom: string; quietUntil: string; readAt: number | null }
  deviceCheck: {
    at: number
    name: string
    firmware: string
    networkStandby: string
    sleepAfter: string
    sleepAfterUpdate: string
    lowPowerWifi: string
  } | null
  round: { n: number; shown: number; total: number }
  lastProblem: { at: number; text: string } | null
  testPattern: { at: number } | null
  /** The connection test of the add-frame wizard, kept apart from later device checks. null for frames from before. */
  setupTest: { at: number; steps: ConnectionTest["steps"] } | null
}

export interface Group {
  id: string
  name: string
  /** The theme: pictures from these albums go into the group's decks. */
  albums: string[]
  frameIds: string[]
  /** "Kunst untermischen": every n-th picture of the group's decks is a work of art. */
  art: ArtMix
}

export interface ArtMix {
  /** 0 = off. */
  every: 0 | 3 | 5 | 10
  /** "bibliothek": works the owner took into the library. "katalog": the catalogue's top picks, added by the service itself. */
  from: "bibliothek" | "katalog"
}

export type PendingKind =
  | "zeigen-jetzt"
  | "zeigen-naechstes"
  | "reihenfolge"
  | "rhythmus"
  | "reinigung"
  | "vorrat"
  | "event"
  | "erkennungsbild"
  | "testbild"
  | "zuschnitt"

/**
 * eingestellt: saved here, nothing sent yet
 * wartet: the server is looking for the frame
 * uebertragen: sent to the frame, not yet confirmed
 * bestaetigt: the frame confirmed it
 * abweichend: the frame reports another value
 */
export type PendingState = "eingestellt" | "wartet" | "uebertragen" | "bestaetigt" | "abweichend"

export interface PendingChange {
  verification?: string
  id: string
  frameId: string
  kind: PendingKind
  title: string
  from?: string
  to?: string
  pictureIds?: string[]
  state: PendingState
  setAt: number
  sentAt?: number
  confirmedAt?: number
  /** What the frame reported instead (state "abweichend"). */
  deviceValue?: string
  /** Costs the frame one picture build-up beyond its regular changes. */
  extraRedraw: boolean
}

/** A picture discarded from the Eingang. It is kept until `keptUntil` and can be restored until then. */
export interface DiscardedItem extends InboxItem {
  discardedAt: number
  keptUntil: number
}

export type PictureSource = "upload" | "immich" | "kunst" | "erzeugt" | "foto"
export type ComboLayout = "2-nebeneinander" | "3-nebeneinander" | "2-uebereinander" | "2x2"
export type Hint = "zu-klein" | "unscharf" | "doppelt"

/** Describes a generated placeholder picture. The real backend sends image URLs instead. */
export interface Art {
  motif: string
  variant: number
  url?: string
  originalUrl?: string
}

export interface Crop {
  /** Centre of the crop in percent of the picture, and zoom (1 = as large as fits). */
  x: number
  y: number
  zoom: number
  auto: boolean
  /** Normalized upright crop returned by the editor. */
  rect?: { x: number; y: number; width: number; height: number }
}

export interface Picture {
  id: string
  title: string
  art: Art
  width: number
  height: number
  takenAt: number
  addedAt: number
  /** The deck this picture is in, from its crop. */
  orientation: Orientation
  /** The orientation found from the picture's shape. */
  detected: Orientation
  /** Has a second crop and is in both decks. */
  alsoOther: boolean
  crops: Record<Orientation, Crop>
  albums: string[]
  source: PictureSource
  paused: boolean
  combo: { layout: ComboLayout; memberIds: string[] } | null
  hints: Hint[]
  /** Set for a work from the art catalogue: who made it and where it comes from. */
  artwork?: ArtCredit | null
  where: PictureWhere
  /** Groups whose theme includes one of the picture's albums. Empty: the picture is in no deck. */
  groupIds: string[]
}

export interface PictureWhere {
  hangs: { frameId: string; since: number } | null
  reserved: { frameId: string; at: number } | null
  lastShown: { frameId: string; at: number } | null
  /** Already shown in the current round of its deck: it comes back after the next reshuffle. */
  shownThisRound: boolean
  /** Left a frame only just now: it is not dealt to another frame yet, and "Zeigen" warns. The backend decides how long that is. */
  justShown: boolean
}

export interface InboxItem {
  id: string
  title: string
  art: Art
  width: number
  height: number
  orientation: Orientation
  source: PictureSource
  /** Where exactly it came from, e.g. the Immich album. */
  sourceNote: string
  receivedAt: number
  albums: string[]
  hints: Hint[]
  duplicateOf: string | null
  artwork?: ArtCredit | null
}

export type CardState = "stapel" | "vorgemerkt" | "haengt" | "gezeigt"

export interface DeckCard {
  pictureId: string
  state: CardState
  /** Frame it hangs on, is reserved for, or will probably go to. */
  frameId: string | null
  /** When it will probably appear (state "stapel" or "vorgemerkt"); null for a card shown in this round. */
  expectedAt: number | null
  /** Cannot be moved anywhere any more: it hangs, or a sleeping frame changes to it before it reports in. */
  locked: boolean
  /**
   * Set when the card has no place of its own on the frame: it only shares the lock of this picture,
   * a combined picture it is part of or a picture it contains. Not an extra slot in the schedule.
   */
  sharedWith: string | null
}

export interface Deck {
  groupId: string
  orientation: Orientation
  cards: DeckCard[]
  /** Set when there are too few pictures for all frames of the group and their buffers. */
  shortBy: number
}

export type TimelineState = "haengt" | "am-rahmen" | "wartet" | "geplant"

export interface TimelineItem {
  pictureId: string
  at: number
  /**
   * haengt: on the panel now
   * am-rahmen: already delivered, changes by itself, cannot be moved
   * wartet: goes to the frame at its next online moment
   * geplant: will probably be drawn for this frame later
   */
  state: TimelineState
  eventId: string | null
  /** Pinned to this frame by the owner. */
  pinned: boolean
  /** Cannot be moved any more: it hangs, or a sleeping frame changes to it before it is reachable again. */
  locked: boolean
  /** How far the owner's change that put it here has got; null when no such change is open. */
  change: PendingState | null
}

export interface FrameEvent {
  id: string
  name: string
  start: number
  end: number
  frameIds: string[]
  pictureIds: string[]
  everyMin: number
  sameOnAll: boolean
  state: "geplant" | "laeuft" | "vorbei"
}

export interface EventDraft {
  id?: string
  name: string
  start: number
  end: number
  frameIds: string[]
  pictureIds: string[]
  everyMin: number
  sameOnAll: boolean
}

export interface EventEstimate {
  perFrame: {
    frameId: string
    changes: number
    /** Extra battery in percent points; null on mains power. */
    extraBattery: number | null
    batteryAfter: number | null
    /**
     * Why a button press is needed before the start, if it is:
     * "verpasst": the frame missed contacts or its battery is nearly empty, its next contact is not sure
     * "zu-spaet": its next regular contact is after the start
     */
    pressReason: "verpasst" | "zu-spaet" | null
    /** When the frame is next reachable by itself; null when it is reachable all the time. */
    nextContact: number | null
    /** None of the Event's pictures has a crop in this frame's format. */
    missingFormat: boolean
    overlapsWith: string | null
  }[]
  repeats: boolean
}

/** What the owner changed on a picture while it was still in the Eingang. */
export interface InboxEdit {
  orientation: Orientation
  crop: Crop
}

export type ShowWhen = "jetzt" | "naechstes"
export type ShowScope = { frameId: string } | "haus"

export interface ShowRequest {
  pictureIds: string[]
  when: ShowWhen
  scope: ShowScope
  /** Show although a picture hangs elsewhere, is reserved elsewhere or left a frame only just now. */
  force: boolean
}

export interface ShowPlan {
  lines: {
    frameId: string
    pictureIds: string[]
    /** Each picture with the time it will probably be on the panel, in order. */
    items: { pictureId: string; at: number }[]
    /** When the change reaches the frame: its next online moment. */
    transferAt: number
    /** When the first picture will be on the panel. */
    at: number
    uncertain: boolean
    /** Reachable right away (mains power or charging). */
    immediate: boolean
    extraRedraw: boolean
  }[]
  /**
   * Why a picture would be seen twice. `at`: for "vorgemerkt" when it will show on that frame,
   * for "eben" (hing eben erst) when it left that frame; null for "haengt".
   */
  warnings: { pictureId: string; reason: "haengt" | "vorgemerkt" | "eben"; frameId: string; at: number | null }[]
  /** Pictures that fit no frame in the chosen scope. */
  unplaced: string[]
}

export interface HistoryEntry {
  id: string
  at: number
  frameId: string | null
  kind: "wechsel" | "uebertragung" | "aenderung" | "problem" | "eingang" | "event"
  text: string
  ok: boolean
  battery?: number
  /** The picture the entry is about. */
  pictureId?: string
  /**
   * The pending change the entry belongs to and the stage it reached with this entry.
   * Setting, transfer and confirmation of one change carry the same id. `how`: "am Strom", "nach Knopfdruck" …
   */
  change?: { id: string; state?: PendingState | "zurueckgenommen"; how?: string }
  /** The entry is about the Eingang: its new pictures, or the discarded ones. */
  inbox?: "neu" | "verworfen"
  eventId?: string
}

export interface HouseSettings {
  localSecretsKey?: boolean
  immichUrl?: string
  immichUrlLocked?: boolean
  autoAccept: boolean
  /** Further picture sources. `art` switches the art catalogue on: the "Kunst" area and "Kunst untermischen". */
  extras: { generate: boolean; art: boolean }
}

/** Where a work comes from. "aic" only on works taken from the old catalogue choice; "wordpress" is the photo directory. */
export type ArtSource = "wikimedia" | "met" | "cleveland" | "smk" | "aic" | "wordpress"

/** Who made a work of art and where its picture comes from. Stays with the picture after it is taken over. */
export interface ArtCredit {
  workId: string
  artist: string
  /** As the catalogue gives it: "1831", "um 1665". */
  date: string
  source: ArtSource
  licence: string
}

/** A public-domain work (a museum, Commons or the paperlesspaper catalogue), or a CC0 photo. */
export interface ArtWork extends ArtCredit {
  id: string
  title: string
  art: Art
  width: number
  height: number
  /** One of the catalogue's top picks. */
  topPick: boolean
  /** The picture is shorter than 1440 pixels on its short side: a frame would enlarge it. */
  small?: boolean
  /** Already in the Eingang or the library. */
  taken: boolean
}

export interface ArtQuery {
  text?: string
  source?: ArtSource
  /** Only works whose shape suits frames of this format. */
  fits?: Orientation
  topPicks?: boolean
  /** The `next` of the page before. */
  cursor?: string | null
}

export interface PhotoQuery {
  text?: string
  fits?: Orientation
  cursor?: string | null
}

/** One page of works or photos. `failed` names collections that did not answer this time. */
export interface ArtPage {
  items: ArtWork[]
  next: string | null
  failed: string[]
}

export interface FrameSettingsPatch {
  name?: string
  groupId?: string
  tags?: string[]
  power?: PowerMode
  cadence?: Cadence
  cleaning?: string
  buffer?: number
  upsideDown?: boolean
  /** Write-only: replaces the stored device PIN. */
  pin?: string
}

export interface NewFrame {
  name: string
  device: string
  ip: string
  orientation: Orientation
  upsideDown: boolean
  power: PowerMode
  cadence: Cadence
  cleaning: string
  buffer: number
  groupId: string
  /** null = use the PIN the other frames use. Never sent back. */
  pin: string | null
}

export interface ConnectionTest {
  ok: boolean
  steps: { label: string; ok: boolean; note?: string }[]
  /** A battery frame woken by its button: about when it falls asleep again. null when it is reachable all the time. */
  awakeUntil: number | null
}

export type KeyStatus = "funktioniert" | "funktioniert-nicht" | "fehlt"

/** An access key for a connected service. The key itself is never sent to the interface. */
export interface AccessKey {
  id: "immich" | "openrouter"
  name: string
  purpose: string
  /** "hier": entered on this page. "infisical": comes from the server's configuration, locked here. */
  source: "hier" | "infisical" | null
  saved: boolean
  status: KeyStatus
  statusNote: string
  testedAt: number | null
  /** Not used by anything yet. */
  later: boolean
}

export interface ImmichAsset {
  id: string
  title: string
  art: Art
  width: number
  height: number
  takenAt: number
  album: string | null
  favorite: boolean
  people: string[]
  /** Already in the library or the Eingang. */
  imported: boolean
}

export interface ImmichQuery {
  text?: string
  personIds?: string[]
  albumId?: string
  favorites?: boolean
  from?: number
  to?: number
  cursor?: string | null
}

export interface ImmichPage {
  items: ImmichAsset[]
  nextCursor: string | null
}

export interface ImmichStatus {
  connected: boolean
  version: string
  people: { id: string; name: string; count: number }[]
  albums: { id: string; name: string; count: number; subscribed: boolean; lastSync: number | null }[]
}

export interface Overview {
  frames: Frame[]
  groups: Group[]
  events: FrameEvent[]
  /** House-wide notes, e.g. too few pictures for a group. */
  notes: { level: HealthLevel; text: string; link?: string }[]
  inboxCount: number
  /** Pictures discarded from the Eingang that can still be restored. */
  discardedCount: number
  at: number
}
