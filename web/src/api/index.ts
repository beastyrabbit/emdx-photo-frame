import type { PhotoFrameApi, PrototypeControls } from "./client"
import { mockApi, mockControls } from "./mock"

/**
 * The one place that decides where data comes from.
 * To connect the real backend, build an object with the same methods
 * (for example in `./http.ts`) and export it here instead of `mockApi`.
 * Methods can move over one at a time: `{ ...mockApi, getOverview: http.getOverview }`.
 */
export const api: PhotoFrameApi = mockApi

/** Stand-ins for things that happen at a frame. `null` once the real backend is connected. */
export const prototype: PrototypeControls | null = mockControls

export type { FrameAction, PhotoFrameApi, PicturePatch } from "./client"
export type * from "./types"
