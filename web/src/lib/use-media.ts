import { useSyncExternalStore } from "react"

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query)
      m.addEventListener("change", onChange)
      return () => m.removeEventListener("change", onChange)
    },
    () => window.matchMedia(query).matches,
  )
}

/** From this width the app shows the side rail and dialogs instead of bottom sheets. */
export const useWide = () => useMedia("(min-width: 900px)")
