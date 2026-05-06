import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Button } from "@/components/ui/button";
import { LogOut, Moon, Sun } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { toast } from "sonner";

const AppLayout = ({ children }: { children: ReactNode }) => {
  const { user, signOut } = useAuth();
  const { theme, toggle } = useTheme();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center justify-between border-b border-border px-4 gap-3">
            <SidebarTrigger />
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground hidden sm:inline truncate max-w-[200px]">
                {user?.user_metadata?.full_name || user?.email}
              </span>
              <Button variant="ghost" size="sm" onClick={toggle} aria-label="Cambiar tema">
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={async () => { await signOut(); toast.success("Sesión cerrada"); }}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </header>
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default AppLayout;
