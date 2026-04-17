import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Calendar, FolderOpen, Home, Users, Loader2 } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface GroupItem {
  id: string;
  name: string;
  role: "admin" | "member";
}

interface EventItem {
  id: string;
  name: string;
  group_id: string | null;
}

export function AppSidebar() {
  const { user } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();

  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let active = true;

    const load = async () => {
      // Groups: memberships + groups created by user
      const { data: memberships } = await supabase
        .from("user_groups")
        .select("group_id, role, groups(id, name, user_id)")
        .eq("user_id", user.id);

      const groupItems: GroupItem[] = (memberships || [])
        .filter((m) => m.groups)
        .map((m) => {
          const g = m.groups as unknown as { id: string; name: string; user_id: string | null };
          return {
            id: g.id,
            name: g.name,
            role: g.user_id === user.id ? "admin" : (m.role as "admin" | "member"),
          };
        });

      // Also include groups created by the user that they may not be in user_groups
      const { data: ownGroups } = await supabase
        .from("groups")
        .select("id, name")
        .eq("user_id", user.id);

      for (const og of ownGroups || []) {
        if (!groupItems.find((g) => g.id === og.id)) {
          groupItems.push({ id: og.id, name: og.name, role: "admin" });
        }
      }

      // Events: ones the user has participated in, plus ones they own
      const { data: participations } = await supabase
        .from("event_users")
        .select("event_id, events(id, name, group_id)")
        .eq("user_id", user.id);

      const evMap = new Map<string, EventItem>();
      for (const p of participations || []) {
        const e = p.events as unknown as { id: string; name: string; group_id: string | null } | null;
        if (e) evMap.set(e.id, { id: e.id, name: e.name || "Sin nombre", group_id: e.group_id });
      }

      const { data: ownEvents } = await supabase
        .from("events")
        .select("id, name, group_id")
        .eq("user_id", user.id);

      for (const e of ownEvents || []) {
        if (!evMap.has(e.id)) evMap.set(e.id, { id: e.id, name: e.name || "Sin nombre", group_id: e.group_id });
      }

      if (active) {
        setGroups(groupItems);
        setEvents(Array.from(evMap.values()));
        setLoading(false);
      }
    };

    load();

    // Realtime: refresh when memberships change
    const channel = supabase
      .channel(`sidebar-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_groups", filter: `user_id=eq.${user.id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "groups" }, load)
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, [user, location.pathname]);

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    isActive ? "bg-muted text-primary font-medium" : "hover:bg-muted/50";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-border">
        <NavLink to="/" className="flex items-center gap-2 px-2 py-2">
          <Calendar className="h-5 w-5 text-primary shrink-0" />
          {!collapsed && <span className="font-bold text-foreground">SyncAI</span>}
        </NavLink>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Inicio">
                  <NavLink to="/" end className={linkCls}>
                    <Home className="h-4 w-4" />
                    {!collapsed && <span>Inicio</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>
            <Users className="h-3.5 w-3.5 mr-1.5" /> Mis grupos
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {loading ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> {!collapsed && "Cargando..."}
                </div>
              ) : groups.length === 0 ? (
                !collapsed && <p className="px-2 py-1 text-xs text-muted-foreground">Sin grupos aún</p>
              ) : (
                groups.map((g) => (
                  <SidebarMenuItem key={g.id}>
                    <SidebarMenuButton asChild tooltip={`${g.name}${g.role === "admin" ? " (admin)" : ""}`}>
                      <NavLink to={`/group/${g.id}`} className={linkCls}>
                        <Users className="h-4 w-4" />
                        {!collapsed && (
                          <span className="flex-1 truncate flex items-center gap-1.5">
                            {g.name}
                            {g.role === "admin" && (
                              <span className="text-[10px] uppercase tracking-wide bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                                admin
                              </span>
                            )}
                          </span>
                        )}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>
            <FolderOpen className="h-3.5 w-3.5 mr-1.5" /> Mis eventos
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {!loading && events.length === 0 ? (
                !collapsed && <p className="px-2 py-1 text-xs text-muted-foreground">Sin eventos aún</p>
              ) : (
                events.map((e) => (
                  <SidebarMenuItem key={e.id}>
                    <SidebarMenuButton asChild tooltip={e.name}>
                      <NavLink to={`/event/${e.id}`} className={linkCls}>
                        <Calendar className="h-4 w-4" />
                        {!collapsed && <span className="truncate">{e.name}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
