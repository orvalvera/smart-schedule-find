import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Calendar, Home, Users, Loader2, Crown, UserCircle, CalendarPlus, Mail } from "lucide-react";
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

interface GroupItem { id: string; name: string }
interface EventItem { id: string; name: string }
interface InviteItem { id: string; event_id: string; event_name: string }

export function AppSidebar() {
  const { user } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();

  const [ownedGroups, setOwnedGroups] = useState<GroupItem[]>([]);
  const [memberGroups, setMemberGroups] = useState<GroupItem[]>([]);
  const [createdEvents, setCreatedEvents] = useState<EventItem[]>([]);
  const [joinedEvents, setJoinedEvents] = useState<EventItem[]>([]);
  const [invitations, setInvitations] = useState<InviteItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let active = true;

    const load = async () => {
      // Owned groups
      const { data: ownGroups } = await supabase
        .from("groups").select("id, name").eq("user_id", user.id).order("created_at", { ascending: false });

      // Memberships
      const { data: memberships } = await supabase
        .from("user_groups").select("group_id, groups(id, name, user_id)").eq("user_id", user.id);

      const ownedIds = new Set((ownGroups ?? []).map((g) => g.id));
      const member: GroupItem[] = [];
      for (const m of memberships ?? []) {
        const g = m.groups as unknown as { id: string; name: string; user_id: string | null } | null;
        if (g && !ownedIds.has(g.id) && g.user_id !== user.id) {
          member.push({ id: g.id, name: g.name });
        }
      }

      // Created events (by me)
      const { data: ownEvents } = await supabase
        .from("events").select("id, name").eq("user_id", user.id).order("created_at", { ascending: false });

      // Joined events (where I appear in event_users but not creator)
      const ownEventIds = new Set((ownEvents ?? []).map((e) => e.id));
      const { data: participations } = await supabase
        .from("event_users").select("event_id, events(id, name, user_id)").eq("user_id", user.id);
      const joined: EventItem[] = [];
      const seen = new Set<string>();
      for (const p of participations ?? []) {
        const e = p.events as unknown as { id: string; name: string; user_id: string | null } | null;
        if (e && !ownEventIds.has(e.id) && !seen.has(e.id)) {
          seen.add(e.id);
          joined.push({ id: e.id, name: e.name || "Sin nombre" });
        }
      }

      // Invitations (pending)
      const { data: invites } = await supabase
        .from("event_invitations")
        .select("id, event_id, status, events(name)")
        .eq("status", "pending");
      const invList: InviteItem[] = (invites ?? []).map((i) => ({
        id: i.id,
        event_id: i.event_id,
        event_name: ((i.events as unknown as { name: string } | null)?.name) || "Evento",
      }));

      if (!active) return;
      setOwnedGroups((ownGroups ?? []).map((g) => ({ id: g.id, name: g.name })));
      setMemberGroups(member);
      setCreatedEvents((ownEvents ?? []).map((e) => ({ id: e.id, name: e.name || "Sin nombre" })));
      setJoinedEvents(joined);
      setInvitations(invList);
      setLoading(false);
    };

    load();

    const channel = supabase
      .channel(`sidebar-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_groups", filter: `user_id=eq.${user.id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "groups" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "event_invitations" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "event_users" }, load)
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, [user, location.pathname]);

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    isActive ? "bg-muted text-primary font-medium" : "hover:bg-muted/50";

  const renderGroupSection = (label: string, Icon: typeof Users, items: GroupItem[], isAdmin: boolean) => (
    <SidebarGroup>
      <SidebarGroupLabel>
        <Icon className="h-3.5 w-3.5 mr-1.5" /> {label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.length === 0 ? (
            !collapsed && <p className="px-2 py-1 text-xs text-muted-foreground">Vacío</p>
          ) : (
            items.map((g) => (
              <SidebarMenuItem key={g.id}>
                <SidebarMenuButton asChild tooltip={g.name}>
                  <NavLink to={`/group/${g.id}`} className={linkCls}>
                    <Users className="h-4 w-4" />
                    {!collapsed && (
                      <span className="flex-1 truncate flex items-center gap-1.5">
                        {g.name}
                        {isAdmin && <Crown className="h-3 w-3 text-primary shrink-0" />}
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
  );

  const renderEventSection = (label: string, Icon: typeof Calendar, items: EventItem[]) => (
    <SidebarGroup>
      <SidebarGroupLabel>
        <Icon className="h-3.5 w-3.5 mr-1.5" /> {label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.length === 0 ? (
            !collapsed && <p className="px-2 py-1 text-xs text-muted-foreground">Vacío</p>
          ) : (
            items.map((e) => (
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
  );

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

        {loading ? (
          <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" /> {!collapsed && "Cargando..."}
          </div>
        ) : (
          <>
            {renderGroupSection("Grupos que administro", Crown, ownedGroups, true)}
            {renderGroupSection("Grupos donde participo", Users, memberGroups, false)}
            {renderEventSection("Eventos creados", CalendarPlus, createdEvents)}
            {renderEventSection("Eventos donde participo", UserCircle, joinedEvents)}

            {invitations.length > 0 && (
              <SidebarGroup>
                <SidebarGroupLabel>
                  <Mail className="h-3.5 w-3.5 mr-1.5" /> Invitaciones pendientes
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {invitations.map((i) => (
                      <SidebarMenuItem key={i.id}>
                        <SidebarMenuButton asChild tooltip={i.event_name}>
                          <NavLink to={`/event/${i.event_id}`} className={linkCls}>
                            <Mail className="h-4 w-4 text-primary" />
                            {!collapsed && <span className="truncate">{i.event_name}</span>}
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
          </>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
