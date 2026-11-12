import { QueryClient } from "@tanstack/react-query"
import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { routeTree } from "./routeTree.gen"

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  })
  return createTanStackRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  })
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
