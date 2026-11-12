import { Outlet, createFileRoute } from "@tanstack/react-router"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export const Route = createFileRoute("/_app")({ component: AppShell })

function AppShell() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}
