import { cn } from "cn"
import { CalendarRange, CircleHelp, Frame, GalleryVerticalEnd, History, Images, Palette, SlidersHorizontal } from "lucide-react"
import { NavLink, Outlet, ScrollRestoration } from "react-router"
import { useOverview, useSettings } from "@/api/hooks"

interface Item {
  to: string
  label: string
  short?: string
  icon: React.ComponentType<{ className?: string }>
  end?: boolean
  /** Only on wide screens: on the phone the item is under "Mehr" instead, the tab bar stays at five. */
  wideOnly?: boolean
}
const ART: Item = { to: "/kunst", label: "Kunst", icon: Palette, wideOnly: true }
const MAIN: Item[] = [
  { to: "/", label: "Übersicht", icon: Frame, end: true },
  { to: "/bibliothek", label: "Bibliothek", icon: Images },
  { to: "/zeitplan", label: "Zeitplan", icon: CalendarRange },
  { to: "/gruppen", label: "Gruppen", icon: GalleryVerticalEnd },
  { to: "/einstellungen", label: "Einstellungen", short: "Mehr", icon: SlidersHorizontal },
]
const MORE = [
  { to: "/verlauf", label: "Verlauf", icon: History },
  { to: "/hilfe", label: "So funktioniert's", icon: CircleHelp },
]

function Dot({ count }: { count: number }) {
  if (!count) return null
  return (
    <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-blue px-1 text-[11px] leading-none font-bold text-on-blue">
      {count}
      <span className="sr-only"> neu im Eingang</span>
    </span>
  )
}

/** Bottom tab bar on the phone, a rail on the left from 900 px. */
export function AppShell() {
  const { data } = useOverview()
  const inbox = data?.inboxCount ?? 0
  // "Kunst" is there only while the art catalogue is switched on in the settings.
  const art = useSettings().data?.extras.art ?? false
  const main = art ? [...MAIN.slice(0, 2), ART, ...MAIN.slice(2)] : MAIN
  return (
    <div className="min-h-dvh min-[900px]:pl-[216px]">
      <nav
        aria-label="Bereiche"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] min-[900px]:inset-y-0 min-[900px]:right-auto min-[900px]:w-[216px] min-[900px]:flex-col min-[900px]:gap-0.5 min-[900px]:border-t-0 min-[900px]:border-r min-[900px]:px-3 min-[900px]:py-6"
      >
        <div className="hidden px-3 pb-6 text-lead font-semibold min-[900px]:block">Bilderrahmen</div>
        {main.map(({ to, label, short, icon: Icon, end, wideOnly }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "relative grid min-h-14 flex-1 justify-items-center gap-0.5 px-0.5 pt-2 pb-1.5 text-[12px] text-ink-soft no-underline min-[900px]:flex min-[900px]:min-h-11 min-[900px]:flex-none min-[900px]:items-center min-[900px]:gap-3 min-[900px]:rounded-control min-[900px]:px-3 min-[900px]:py-0 min-[900px]:text-body",
                isActive && "font-semibold text-ink min-[900px]:bg-sunken",
                wideOnly && "max-[899px]:hidden",
              )
            }
          >
            <span className="relative">
              <Icon className="size-[22px]" aria-hidden />
              {to === "/bibliothek" && (
                <span className="absolute -top-1.5 -right-3 min-[900px]:hidden">
                  <Dot count={inbox} />
                </span>
              )}
            </span>
            <span className="min-[900px]:hidden">{short ?? label}</span>
            <span className="hidden min-[900px]:inline">{label}</span>
            {to === "/bibliothek" && (
              <span className="ml-auto hidden min-[900px]:block">
                <Dot count={inbox} />
              </span>
            )}
          </NavLink>
        ))}
        <div className="mt-4 hidden border-t border-line pt-4 min-[900px]:grid min-[900px]:gap-0.5">
          {MORE.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn("flex min-h-11 items-center gap-3 rounded-control px-3 text-ink-soft no-underline", isActive && "bg-sunken font-semibold text-ink")
              }
            >
              <Icon className="size-[22px]" aria-hidden />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main
        tabIndex={-1}
        className="outline-none mx-auto grid max-w-[720px] gap-8 px-4 pt-6 pb-28 min-[900px]:px-8 min-[900px]:pt-8 min-[900px]:pb-16 [&:has([data-wide])]:max-w-[1120px] [&>*]:min-w-0"
      >
        <Outlet />
      </main>
      <ScrollRestoration />
    </div>
  )
}
