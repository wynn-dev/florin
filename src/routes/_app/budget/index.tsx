import { createFileRoute, redirect } from "@tanstack/react-router"
import { currentMonth } from "@/lib/format"

/** /budget opens this month. */
export const Route = createFileRoute("/_app/budget/")({
  beforeLoad: () => {
    throw redirect({
      to: "/budget/$month",
      params: { month: currentMonth() },
      replace: true,
    })
  },
})
