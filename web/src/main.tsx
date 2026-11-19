import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import "./lib/theme"
import { App } from "./App"
import { Toaster } from "./components/ui/sonner"

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 2000, refetchOnWindowFocus: true, retry: 1 } },
})

const root = document.getElementById("root")
if (!root) throw new Error("#root fehlt in index.html")

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
)
