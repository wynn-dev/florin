import { QueryClientProvider } from "@tanstack/react-query"
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { getCookie } from "@tanstack/react-start/server"
import type { QueryClient } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { setLocale, setTimeZone } from "@/lib/format"
import { themeScript } from "@/lib/theme"
import { effectiveTimeZone, getSettings } from "@/server/data"
import appCss from "../styles.css?url"

/**
 * What the first render needs before any query runs: the locale every amount
 * and date is formatted in and the time zone "today" is in (the same on the
 * server and in the browser, so the server's HTML matches), and whether the
 * sidebar was left collapsed.
 */
const getPreferences = createServerFn({ method: "GET" }).handler(() => {
  const locale = getSettings().locale || "en-GB"
  const timeZone = effectiveTimeZone()
  setLocale(locale)
  setTimeZone(timeZone)
  return {
    locale,
    timeZone,
    sidebarOpen: getCookie("sidebar_state") !== "false",
  }
})

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    loader: () => getPreferences(),
    // Loaded once; Settings invalidates the router when the locale changes.
    shouldReload: false,
    head: () => ({
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "florin" },
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      ],
    }),
    notFoundComponent: () => (
      <main className="grid min-h-svh place-items-center text-sm text-muted-foreground">
        Page not found
      </main>
    ),
    shellComponent: RootDocument,
    component: Root,
  }
)

function Root() {
  const { queryClient } = Route.useRouteContext()
  const { locale, timeZone } = Route.useLoaderData()
  setLocale(locale)
  setTimeZone(timeZone)
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {/* A new locale re-renders every page's figures from scratch. */}
        <Outlet key={`${locale} ${timeZone}`} />
        <Toaster position="bottom-center" />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <HeadContent />
      </head>
      <body className="antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  )
}
