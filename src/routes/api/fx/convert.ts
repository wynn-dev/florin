import { createFileRoute } from "@tanstack/react-router"
import { checkCurrency, convert, InvalidInput } from "@/server/data"
import { checkDate } from "@/server/data/validate"
import { optionalInt, query, respond } from "@/server/http"

/**
 * ?amount=<minor units>&from=EUR&to=USD&date=2026-11-12: the amount at that
 * day's ECB rates (the latest earlier rate when the day has none), or null
 * when a rate is missing. Prefills what a transfer between currencies receives.
 */
export const Route = createFileRoute("/api/fx/convert")({
  server: {
    handlers: {
      GET: ({ request }) =>
        respond(() => {
          const q = query(request)
          const amount = optionalInt(q.amount)
          if (amount === undefined) throw new InvalidInput("amount is required")
          return {
            amount: convert(
              amount,
              checkCurrency(q.from, "from"),
              checkCurrency(q.to, "to"),
              checkDate(q.date)
            ),
          }
        }),
    },
  },
})
