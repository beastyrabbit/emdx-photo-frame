import { at, DAY, HOUR, MINUTE } from "@/lib/clock"
import type {
  AccessKey,
  Art,
  BatteryReading,
  Cadence,
  DiscardedItem,
  FrameDetail,
  FrameEvent,
  Group,
  HealthLevel,
  HistoryEntry,
  HouseSettings,
  ImmichAsset,
  InboxItem,
  Orientation,
  PendingChange,
  Picture,
  PictureSource,
  PowerMode,
  Setting,
  TestCardKind,
} from "../types"
import { CATALOGUE } from "./catalogue"

// The house the prototype shows: 8 frames in 3 groups on Thursday 19 Nov 2026, 09:30.

/** What the mock keeps per frame; the API derives the rest. */
export interface FrameRow {
  id: string
  name: string
  device: string
  ip: string
  orientation: Orientation
  upsideDown: boolean
  groupId: string
  tags: string[]
  power: PowerMode
  charging: boolean
  health: { level: HealthLevel; title: string; text: string }
  battery: { percent: number; at: number } | null
  /** `card`: the panel shows this test card instead of a picture, until the next change. */
  current: { pictureId: string | null; since: number; unsure: boolean; card?: TestCardKind }
  nextChange: number
  lastOnline: { at: number; secondsAfterChange: number | null }
  missedChanges: number
  justUpdated: { at: number } | null
  cadence: Setting<Cadence>
  cleaning: Setting<string>
  buffer: number
  /** Pictures already on the frame, in order. */
  queue: string[]
  /** Pictures the owner pinned to this frame, not yet delivered. */
  own: string[]
  batteryLog: BatteryReading[]
  /** What really happened at this frame, where the generated status would not tell the story. */
  story?: Partial<Pick<FrameDetail, "delivery" | "changes" | "changeStats" | "lightSleep" | "deepSleepAttempt" | "checks" | "deviceCheck" | "lastProblem">>
  /** Set for a frame added in this session: it has no past, and nothing is made up for it. */
  addedAt?: number
  setupTest?: FrameDetail["setupTest"]
  /** When the frame last got pictures in this session. */
  lastDelivery?: number
}

export interface Db {
  frames: FrameRow[]
  groups: Group[]
  pictures: Omit<Picture, "where" | "groupIds">[]
  inbox: InboxItem[]
  /** Discarded from the Eingang, kept for a while. */
  discarded: DiscardedItem[]
  /** Deck order per "<groupId>/<orientation>". */
  decks: Record<string, string[]>
  /** When a picture last left a frame in the current round of its deck. */
  shown: Record<string, { frameId: string; at: number }>
  pending: PendingChange[]
  events: FrameEvent[]
  history: HistoryEntry[]
  settings: HouseSettings
  keys: AccessKey[]
  immich: {
    assets: ImmichAsset[]
    people: { id: string; name: string }[]
    albums: { id: string; name: string; subscribed: boolean; lastSync: number | null }[]
  }
}

