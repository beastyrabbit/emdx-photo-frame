import { lazy, Suspense } from "react"
import { createBrowserRouter, createHashRouter, RouterProvider } from "react-router"
import { AppShell } from "./components/app-shell"
import { TooltipProvider } from "./components/ui/tooltip"

const AccessKeysScreen = lazy(() => import("./screens/access-keys").then((module) => ({ default: module.AccessKeysScreen })))
const AddFrameScreen = lazy(() => import("./screens/add-frame").then((module) => ({ default: module.AddFrameScreen })))
const ArtScreen = lazy(() => import("./screens/art").then((module) => ({ default: module.ArtScreen })))
const CombineScreen = lazy(() => import("./screens/combine").then((module) => ({ default: module.CombineScreen })))
const EventEditScreen = lazy(() => import("./screens/events").then((module) => ({ default: module.EventEditScreen })))
const EventsScreen = lazy(() => import("./screens/events").then((module) => ({ default: module.EventsScreen })))
const FrameDetailScreen = lazy(() => import("./screens/frame-detail").then((module) => ({ default: module.FrameDetailScreen })))
const FrameSettingsScreen = lazy(() => import("./screens/frame-settings").then((module) => ({ default: module.FrameSettingsScreen })))
const GroupDetailScreen = lazy(() => import("./screens/groups").then((module) => ({ default: module.GroupDetailScreen })))
const GroupsScreen = lazy(() => import("./screens/groups").then((module) => ({ default: module.GroupsScreen })))
const HelpScreen = lazy(() => import("./screens/help").then((module) => ({ default: module.HelpScreen })))
const HistoryScreen = lazy(() => import("./screens/history").then((module) => ({ default: module.HistoryScreen })))
const ImmichScreen = lazy(() => import("./screens/immich").then((module) => ({ default: module.ImmichScreen })))
const LibraryScreen = lazy(() => import("./screens/library").then((module) => ({ default: module.LibraryScreen })))
const OverviewScreen = lazy(() => import("./screens/overview").then((module) => ({ default: module.OverviewScreen })))
const PictureEditScreen = lazy(() => import("./screens/picture-edit").then((module) => ({ default: module.PictureEditScreen })))
const ScheduleScreen = lazy(() => import("./screens/schedule").then((module) => ({ default: module.ScheduleScreen })))
const SettingsScreen = lazy(() => import("./screens/settings").then((module) => ({ default: module.SettingsScreen })))

// The addresses are German on purpose: they show up in the address bar and in shared links.
// VITE_HASH_ROUTER=1 builds a static preview that works from any path (addresses after "#").
const createRouter = import.meta.env.VITE_HASH_ROUTER === "1" ? createHashRouter : createBrowserRouter
const router = createRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <OverviewScreen /> },
      { path: "/rahmen/:id", element: <FrameDetailScreen /> },
      { path: "/bibliothek", element: <LibraryScreen /> },
      { path: "/bild/:id", element: <PictureEditScreen /> },
      { path: "/kombinieren", element: <CombineScreen /> },
      { path: "/immich", element: <ImmichScreen /> },
      { path: "/kunst", element: <ArtScreen /> },
      { path: "/zeitplan", element: <ScheduleScreen /> },
      { path: "/events", element: <EventsScreen /> },
      { path: "/events/:id", element: <EventEditScreen /> },
      { path: "/gruppen", element: <GroupsScreen /> },
      { path: "/gruppen/:id", element: <GroupDetailScreen /> },
      { path: "/einstellungen", element: <SettingsScreen /> },
      { path: "/einstellungen/zugaenge", element: <AccessKeysScreen /> },
      { path: "/einstellungen/rahmen-neu", element: <AddFrameScreen /> },
      { path: "/einstellungen/rahmen/:id", element: <FrameSettingsScreen /> },
      { path: "/verlauf", element: <HistoryScreen /> },
      { path: "/hilfe", element: <HelpScreen /> },
      { path: "*", element: <OverviewScreen /> },
    ],
  },
])

export function App() {
  return (
    <TooltipProvider>
      <Suspense fallback={<p className="p-6">Wird geladen…</p>}>
        <RouterProvider router={router} />
      </Suspense>
    </TooltipProvider>
  )
}
