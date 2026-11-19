import { createBrowserRouter, createHashRouter, RouterProvider } from "react-router"
import { AppShell } from "./components/app-shell"
import { TooltipProvider } from "./components/ui/tooltip"
import { AccessKeysScreen } from "./screens/access-keys"
import { AddFrameScreen } from "./screens/add-frame"
import { ArtScreen } from "./screens/art"
import { CombineScreen } from "./screens/combine"
import { EventEditScreen, EventsScreen } from "./screens/events"
import { FrameDetailScreen } from "./screens/frame-detail"
import { FrameSettingsScreen } from "./screens/frame-settings"
import { GroupDetailScreen, GroupsScreen } from "./screens/groups"
import { HelpScreen } from "./screens/help"
import { HistoryScreen } from "./screens/history"
import { ImmichScreen } from "./screens/immich"
import { LibraryScreen } from "./screens/library"
import { OverviewScreen } from "./screens/overview"
import { PictureEditScreen } from "./screens/picture-edit"
import { ScheduleScreen } from "./screens/schedule"
import { SettingsScreen } from "./screens/settings"

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
      <RouterProvider router={router} />
    </TooltipProvider>
  )
}