function rng(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ALBUMS: { name: string; count: number; motifs: string[]; titles: string[] }[] = [
  {
    name: "Familie",
    count: 42,
    motifs: ["familie1", "familie2", "familie3", "familie4", "familie5", "kuchen"],
    titles: [
      "Frühstück im Garten",
      "Mia auf der Schaukel",
      "Opa Karl liest vor",
      "Laternenumzug",
      "Erster Schultag",
      "Sonntag am See",
      "Jonas mit Drachen",
      "Pfannkuchen",
      "Geburtstag Oma Helga",
      "Im Laubhaufen",
      "Fahrradtour",
      "Kissenschlacht",
      "Zelten im Garten",
      "Auf dem Spielplatz",
    ],
  },
  {
    name: "Katzen",
    count: 30,
    motifs: ["katze1", "katze2", "katze3"],
    titles: [
      "Minka am Fenster",
      "Minka schläft",
      "Felix im Karton",
      "Felix jagt den Ball",
      "Minka auf dem Sofa",
      "Zwei auf der Heizung",
      "Felix gähnt",
      "Minka im Wäschekorb",
      "Felix am Fenster",
      "Minka und das Wollknäuel",
    ],
  },
  {
    name: "Urlaub",
    count: 34,
    motifs: ["meer", "berge", "leuchtturm", "stadt"],
    titles: [
      "Strand bei Zingst",
      "Wanderung zur Hütte",
      "Leuchtturm Darßer Ort",
      "Altstadt von Porto",
      "Segelboot vor Rügen",
      "Blick vom Gipfel",
      "Fähre nach Hiddensee",
      "Lissabon von oben",
      "Abend am Hafen",
      "Bergsee am Morgen",
      "Dünenweg",
      "Gasse in Tavira",
    ],
  },
  {
    name: "Weihnachten",
    count: 14,
    motifs: ["baum", "kerze", "kuchen"],
    titles: ["Baum schmücken", "Erster Advent", "Plätzchen backen", "Heiligabend", "Kerzen am Fenster", "Bescherung", "Weihnachtsmarkt"],
  },
]

const autoCrop = { x: 50, y: 50, zoom: 1, auto: true }

function makePictures(): Omit<Picture, "where" | "groupIds">[] {
  const rand = rng(7)
  const list: Omit<Picture, "where" | "groupIds">[] = []
  let n = 0
  for (const album of ALBUMS) {
    for (let i = 0; i < album.count; i++) {
      n++
      const round = Math.floor(i / album.titles.length)
      const title = album.titles[i % album.titles.length] + (round ? ` ${2026 - round}` : "")
      const detected: Orientation = rand() < 0.6 ? "hoch" : "quer"
      const big = rand() < 0.5
      const [w, h] = detected === "hoch" ? (big ? [3024, 4032] : [2268, 4032]) : big ? [4032, 3024] : [4032, 2268]
      const source: PictureSource = rand() < 0.45 ? "immich" : "upload"
      const art: Art = { motif: album.motifs[i % album.motifs.length], variant: Math.floor(rand() * 24) }
      const albums = [album.name]
      if (album.name === "Urlaub" && rand() < 0.18) albums.push("Familie")
      list.push({
        id: `b${String(n).padStart(3, "0")}`,
        title,
        art,
        width: w,
        height: h,
        takenAt: at(-Math.floor(rand() * 900) - 3, 8 + Math.floor(rand() * 10), Math.floor(rand() * 60)),
        addedAt: at(-Math.floor(rand() * 60) - 1, 19, Math.floor(rand() * 60)),
        orientation: detected,
        detected,
        alsoOther: rand() < 0.08,
        crops: { hoch: { ...autoCrop }, quer: { ...autoCrop } },
        albums,
        source,
        paused: false,
        combo: null,
        hints: [],
      })
    }
  }
  // A few special ones.
  for (const id of ["b017", "b055", "b101"]) {
    const p = list.find((x) => x.id === id)
    if (p) p.paused = true
  }
  const kunst = list.find((x) => x.id === "b090")
  const welle = CATALOGUE.find((w) => w.id === "w-welle")
  if (kunst && welle) {
    const { workId, artist, date, source, licence } = welle
    Object.assign(kunst, {
      source: "kunst",
      title: welle.title,
      albums: ["Kunst"],
      art: welle.art,
      width: welle.width,
      height: welle.height,
      orientation: "quer",
      detected: "quer",
      alsoOther: false,
      artwork: { workId, artist, date, source, licence },
    })
  }
  const erzeugt = list.find((x) => x.id === "b091")
  if (erzeugt) Object.assign(erzeugt, { source: "erzeugt", title: "Reiher im Nebel" })
  return list
}

function addCombos(pictures: Omit<Picture, "where" | "groupIds">[]) {
  const pick = (album: string, o: Orientation, skip: number, count: number) =>
    pictures.filter((p) => p.albums.includes(album) && p.detected === o && !p.combo && !p.paused).slice(skip, skip + count)
  const combos: { title: string; layout: NonNullable<Picture["combo"]>["layout"]; members: typeof pictures; o: Orientation; album: string }[] = [
    { title: "Minka und Felix", layout: "2-uebereinander", members: pick("Katzen", "quer", 6, 2), o: "hoch", album: "Katzen" },
    { title: "Drei vom Strand", layout: "3-nebeneinander", members: pick("Urlaub", "hoch", 10, 3), o: "quer", album: "Urlaub" },
    { title: "Ein Tag am See", layout: "2x2", members: pick("Familie", "hoch", 14, 4), o: "hoch", album: "Familie" },
    { title: "Hütte und Gipfel", layout: "2-nebeneinander", members: pick("Urlaub", "hoch", 14, 2), o: "quer", album: "Urlaub" },
  ]
  combos.forEach((c, i) => {
    pictures.push({
      id: `k${i + 1}`,
      title: c.title,
      art: c.members[0].art,
      width: c.o === "hoch" ? 1440 : 2560,
      height: c.o === "hoch" ? 2560 : 1440,
      takenAt: c.members[0].takenAt,
      addedAt: at(-2 - i, 20, 10),
      orientation: c.o,
      detected: c.o,
      alsoOther: false,
      crops: { hoch: { ...autoCrop }, quer: { ...autoCrop } },
      albums: [c.album],
      source: "upload",
      paused: false,
      combo: { layout: c.layout, memberIds: c.members.map((m) => m.id) },
      hints: [],
    })
  })
}

function batteryLog(percentNow: number, perDay: number, chargedDaysAgo: number | null, charging: boolean): BatteryReading[] {
  const log: BatteryReading[] = []
  for (let d = 0; d < 14; d++) {
    let percent = percentNow + d * perDay
    if (chargedDaysAgo !== null && d > chargedDaysAgo) percent = 12 + (d - chargedDaysAgo - 1) * perDay
    log.push({ at: at(-d, 6, 0), percent: Math.max(1, Math.min(100, Math.round(percent))), charging: charging && d === 0 })
  }
  return log
}

const confirmed = <T>(value: T, daysAgo: number): Setting<T> => ({ value, confirmedAt: at(-daysAgo, 6, 0) })

export function seed(): Db {
  const pictures = makePictures()
  addCombos(pictures)

  const groups: Group[] = [
    { id: "g-wohnen", name: "Wohnbereich", albums: ["Familie", "Urlaub"], frameIds: ["f1", "f2", "f3"], art: { every: 0, from: "bibliothek" } },
    { id: "g-flur", name: "Flur und Treppe", albums: ["Katzen", "Familie"], frameIds: ["f4", "f5", "f6"], art: { every: 0, from: "bibliothek" } },
    { id: "g-oben", name: "Obergeschoss", albums: ["Urlaub", "Katzen"], frameIds: ["f7", "f8"], art: { every: 0, from: "bibliothek" } },
  ]

  // Hand out pictures: what hangs, what is on the frames, what the Event uses.
  const used = new Set<string>()
  const take = (album: string, o: Orientation, count: number, motif?: string) => {
    const found = pictures
      .filter((p) => !used.has(p.id) && !p.paused && p.albums.includes(album) && p.orientation === o && (!motif || p.art.motif === motif))
      .slice(0, count)
    for (const p of found) used.add(p.id)
    return found.map((p) => p.id)
  }

  const eventHoch = take("Familie", "hoch", 10)
  const eventQuer = take("Familie", "quer", 4)
  const geburtstag: FrameEvent = {
    id: "e1",
    name: "Geburtstag Mia",
    start: at(0, 8),
    end: at(1, 3),
    frameIds: ["f1", "f2", "f3"],
    pictureIds: [...eventHoch, ...eventQuer],
    everyMin: 60,
    sameOnAll: false,
    state: "laeuft",
  }
  const weihnachten: FrameEvent = {
    id: "e2",
    name: "Weihnachten",
    start: at(35, 16),
    end: at(37, 22),
    frameIds: ["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"],
    pictureIds: pictures.filter((p) => p.albums.includes("Weihnachten")).map((p) => p.id),
    everyMin: 120,
    sameOnAll: false,
    state: "geplant",
  }

  const base = { upsideDown: false, tags: [] as string[], missedChanges: 0, justUpdated: null, own: [] as string[] }
  const ok = { level: "ok" as const, title: "Alles in Ordnung", text: "" }
  const daily = (time: string): Cadence => ({ everyMin: 1440, at: time })

  const frames: FrameRow[] = [
    {
      ...base,
      id: "f1",
      name: "Wohnzimmer links",
      device: "Frame 2",
      ip: "192.168.10.61",
      orientation: "hoch",
      groupId: "g-wohnen",
      power: "akku",
      charging: false,
      health: ok,
      battery: { percent: 78, at: at(0, 9, 0) },
      current: { pictureId: eventHoch[0], since: at(0, 9), unsure: false },
      nextChange: at(0, 10),
      lastOnline: { at: at(0, 9, 0), secondsAfterChange: 10 },
      cadence: confirmed(daily("07:00"), 9),
      cleaning: confirmed("06:50", 9),
      buffer: 3,
      queue: [eventHoch[2], eventHoch[4], eventHoch[6]],
      batteryLog: batteryLog(78, 1.1, null, false),
    },
    {
      ...base,
      id: "f2",
      name: "Wohnzimmer rechts",
      device: "Frame 3",
      ip: "192.168.10.62",
      orientation: "hoch",
      groupId: "g-wohnen",
      power: "akku",
      charging: false,
      health: ok,
      battery: { percent: 64, at: at(0, 9, 27) },
      current: { pictureId: eventHoch[1], since: at(0, 9), unsure: false },
      nextChange: at(0, 10),
      lastOnline: { at: at(0, 9, 27), secondsAfterChange: null },
      justUpdated: { at: at(0, 9, 27) },
      cadence: confirmed(daily("07:00"), 9),
      cleaning: confirmed("06:50", 9),
      buffer: 3,
      queue: [eventHoch[3], eventHoch[5], eventHoch[7]],
      batteryLog: batteryLog(64, 1.2, 11, false),
    },
    {
      ...base,
      id: "f3",
      name: "Esszimmer",
      device: "Frame 5",
      ip: "192.168.10.64",
      orientation: "quer",
      groupId: "g-wohnen",
      power: "dauerstrom",
      charging: false,
      health: ok,
      battery: null,
      current: { pictureId: eventQuer[0], since: at(0, 9), unsure: false },
      nextChange: at(0, 10),
      lastOnline: { at: at(0, 9, 29), secondsAfterChange: null },
      cadence: confirmed({ everyMin: 240, at: "07:00" }, 20),
      cleaning: confirmed("05:50", 20),
      buffer: 3,
      queue: [eventQuer[1], eventQuer[2], eventQuer[3]],
      batteryLog: [],
    },
    {
      ...base,
      id: "f4",
      name: "Flur",
      device: "Frame 1",
      ip: "192.168.10.60",
      orientation: "hoch",
      groupId: "g-flur",
      tags: ["Erdgeschoss"],
      power: "akku",
      charging: false,
      // The story of this frame, the same in every number below:
      // hourly since two days ago. Yesterday 23:07 a setting written after the pictures kept it awake
      // (light sleep, on the Wi-Fi). It went on changing and reporting until 03:00, when it got
      // its last three pictures (for 04:00, 05:00, 06:00). At 03:59 it was found awake at 4 %,
      // then it dropped off the Wi-Fi. It has not reported since: six changes missed (04:00 to 09:00),
      // and its pictures are used up since 06:00.
      health: {
        level: "bad",
        title: "6 Wechsel verpasst",
        text: "Der Rahmen hat sich seit 04:00 nach keinem Wechsel gemeldet. Sein Akku ist fast leer.",
      },
      battery: { percent: 4, at: at(0, 3, 59) },
      current: { pictureId: take("Familie", "hoch", 1, "familie1")[0], since: at(0, 6), unsure: true },
      nextChange: at(0, 10),
      lastOnline: { at: at(0, 3, 59), secondsAfterChange: null },
      missedChanges: 6,
      cadence: confirmed({ everyMin: 60, at: "06:00" }, 2),
      cleaning: confirmed("23:00", 1),
      buffer: 3,
      queue: [],
      story: {
        delivery: { sentAt: at(0, 3, 0), pictures: 3, endsAt: at(0, 6, 0), usedUp: true },
        changes: [
          ...[9, 8, 7, 6, 5, 4].map((h) => ({ at: at(0, h), onlineAfterSec: null, battery: null })),
          { at: at(0, 3), onlineAfterSec: 9, battery: 12 },
          { at: at(0, 2), onlineAfterSec: 11, battery: 21 },
        ],
        changeStats: { watched: 16, online: 10 },
        lightSleep: {
          since: at(-1, 23, 7),
          until: at(0, 3, 59),
          tries: [
            { at: at(-1, 23, 40), result: "Tiefschlaf-Befehl: keine Antwort" },
            { at: at(0, 0, 10), result: "Tiefschlaf-Befehl: keine Antwort" },
            { at: at(0, 3, 20), result: "Tiefschlaf-Befehl: keine Antwort" },
          ],
          gaveUp: true,
          batteryFrom: 46,
          batteryTo: 4,
        },
        deepSleepAttempt: { at: at(0, 3, 20), result: "Keine Antwort", ok: false },
        checks: {
          everyMin: 30,
          last: { at: at(0, 9, 21), awake: false },
          foundAwake: [{ at: at(0, 3, 59), battery: 4, charging: false, note: "in Ruhe gelassen, damit er von selbst einschläft" }],
        },
        deviceCheck: null,
        lastProblem: {
          at: at(0, 9, 0),
          text: "Wechsel um 09:00 verpasst: Rahmen unter 192.168.10.60 nicht erreichbar. Er ist im Tiefschlaf oder sein Akku ist leer. Er bekommt seine Bilder, sobald er sich das nächste Mal meldet: nach seinem nächsten Wechsel oder nach einem Druck auf den Knopf.",
        },
      },
      batteryLog: [
        { at: at(0, 3, 59), percent: 4, charging: false },
        { at: at(0, 3, 0), percent: 12, charging: false },
        { at: at(0, 0, 0), percent: 38, charging: false },
        { at: at(-1, 23, 0), percent: 46, charging: false },
        { at: at(-1, 6, 0), percent: 56, charging: false },
        { at: at(-2, 6, 0), percent: 71, charging: false },
        { at: at(-3, 6, 0), percent: 73, charging: false },
        { at: at(-4, 6, 0), percent: 74, charging: false },
        { at: at(-5, 6, 0), percent: 76, charging: false },
      ],
    },
    {
      ...base,
      id: "f5",
      name: "Treppe",
      device: "Frame 4",
      ip: "192.168.10.63",
      orientation: "hoch",
      groupId: "g-flur",
      power: "akku",
      charging: false,
      health: ok,
      battery: { percent: 52, at: at(-1, 6, 0) },
      current: { pictureId: take("Katzen", "hoch", 1, "katze1")[0], since: at(-1, 6), unsure: false },
      nextChange: at(1, 6),
      lastOnline: { at: at(-1, 6, 0), secondsAfterChange: 12 },
      cadence: confirmed({ everyMin: 2880, at: "06:00" }, 1),
      cleaning: confirmed("05:50", 12),
      buffer: 3,
      queue: [...take("Familie", "hoch", 2), ...take("Katzen", "hoch", 1)],
      batteryLog: batteryLog(52, 0.6, null, false),
    },
    {
      ...base,
      id: "f6",
      name: "Garderobe",
      device: "Frame 6",
      ip: "192.168.10.65",
      orientation: "quer",
      groupId: "g-flur",
      power: "akku",
      charging: true,
      health: { level: "ok", title: "Lädt gerade", text: "" },
      battery: { percent: 71, at: at(0, 9, 25) },
      current: { pictureId: take("Katzen", "quer", 1, "katze2")[0], since: at(0, 6, 30), unsure: false },
      nextChange: at(1, 6, 30),
      lastOnline: { at: at(0, 9, 25), secondsAfterChange: null },
      cadence: confirmed(daily("06:30"), 30),
      cleaning: confirmed("06:20", 30),
      buffer: 3,
      queue: take("Katzen", "quer", 3),
      batteryLog: batteryLog(71, 1.0, 0, true),
    },
    {
      ...base,
      id: "f7",
      name: "Schlafzimmer",
      device: "Frame 7",
      ip: "192.168.10.66",
      orientation: "hoch",
      groupId: "g-oben",
      power: "akku",
      charging: false,
      health: ok,
      battery: { percent: 88, at: at(0, 6, 30) },
      current: { pictureId: take("Urlaub", "hoch", 1, "leuchtturm")[0], since: at(0, 6, 30), unsure: false },
      nextChange: at(1, 6, 30),
      lastOnline: { at: at(0, 6, 30), secondsAfterChange: 11 },
      cadence: confirmed(daily("06:30"), 16),
      cleaning: confirmed("06:20", 16),
      buffer: 2,
      queue: take("Urlaub", "hoch", 2),
      batteryLog: batteryLog(88, 0.9, 6, false),
    },
    {
      ...base,
      id: "f8",
      name: "Arbeitszimmer",
      device: "Frame 8",
      ip: "192.168.10.67",
      orientation: "quer",
      groupId: "g-oben",
      power: "akku",
      charging: false,
      health: ok,
      battery: { percent: 46, at: at(0, 7, 0) },
      current: { pictureId: take("Urlaub", "quer", 1, "berge")[0], since: at(0, 7), unsure: false },
      nextChange: at(1, 7),
      lastOnline: { at: at(0, 7, 0), secondsAfterChange: 10 },
      cadence: confirmed(daily("07:00"), 40),
      cleaning: { value: "05:50", confirmedAt: null, deviceValue: "23:00" },
      buffer: 3,
      queue: take("Urlaub", "quer", 3),
      batteryLog: batteryLog(46, 1.0, null, false),
    },
  ]

  // Decks: every picture that fits a group's theme, shuffled once.
  const rand = rng(99)
  const decks: Db["decks"] = {}
  for (const g of groups) {
    for (const o of ["hoch", "quer"] as Orientation[]) {
      const ids = pictures
        .filter((p) => !p.paused && p.albums.some((a) => g.albums.includes(a)) && (p.orientation === o || p.alsoOther))
        .map((p) => ({ id: p.id, r: rand() }))
        .sort((a, b) => a.r - b.r)
        .map((x) => x.id)
      decks[`${g.id}/${o}`] = ids
    }
  }

  // Shown in the last days: these have had their turn in the current round.
  const shown: Db["shown"] = {}
  pictures
    .filter((p) => !used.has(p.id) && !p.paused && !p.albums.includes("Weihnachten"))
    .filter((_, i) => i % 4 === 1)
    .slice(0, 22)
    .forEach((p, i) => {
      const fit = frames.filter((f) => f.orientation === p.orientation)
      shown[p.id] = { frameId: (fit[i % fit.length] ?? frames[0]).id, at: at(-1 - (i % 9), 6 + (i % 3)) }
    })

  const toShow =
    decks["g-flur/hoch"].find((id) => !used.has(id) && !shown[id] && pictures.find((p) => p.id === id)?.art.motif === "katze3") ?? decks["g-flur/hoch"][0]
  const nextUp = decks["g-wohnen/hoch"].find((id) => !used.has(id) && !shown[id]) ?? decks["g-wohnen/hoch"][0]
  const forDining = decks["g-wohnen/quer"].find((id) => !used.has(id) && !shown[id]) ?? decks["g-wohnen/quer"][0]
  frames[3].own = [toShow]
  frames[0].own = [nextUp]
  frames[2].own = [forDining]
  const titleOf = (id: string) => pictures.find((p) => p.id === id)?.title ?? id

  const pending: PendingChange[] = [
    {
      id: "p1",
      frameId: "f4",
      kind: "zeigen-jetzt",
      title: `„${titleOf(toShow)}“ jetzt zeigen`,
      pictureIds: [toShow],
      state: "wartet",
      setAt: at(0, 8, 41),
      extraRedraw: true,
    },
    {
      id: "p2",
      frameId: "f4",
      kind: "reinigung",
      title: "Reinigung des Bildschirms",
      from: "23:00",
      to: "05:50",
      state: "wartet",
      setAt: at(0, 8, 43),
      extraRedraw: false,
    },
    {
      id: "p3",
      frameId: "f4",
      kind: "rhythmus",
      title: "Wechselrhythmus",
      from: "stündlich",
      to: "täglich um 06:00",
      state: "wartet",
      setAt: at(0, 8, 44),
      extraRedraw: false,
    },
    {
      id: "p4",
      frameId: "f1",
      kind: "zeigen-naechstes",
      title: `„${titleOf(nextUp)}“ als Nächstes zeigen`,
      pictureIds: [nextUp],
      state: "wartet",
      setAt: at(0, 9, 12),
      extraRedraw: false,
    },
    { id: "p5", frameId: "f1", kind: "vorrat", title: "Bilder auf Vorrat", from: "3", to: "4", state: "eingestellt", setAt: at(0, 9, 29), extraRedraw: false },
    {
      id: "p6",
      frameId: "f3",
      kind: "zeigen-naechstes",
      title: `„${titleOf(forDining)}“ als Nächstes zeigen`,
      pictureIds: [forDining],
      state: "uebertragen",
      setAt: at(0, 9, 29),
      sentAt: at(0, 9, 29),
      extraRedraw: false,
    },
    {
      id: "p7",
      frameId: "f5",
      kind: "rhythmus",
      title: "Wechselrhythmus",
      from: "täglich um 06:00",
      to: "alle 2 Tage um 06:00",
      state: "bestaetigt",
      setAt: at(-2, 20, 15),
      sentAt: at(-1, 6, 0),
      confirmedAt: at(-1, 6, 0),
      extraRedraw: false,
    },
    {
      id: "p8",
      frameId: "f8",
      kind: "reinigung",
      title: "Reinigung des Bildschirms",
      from: "23:00",
      to: "05:50",
      state: "abweichend",
      setAt: at(-1, 21, 2),
      sentAt: at(0, 7, 0),
      deviceValue: "23:00",
      extraRedraw: false,
    },
    {
      id: "p9",
      frameId: "f2",
      kind: "event",
      title: "Event „Geburtstag Mia“",
      to: "stündlich bis morgen 03:00",
      state: "bestaetigt",
      setAt: at(-1, 19, 30),
      sentAt: at(0, 7, 0),
      confirmedAt: at(0, 7, 0),
      extraRedraw: false,
    },
  ]
  // The changed values already count on the server; the frame still has the old ones.
  frames[3].cleaning = { value: "05:50", confirmedAt: null, deviceValue: "23:00" }
  frames[3].cadence = { value: { everyMin: 1440, at: "06:00" }, confirmedAt: null, deviceValue: { everyMin: 60, at: "06:00" } }

  const history: HistoryEntry[] = []
  let hid = 0
  const log = (t: number, frameId: string | null, kind: HistoryEntry["kind"], text: string, okFlag = true, extra: Partial<HistoryEntry> = {}) =>
    history.push({ id: `h${++hid}`, at: t, frameId, kind, text, ok: okFlag, ...extra })
  // What belongs to a pending change carries its id: setting, transfer and confirmation can be followed as one.
  log(at(0, 9, 29), "f3", "uebertragung", `„${titleOf(forDining)}“ als Nächstes zeigen`, true, {
    pictureId: forDining,
    change: { id: "p6", state: "uebertragen", how: "am Strom" },
  })
  log(at(0, 9, 29), "f3", "aenderung", `„${titleOf(forDining)}“ als Nächstes zeigen`, true, {
    pictureId: forDining,
    change: { id: "p6", state: "eingestellt" },
  })
  log(at(0, 9, 29), "f1", "aenderung", "Vorrat von 3 auf 4 Bilder", true, { change: { id: "p5", state: "eingestellt" } })
  log(at(0, 9, 27), "f2", "uebertragung", "3 Bilder übertragen (nach Knopfdruck)", true, { battery: 64 })
  log(at(0, 9, 25), "f6", "aenderung", "Hängt am Ladegerät: Änderungen gehen jetzt sofort raus", true, { battery: 71 })
  log(at(0, 9, 12), "f1", "aenderung", `„${titleOf(nextUp)}“ als Nächstes zeigen`, true, { pictureId: nextUp, change: { id: "p4", state: "eingestellt" } })
  log(at(0, 9, 0), "f1", "wechsel", "Bild gewechselt, 10 s später gemeldet", true, { battery: 78, pictureId: eventHoch[0] })
  log(at(0, 8, 44), "f4", "aenderung", "Wechselrhythmus von stündlich auf täglich um 06:00", true, { change: { id: "p3", state: "eingestellt" } })
  log(at(0, 8, 43), "f4", "aenderung", "Reinigungszeit von 23:00 auf 05:50", true, { change: { id: "p2", state: "eingestellt" } })
  log(at(0, 8, 41), "f4", "aenderung", `„${titleOf(toShow)}“ jetzt zeigen`, true, { pictureId: toShow, change: { id: "p1", state: "eingestellt" } })
  log(at(0, 8, 0), null, "event", "Event „Geburtstag Mia“ hat begonnen (Wohnbereich, stündlich)", true, { eventId: "e1" })
  log(at(0, 7, 40), null, "eingang", "7 neue Bilder aus dem Immich-Album „Katzen 2026“ im Eingang", true, { inbox: "neu" })
  log(at(0, 7, 0), "f8", "problem", "Reinigungszeit 05:50: der Rahmen meldet 23:00", false, { change: { id: "p8", state: "abweichend" } })
  log(at(0, 7, 0), "f8", "uebertragung", "Reinigungszeit 05:50", true, { battery: 46, change: { id: "p8", state: "uebertragen", how: "nach dem Wechsel" } })
  log(at(0, 7, 0), "f8", "wechsel", "Bild gewechselt, 10 s später gemeldet", true, { battery: 46 })
  log(at(0, 6, 30), "f7", "wechsel", "Bild gewechselt, 11 s später gemeldet", true, { battery: 88 })
  log(at(0, 6, 30), "f6", "wechsel", "Bild gewechselt, 9 s später gemeldet", true, { battery: 34 })
  for (const h of [9, 8, 7, 6, 5, 4]) log(at(0, h, 0), "f4", "problem", "Wechsel verpasst: der Rahmen hat sich nicht gemeldet", false)
  log(at(0, 3, 59), "f4", "problem", "Wach gefunden, Akku 4 %. In Ruhe gelassen, damit er wieder einschläft", false, { battery: 4 })
  log(at(0, 3, 0), "f4", "uebertragung", "Bild gewechselt und gemeldet. 3 Bilder übertragen, reichen bis heute 06:00", true, { battery: 12 })
  log(at(0, 2, 0), "f4", "wechsel", "Bild gewechselt, 11 s später gemeldet", true, { battery: 21 })
  log(at(0, 1, 0), "f4", "wechsel", "Bild gewechselt, 10 s später gemeldet", true, { battery: 29 })
  log(at(0, 0, 0), "f4", "wechsel", "Bild gewechselt, 9 s später gemeldet", true, { battery: 38 })
  log(at(-1, 23, 7), "f4", "problem", "Blieb nach einer Einstellung 7 s nach den Bildern wach: leichter Schlaf, hoher Verbrauch", false)
  log(at(-1, 23, 0), "f4", "wechsel", "Bild gewechselt, 10 s später gemeldet", true, { battery: 46 })
  log(at(-1, 21, 2), "f8", "aenderung", "Reinigungszeit von 23:00 auf 05:50", true, { change: { id: "p8", state: "eingestellt" } })
  log(at(-1, 19, 30), null, "event", "Event „Geburtstag Mia“ angelegt", true, { eventId: "e1" })
  log(at(-1, 18, 12), null, "eingang", "5 Bilder hochgeladen, im Eingang", true, { inbox: "neu" })
  log(at(-1, 6, 0), "f5", "aenderung", "Wechselrhythmus alle 2 Tage um 06:00", true, { battery: 52, change: { id: "p7", state: "bestaetigt" } })
  log(at(-1, 6, 0), "f5", "uebertragung", "Wechselrhythmus alle 2 Tage um 06:00", true, { change: { id: "p7", state: "uebertragen", how: "nach dem Wechsel" } })
  log(at(-1, 6, 0), "f5", "wechsel", "Bild gewechselt, 12 s später gemeldet", true, { battery: 52 })
  log(at(-2, 20, 15), "f5", "aenderung", "Wechselrhythmus von täglich um 06:00 auf alle 2 Tage um 06:00", true, { change: { id: "p7", state: "eingestellt" } })
  for (let d = 1; d <= 6; d++) {
    log(at(-d, 7, 0), "f1", "wechsel", "Bild gewechselt, 10 s später gemeldet", true, { battery: 78 + d })
    log(at(-d, 7, 0), "f2", "wechsel", "Bild gewechselt, 12 s später gemeldet", true, { battery: 64 + d })
    log(at(-d, 6, 30), "f7", "wechsel", "Bild gewechselt, 11 s später gemeldet", true, { battery: 88 + d })
  }
  history.sort((a, b) => b.at - a.at)

  // Eingang
  const dupA = pictures.find((p) => p.albums.includes("Katzen") && p.art.motif === "katze1")
  const dupB = pictures.find((p) => p.albums.includes("Urlaub") && p.art.motif === "meer")
  const inboxRaw: [string, string, number, Orientation, PictureSource, string, string[], InboxItem["hints"], string | null, [number, number]][] = [
    ["Felix auf dem Kratzbaum", "katze3", 5, "hoch", "immich", "Immich-Album „Katzen 2026“", ["Katzen"], [], null, [3024, 4032]],
    ["Minka gähnt", "katze1", 9, "hoch", "immich", "Immich-Album „Katzen 2026“", ["Katzen"], [], null, [3024, 4032]],
    [
      "Minka am Fenster",
      dupA?.art.motif ?? "katze1",
      dupA?.art.variant ?? 0,
      "hoch",
      "immich",
      "Immich-Album „Katzen 2026“",
      ["Katzen"],
      ["doppelt"],
      dupA?.id ?? null,
      [3024, 4032],
    ],
    ["Felix im Schnee", "katze2", 14, "quer", "immich", "Immich-Album „Katzen 2026“", ["Katzen"], [], null, [4032, 3024]],
    ["Pfoten", "katze2", 2, "quer", "immich", "Immich-Album „Katzen 2026“", ["Katzen"], ["unscharf"], null, [4032, 3024]],
    ["Minka schaut hoch", "katze1", 17, "hoch", "immich", "Immich-Album „Katzen 2026“", ["Katzen"], [], null, [2268, 4032]],
    ["Felix und der Karton", "katze3", 20, "quer", "immich", "Immich-Album „Katzen 2026“", ["Katzen"], [], null, [4032, 2268]],
    ["Herbstspaziergang", "familie2", 6, "hoch", "upload", "Hochgeladen", ["Familie"], [], null, [3024, 4032]],
    ["Kürbisse schnitzen", "familie3", 11, "quer", "upload", "Hochgeladen", ["Familie"], [], null, [4032, 3024]],
    [
      "Strand bei Zingst",
      dupB?.art.motif ?? "meer",
      dupB?.art.variant ?? 0,
      "quer",
      "upload",
      "Hochgeladen",
      ["Urlaub"],
      ["doppelt"],
      dupB?.id ?? null,
      [4032, 3024],
    ],
    ["Altes Familienfoto", "familie4", 3, "hoch", "upload", "Hochgeladen", ["Familie"], ["zu-klein"], null, [640, 960]],
    ["Bildschirmfoto Hafen", "meer", 8, "quer", "upload", "Hochgeladen", [], ["zu-klein"], null, [1136, 640]],
  ]
  const inbox: InboxItem[] = inboxRaw.map(([title, motif, variant, orientation, source, sourceNote, albums, hints, duplicateOf, [width, height]], i) => ({
    id: `n${i + 1}`,
    title,
    art: { motif, variant },
    width,
    height,
    orientation,
    source,
    sourceNote,
    receivedAt: source === "immich" ? at(0, 7, 40) : at(-1, 18, 12),
    albums,
    hints,
    duplicateOf,
  }))

  // Immich
  const people = [
    { id: "pe1", name: "Mia" },
    { id: "pe2", name: "Jonas" },
    { id: "pe3", name: "Oma Helga" },
    { id: "pe4", name: "Opa Karl" },
  ]
  const iRand = rng(31)
  const immichAlbums = [
    { id: "ia1", name: "Katzen 2026", subscribed: true, lastSync: at(0, 7, 40), motifs: ["katze1", "katze2", "katze3"] },
    { id: "ia2", name: "Urlaub Ostsee", subscribed: false, lastSync: null, motifs: ["meer", "leuchtturm"] },
    { id: "ia3", name: "Wandern in Tirol", subscribed: false, lastSync: null, motifs: ["berge"] },
    { id: "ia4", name: "Weihnachten 2025", subscribed: false, lastSync: null, motifs: ["baum", "kerze"] },
    { id: "ia5", name: "Familie", subscribed: false, lastSync: null, motifs: ["familie1", "familie2", "familie3", "familie4", "familie5", "kuchen"] },
  ]
  const names: Record<string, string> = {
    katze1: "Katze sitzt",
    katze2: "Katze liegt",
    katze3: "Katze am Fenster",
    meer: "Segelboot am Strand",
    leuchtturm: "Leuchtturm an der Küste",
    berge: "Berge mit Sonne",
    baum: "Weihnachtsbaum",
    kerze: "Kerze im Advent",
    kuchen: "Geburtstagskuchen",
    familie1: "Familie draußen",
    familie2: "Kinder mit Ballon",
    familie3: "Am Tisch",
    familie4: "Zwei Gesichter",
    familie5: "Drei am Wasser",
  }
  const assets: ImmichAsset[] = []
  immichAlbums.forEach((album) => {
    for (let i = 0; i < 14; i++) {
      const motif = album.motifs[i % album.motifs.length]
      const hoch = iRand() < 0.55
      const withPeople = motif.startsWith("familie") || motif === "kuchen"
      assets.push({
        id: `${album.id}-${i}`,
        title: names[motif] ?? motif,
        art: { motif, variant: Math.floor(iRand() * 24) },
        width: hoch ? 3024 : 4032,
        height: hoch ? 4032 : 3024,
        takenAt: at(-Math.floor(iRand() * 700) - 2, 12, 0),
        album: album.name,
        favorite: iRand() < 0.25,
        people: withPeople ? people.filter(() => iRand() < 0.45).map((p) => p.id) : [],
        imported: album.id === "ia1" && i < 7,
      })
    }
  })

  return {
    frames,
    groups,
    pictures,
    inbox,
    discarded: [],
    decks,
    shown,
    pending,
    events: [geburtstag, weihnachten],
    history,
    settings: { autoAccept: false, extras: { generate: false, art: false } },
    keys: [
      {
        id: "immich",
        name: "Immich",
        purpose: "Bilder aus deiner Immich-Bibliothek holen und Alben abonnieren",
        source: "infisical",
        saved: true,
        status: "funktioniert",
        statusNote: "Immich 3.4.2 antwortet, Alben und Personen lesbar",
        testedAt: at(0, 6, 0),
        later: false,
      },
      {
        id: "openrouter",
        name: "OpenRouter",
        purpose: "Für spätere KI-Funktionen, zum Beispiel Bilder im Stil eines Gemäldes",
        source: null,
        saved: false,
        status: "fehlt",
        statusNote: "Noch kein Schlüssel hinterlegt",
        testedAt: null,
        later: true,
      },
    ],
    immich: { assets, people, albums: immichAlbums.map(({ motifs: _m, ...a }) => a) },
  }
}

export const COST_PER_CHANGE = 0.6 // battery percent points per picture build-up
export const COST_PER_DAY = 0.25 // battery percent points per day asleep
export { DAY, HOUR, MINUTE }
