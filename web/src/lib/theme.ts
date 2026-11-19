import { useSyncExternalStore } from "react"

export type Theme = "system" | "hell" | "dunkel"
const KEY = "bilderrahmen-darstellung"
const listeners = new Set<() => void>()
const media = window.matchMedia("(prefers-color-scheme: dark)")

function read(): Theme {
  // ?darstellung=dunkel in the address wins, handy for screenshots.
  const fromUrl = new URLSearchParams(window.location.search).get("darstellung")
  if (fromUrl === "hell" || fromUrl === "dunkel") return fromUrl
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === "hell" || saved === "dunkel") return saved
  } catch {
    // no storage: follow the system
  }
  return "system"
}

let current = read()

function apply() {
  const dark = current === "dunkel" || (current === "system" && media.matches)
  document.documentElement.classList.toggle("dark", dark)
}

media.addEventListener("change", apply)
apply()

export function setTheme(theme: Theme) {
  current = theme
  try {
    if (theme === "system") localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, theme)
  } catch {
    // no storage: the choice lasts until the page is closed
  }
  apply()
  for (const l of listeners) l()
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}

export const isDark = () => document.documentElement.classList.contains("dark")
