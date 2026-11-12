import { createFileRoute } from "@tanstack/react-router"
import { completeLink, psuHeaders } from "@/server/enablebanking"

/** Where Enable Banking sends the browser back after the bank; register this path on the application. */
export const Route = createFileRoute("/connect/enable-banking/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let location: string
        try {
          location = await completeLink(
            new URL(request.url).searchParams,
            psuHeaders(request)
          )
        } catch (error) {
          console.error("florin: finishing a bank link failed:", error)
          location =
            "/accounts?linkError=" +
            encodeURIComponent(
              "Something went wrong finishing the bank link. Try again."
            )
        }
        return new Response(null, { status: 302, headers: { location } })
      },
    },
  },
})
