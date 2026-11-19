import type { PhotoFrameApi } from "./client"
import type { ImmichAsset } from "./types"

let csrf: Promise<string> | undefined
async function token() {
  csrf ??= fetch("/api/v1/bootstrap", { credentials: "same-origin" })
    .then(async (response) => {
      if (!response.ok) throw new Error("Verbindung zum Dienst fehlt")
      return (await response.json()).csrf as string
    })
    .catch((error) => {
      csrf = undefined
      throw error
    })
  return csrf
}
async function decode<T>(response: Response): Promise<T> {
  const result = await response.json()
  if (!response.ok) {
    if (response.status === 403) csrf = undefined
    throw new Error(result.error || "Anfrage fehlgeschlagen")
  }
  return result as T
}
async function call<T>(name: string, args: unknown[], write = false): Promise<T> {
  const headers: Record<string, string> = {}
  if (write) {
    headers["Content-Type"] = "application/json"
    headers["X-CSRF-Token"] = await token()
  }
  const url = `/api/v1/call/${name}${write ? "" : `?args=${encodeURIComponent(JSON.stringify(args))}`}`
  return decode<T>(await fetch(url, { method: write ? "POST" : "GET", headers, credentials: "same-origin", ...(write ? { body: JSON.stringify(args) } : {}) }))
}

export const httpApi: PhotoFrameApi = {
  getOverview: () => call("getOverview", []),
  getFrame: (id) => call("getFrame", [id]),
  updateFrame: (id, patch) => call("updateFrame", [id, patch], true),
  frameAction: (id, action) => call("frameAction", [id, action], true),
  addFrame: (frame) => call("addFrame", [frame], true),
  testConnection: (ip, power, pin = null) => call("testConnection", [ip, power, pin], true),
  removeFrame: (id) => call("removeFrame", [id], true),
  listPending: (id) => call("listPending", [id]),
  withdrawPending: (id) => call("withdrawPending", [id], true),
  resolvePending: (id, keep) => call("resolvePending", [id, keep], true),
  listGroups: () => call("listGroups", []),
  saveGroup: (group) => call("saveGroup", [group], true),
  getDeck: (group, orientation) => call("getDeck", [group, orientation]),
  moveDeckCard: (...args) => call("moveDeckCard", args, true),
  getTimeline: (id) => call("getTimeline", [id]),
  moveTimelineItem: (...args) => call("moveTimelineItem", args, true),
  listPictures: () => call("listPictures", []),
  getPicture: (id) => call("getPicture", [id]),
  listAlbums: () => call("listAlbums", []),
  updatePicture: (...args) => call("updatePicture", args, true),
  deletePicture: (id) => call("deletePicture", [id], true),
  createCombo: (...args) => call("createCombo", args, true),
  planShow: (request) => call("planShow", [request]),
  show: (request) => call("show", [request], true),
  listInbox: () => call("listInbox", []),
  acceptInbox: (...args) => call("acceptInbox", args, true),
  discardInbox: (ids) => call("discardInbox", [ids], true),
  listDiscarded: () => call("listDiscarded", []),
  restoreInbox: (ids) => call("restoreInbox", [ids], true),
  listEvents: () => call("listEvents", []),
  estimateEvent: (draft) => call("estimateEvent", [draft]),
  saveEvent: (draft) => call("saveEvent", [draft], true),
  endEvent: (id) => call("endEvent", [id], true),
  deleteEvent: (id) => call("deleteEvent", [id], true),
  getImmich: () => call("getImmich", []),
  searchImmich: async (query) => {
    const items: ImmichAsset[] = []
    let cursor: string | null = null
    const seen = new Set<string>()
    do {
      const page: { items: ImmichAsset[]; nextCursor: string | null } = await call("searchImmich", [{ ...query, cursor }])
      items.push(...page.items)
      cursor = page.nextCursor
      if (cursor && seen.has(cursor)) throw new Error("Immich hat eine Seite wiederholt")
      if (cursor) seen.add(cursor)
    } while (cursor && seen.size < 100)
    return items
  },
  importFromImmich: (ids, albums = []) => call("importFromImmich", [ids, albums], true),
  subscribeAlbum: (...args) => call("subscribeAlbum", args, true),
  searchArt: (query) => call("searchArt", [query]),
  importArt: (ids) => call("importArt", [ids], true),
  getSettings: () => call("getSettings", []),
  updateSettings: (patch) => call("updateSettings", [patch], true),
  listKeys: () => call("listKeys", []),
  saveKey: (...args) => call("saveKey", args, true),
  removeKey: (id) => call("removeKey", [id], true),
  testKey: (id) => call("testKey", [id], true),
  listHistory: (id) => call("listHistory", [id]),
}

export async function uploadPictures(files: File[]): Promise<{ results: { name: string; id?: string; error?: string }[] }> {
  const form = new FormData()
  for (const file of Array.from(files)) form.append("files", file)
  return decode(await fetch("/api/v1/uploads", { method: "POST", credentials: "same-origin", headers: { "X-CSRF-Token": await token() }, body: form }))
}
