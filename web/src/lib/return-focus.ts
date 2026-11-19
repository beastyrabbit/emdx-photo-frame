// Dialogs and sheets here are opened from state, without a Radix trigger. Radix then has nowhere
// to put the focus when one closes, and it falls back to <body>. This remembers what the owner last
// used outside any dialog and hands the focus back to it.

// Dialogs, sheets, menus and lists of options are drawn outside the page (in a portal): nothing in them is a way back.
const PAGE = "#root"
const FOCUSABLE = "button, a[href], input, select, textarea, [tabindex]"
let last: HTMLElement | null = null

function remember(event: Event) {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>(FOCUSABLE) : null
  if (target?.closest(PAGE)) last = target
}

if (typeof document !== "undefined") {
  document.addEventListener("focusin", remember, true)
  // Safari does not focus a button on click, so the press itself counts too.
  document.addEventListener("pointerdown", remember, true)
}

/** For `onCloseAutoFocus`: back to where the owner came from, or to the page if that is gone. */
export function returnFocus(event: Event) {
  event.preventDefault()
  const usable = last?.isConnected && !last.hasAttribute("disabled")
  const target = usable ? last : document.querySelector<HTMLElement>("main")
  target?.focus()
}
