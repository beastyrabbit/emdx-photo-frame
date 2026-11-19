import { useMemo } from "react"
import { useOverview, usePictures } from "./hooks"
import type { Frame, Picture } from "./types"

/** Pictures by id, for lists that only carry ids. */
export function usePictureMap(): Map<string, Picture> {
  const { data } = usePictures()
  return useMemo(() => new Map((data ?? []).map((p) => [p.id, p])), [data])
}

export function useFrameMap(): Map<string, Frame> {
  const { data } = useOverview()
  return useMemo(() => new Map((data?.frames ?? []).map((f) => [f.id, f])), [data])
}
