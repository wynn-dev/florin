import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/_app/reports/")({
  beforeLoad: () => {
    throw redirect({
      to: "/reports/$report",
      params: { report: "net-worth" },
      replace: true,
    })
  },
})
