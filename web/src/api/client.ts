import type {
  AccessKey,
  ArtPage,
  ArtQuery,
  ComboLayout,
  ConnectionTest,
  Crop,
  Deck,
  DiscardedItem,
  EventDraft,
  EventEstimate,
  FrameDetail,
  FrameEvent,
  FrameSettingsPatch,
  Group,
  HistoryEntry,
  HouseSettings,
  ImmichPage,
  ImmichQuery,
  ImmichStatus,
  InboxEdit,
  InboxItem,
  NewFrame,
  Orientation,
  Overview,
  PendingChange,
  PhotoQuery,
  Picture,
  PowerMode,
  ShowPlan,
  ShowRequest,
  TimelineItem,
} from "./types"

/**
 * The seam between the interface and the backend.
 * The interface only ever talks to this. `mock/` implements it in memory;
 * the real backend replaces it method by method (see README).
 */
export interface PhotoFrameApi {
  // frames
  getOverview(): Promise<Overview>
  getFrame(id: string): Promise<FrameDetail>
  updateFrame(id: string, patch: FrameSettingsPatch): Promise<void>
  frameAction(id: string, action: FrameAction): Promise<void>
  addFrame(frame: NewFrame): Promise<{ id: string }>
  testConnection(ip: string, power: PowerMode, pin?: string | null): Promise<ConnectionTest>
  removeFrame(id: string): Promise<void>

  // pending changes
  listPending(frameId?: string): Promise<PendingChange[]>
  withdrawPending(id: string): Promise<void>
  /** For a change the frame answered differently: send our value again, or keep the frame's. */
  resolvePending(id: string, keep: "unser" | "rahmen"): Promise<void>

  // groups and decks
  listGroups(): Promise<Group[]>
  saveGroup(group: Omit<Group, "id"> & { id?: string }): Promise<{ id: string }>
  getDeck(groupId: string, orientation: Orientation): Promise<Deck>
  moveDeckCard(groupId: string, orientation: Orientation, pictureId: string, toIndex: number): Promise<void>
  getTimeline(frameId: string): Promise<TimelineItem[]>
  moveTimelineItem(frameId: string, pictureId: string, toIndex: number): Promise<void>

  // pictures
  listPictures(): Promise<Picture[]>
  getPicture(id: string): Promise<Picture>
  listAlbums(): Promise<{ name: string; count: number }[]>
  updatePicture(id: string, patch: PicturePatch): Promise<void>
  deletePicture(id: string): Promise<void>
  createCombo(layout: ComboLayout, memberIds: string[]): Promise<{ id: string }>
  planShow(request: ShowRequest): Promise<ShowPlan>
  show(request: ShowRequest): Promise<ShowPlan>

  // Eingang
  listInbox(): Promise<InboxItem[]>
  /** `edits`: format and crop chosen in the Eingang, per item id. They stay with the picture. */
  acceptInbox(ids: string[], edits?: Record<string, InboxEdit>): Promise<{ withoutGroup: number }>
  /** Discarded pictures are kept for a while (see `DiscardedItem.keptUntil`) and can be restored. */
  discardInbox(ids: string[]): Promise<void>
  listDiscarded(): Promise<DiscardedItem[]>
  /** Puts discarded pictures back into the Eingang. */
  restoreInbox(ids: string[]): Promise<void>

  // Events
  listEvents(): Promise<FrameEvent[]>
  estimateEvent(draft: EventDraft): Promise<EventEstimate>
  saveEvent(draft: EventDraft): Promise<{ id: string }>
  endEvent(id: string): Promise<void>
  deleteEvent(id: string): Promise<void>

  // Immich
  getImmich(): Promise<ImmichStatus>
  searchImmich(query: ImmichQuery): Promise<ImmichPage>
  importFromImmich(assetIds: string[], albums?: string[]): Promise<void>
  subscribeAlbum(albumId: string, on: boolean): Promise<void>

  // art catalogue (only used while `HouseSettings.extras.art` is on)
  searchArt(query: ArtQuery): Promise<ArtPage>
  /** Copies works into the Eingang, like `importFromImmich`. */
  importArt(workIds: string[]): Promise<void>
  /** CC0 photos from the WordPress Photo Directory, on the same screen as the art. */
  searchPhotos(query: PhotoQuery): Promise<ArtPage>
  importPhotos(photoIds: string[]): Promise<void>

  // settings
  getSettings(): Promise<HouseSettings>
  updateSettings(patch: Partial<HouseSettings>): Promise<void>
  listKeys(): Promise<AccessKey[]>
  /** Write-only: the key can be replaced or removed, never read back. */
  saveKey(id: AccessKey["id"], key: string): Promise<void>
  removeKey(id: AccessKey["id"]): Promise<void>
  testKey(id: AccessKey["id"]): Promise<AccessKey>

  // history
  listHistory(frameId?: string): Promise<HistoryEntry[]>
}

export type FrameAction = "erkennungsbild" | "testbild" | "pruefen" | "tiefschlaf" | "neu-senden"

export interface PicturePatch {
  title?: string
  albums?: string[]
  paused?: boolean
  orientation?: Orientation
  alsoOther?: boolean
  crop?: { orientation: Orientation; crop: Crop }
}

/** Only the mock has these: they stand in for things that happen at the frame. */
export interface PrototypeControls {
  pressButton(frameId: string): Promise<void>
}
