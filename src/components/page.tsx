import type { ReactNode } from "react"
import { SiteHeader } from "@/components/site-header"

/**
 * A page inside the app shell: the site header (title, optional breadcrumb
 * parent, actions at the right) and the page's content under it, padded p-6
 * on desktop and p-4 on a phone, clear of the phone's bottom bar.
 *
 *   <Page title="Transactions" actions={<Button>New transaction</Button>}>
 */
export function Page({
  title,
  parent,
  actions,
  children,
}: {
  title: string
  parent?: { label: string; to: string }
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <>
      <SiteHeader title={title} parent={parent} actions={actions} />
      <div className="flex flex-1 flex-col gap-6 px-4 pt-2 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:px-6 md:pt-2 md:pb-6">
        {children}
      </div>
    </>
  )
}
