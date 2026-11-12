import type { ReactNode } from "react"
import { SidebarTrigger } from "@/components/ui/sidebar"

/** A page's header and body inside the app shell. */
export function Page({
  title,
  actions,
  children,
}: {
  title: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 px-4 md:px-6">
        <SidebarTrigger className="-ml-1 md:hidden" />
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </header>
      <div className="flex flex-1 flex-col gap-4 px-4 pb-6 md:px-6">
        {children}
      </div>
    </>
  )
}
