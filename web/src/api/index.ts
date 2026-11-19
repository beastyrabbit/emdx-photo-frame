import type { PhotoFrameApi, PrototypeControls } from "./client"
import { httpApi } from "./http"

/**
 * The one place that decides where data comes from.
 * Production uses HTTP. VITE_API=mock keeps the approved prototype available locally.
 */
const mock = import.meta.env.VITE_API === "mock" ? await import("./mock") : null
export const api: PhotoFrameApi = mock?.mockApi ?? httpApi

/** Stand-ins for things that happen at a frame. `null` once the real backend is connected. */
export const prototype: PrototypeControls | null = mock?.mockControls ?? null

export type { FrameAction, PhotoFrameApi, PicturePatch } from "./client"
export type * from "./types"
