import { Outlet, createFileRoute, useLoaderData } from "@tanstack/react-router"
import { AppSidebar } from "@/components/app-sidebar"
import { BottomBar } from "@/components/bottom-bar"
import { CommandPalette } from "@/components/command-palette"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export const Route = createFileRoute("/_app")({ component: AppShell })

function AppShell() {
  const { sidebarOpen } = useLoaderData({ from: "__root__" })
  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar />
      <SidebarInset>
        <Outlet />
      </SidebarInset>
      <BottomBar />
      <CommandPalette />
    </SidebarProvider>
  )
}
