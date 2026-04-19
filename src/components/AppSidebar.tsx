import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Calendar,
  Home,
  Users,
  Loader2,
  Crown,
  Mail,
  ChevronRight,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface EventItem {
  id: string;
  name: string;
  group_id: string | null;
}
interface GroupItem {
  id: string;
  name: string;
  events: EventItem[];
}
interface InviteItem {
  id: string;
  event_id: string;
  event_name: string;
  group_id: string | null;
}

export function AppSidebar() {
  const { user } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();

  const [ownedGroups, setOwnedGroups] = useState<GroupItem[]>([]);
  const [memberGroups, setMemberGroups] = useState<GroupItem[]>([]);
  const [standaloneEvents, setStandaloneEvents] = useState<EventItem[]>([]);
  const [invitations, setInvitations] = useState<InviteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!user) return;
    let active = true;

    const load = async () => {
      // Owned groups
      const { data: ownGroups } = await supabase
        .from("groups")
        .select("id, name")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      // Memberships (groups I belong to but don't own)
      const { data: memberships } = await supabase
        .from("user_groups")
        .select("group_id, groups(id, name, user_id)")
        .eq("user_id", user.id);

      const ownedIds = new Set((ownGroups ?? []).map((g) => g.id));
      const memberGroupsRaw: { id: string; name: string }[] = [];
      for (const m of memberships ?? []) {
        const g = m.groups as unknown as
          | { id: string; name: string; user_id: string | null }
          | null;
        if (g && !ownedIds.has(g.id) && g.user_id !== user.id) {
          memberGroupsRaw.push({ id: g.id, name: g.name });
        }
      }

      // Events I created
      const { data: ownEvents } = await supabase
        .from("events")
        .select("id, name, group_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      // Events I participate in
      const { data: participations } = await supabase
        .from("event_users")
        .select("event_id, events(id, name, user_id, group_id)")
        .eq("user_id", user.id);

      // Pending invitations
      const { data: invites } = await supabase
        .from("event_invitations")
        .select("id, event_id, status, events(name, group_id)")
        .eq("status", "pending");

      // Build a unified set of events the user has access to.
      const eventMap = new Map<string, EventItem>();
      for (const e of ownEvents ?? []) {
        eventMap.set(e.id, {
          id: e.id,
          name: e.name || "Sin nombre",
          group_id: e.group_id,
        });
      }
      for (const p of participations ?? []) {
        const e = p.events as unknown as
          | { id: string; name: string; user_id: string | null; group_id: string | null }
          | null;
        if (e && !eventMap.has(e.id)) {
          eventMap.set(e.id, {
            id: e.id,
            name: e.name || "Sin nombre",
            group_id: e.group_id,
          });
        }
      }
      for (const i of invites ?? []) {
        const e = i.events as unknown as
          | { name: string; group_id: string | null }
          | null;
        if (e && !eventMap.has(i.event_id)) {
          eventMap.set(i.event_id, {
            id: i.event_id,
            name: e.name || "Evento",
            group_id: e.group_id,
          });
        }
      }

      const allEvents = Array.from(eventMap.values());

      // Group events under their group
      const eventsByGroup = new Map<string, EventItem[]>();
      const standalone: EventItem[] = [];
      const accessibleGroupIds = new Set([
        ...ownedIds,
        ...memberGroupsRaw.map((g) => g.id),
      ]);
      for (const e of allEvents) {
        if (e.group_id && accessibleGroupIds.has(e.group_id)) {
          if (!eventsByGroup.has(e.group_id)) eventsByGroup.set(e.group_id, []);
          eventsByGroup.get(e.group_id)!.push(e);
        } else {
          // Either no group, or a group the user is not in -> show as standalone
          standalone.push(e);
        }
      }

      const owned: GroupItem[] = (ownGroups ?? []).map((g) => ({
        id: g.id,
        name: g.name,
        events: eventsByGroup.get(g.id) ?? [],
      }));
      const member: GroupItem[] = memberGroupsRaw.map((g) => ({
        id: g.id,
        name: g.name,
        events: eventsByGroup.get(g.id) ?? [],
      }));

      const invList: InviteItem[] = (invites ?? [])
        .map((i) => {
          const e = i.events as unknown as
            | { name: string; group_id: string | null }
            | null;
          return {
            id: i.id,
            event_id: i.event_id,
            event_name: e?.name || "Evento",
            group_id: e?.group_id ?? null,
          };
        })
        // Only show in pending list if the event is NOT in a group the user belongs to
        // (otherwise it lives under the group section already).
        .filter(
          (i) => !(i.group_id && accessibleGroupIds.has(i.group_id))
        );

      if (!active) return;
      setOwnedGroups(owned);
      setMemberGroups(member);
      setStandaloneEvents(standalone);
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

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [user, location.pathname]);

  // Auto-open the group that contains the active route
  const activeGroupId = useMemo(() => {
    const m = location.pathname.match(/^\/group\/([^/]+)/);
    if (m) return m[1];
    const em = location.pathname.match(/^\/event\/([^/]+)/);
    if (em) {
      const evId = em[1];
      for (const g of [...ownedGroups, ...memberGroups]) {
        if (g.events.some((e) => e.id === evId)) return g.id;
      }
    }
    return null;
  }, [location.pathname, ownedGroups, memberGroups]);

  const isGroupOpen = (id: string) =>
    openGroups[id] ?? id === activeGroupId;

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    isActive ? "bg-muted text-primary font-medium" : "hover:bg-muted/50";

  const renderGroupSection = (
    label: string,
    Icon: typeof Users,
    groups: GroupItem[],
    isAdmin: boolean
  ) => (
    <SidebarGroup>
      <SidebarGroupLabel>
        <Icon className="h-3.5 w-3.5 mr-1.5" /> {label}
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {groups.length === 0 ? (
            !collapsed && (
              <p className="px-2 py-1 text-xs text-muted-foreground">Vacío</p>
            )
          ) : (
            groups.map((g) => {
              const open = isGroupOpen(g.id);
              return (
                <Collapsible
                  key={g.id}
                  open={open}
                  onOpenChange={(o) =>
                    setOpenGroups((prev) => ({ ...prev, [g.id]: o }))
                  }
                >
                  <SidebarMenuItem>
                    <div className="flex items-center w-full">
                      <SidebarMenuButton
                        asChild
                        tooltip={g.name}
                        className="flex-1"
                      >
                        <NavLink to={`/group/${g.id}`} className={linkCls}>
                          <Users className="h-4 w-4" />
                          {!collapsed && (
                            <span className="flex-1 truncate flex items-center gap-1.5">
                              {g.name}
                              {isAdmin && (
                                <Crown className="h-3 w-3 text-primary shrink-0" />
                              )}
                            </span>
                          )}
                        </NavLink>
                      </SidebarMenuButton>
                      {!collapsed && (
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            aria-label={open ? "Colapsar" : "Expandir"}
                            className="p-1 mr-1 rounded hover:bg-muted/60 transition-transform shrink-0"
                            style={{
                              transform: open ? "rotate(90deg)" : "rotate(0deg)",
                            }}
                          >
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        </CollapsibleTrigger>
                      )}
                    </div>
                    {!collapsed && (
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {g.events.length === 0 ? (
                            <p className="px-2 py-1 text-[11px] text-muted-foreground">
                              Sin eventos
                            </p>
                          ) : (
                            g.events.map((e) => (
                              <SidebarMenuSubItem key={e.id}>
                                <SidebarMenuSubButton asChild>
                                  <NavLink
                                    to={`/event/${e.id}`}
                                    className={linkCls}
                                  >
                                    <Calendar className="h-3.5 w-3.5" />
                                    <span className="truncate">{e.name}</span>
                                  </NavLink>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            ))
                          )}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    )}
                  </SidebarMenuItem>
                </Collapsible>
              );
            })
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
            <Loader2 className="h-3 w-3 animate-spin" />{" "}
            {!collapsed && "Cargando..."}
          </div>
        ) : (
          <>
            {renderGroupSection(
              "Grupos que administro",
              Crown,
              ownedGroups,
              true
            )}
            {renderGroupSection(
              "Grupos donde participo",
              Users,
              memberGroups,
              false
            )}

            <SidebarGroup>
              <SidebarGroupLabel>
                <Calendar className="h-3.5 w-3.5 mr-1.5" /> Eventos
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {standaloneEvents.length === 0 ? (
                    !collapsed && (
                      <p className="px-2 py-1 text-xs text-muted-foreground">
                        Sin eventos sueltos
                      </p>
                    )
                  ) : (
                    standaloneEvents.map((e) => (
                      <SidebarMenuItem key={e.id}>
                        <SidebarMenuButton asChild tooltip={e.name}>
                          <NavLink to={`/event/${e.id}`} className={linkCls}>
                            <Calendar className="h-4 w-4" />
                            {!collapsed && (
                              <span className="truncate">{e.name}</span>
                            )}
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

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
                          <NavLink
                            to={`/event/${i.event_id}`}
                            className={linkCls}
                          >
                            <Mail className="h-4 w-4 text-primary" />
                            {!collapsed && (
                              <span className="truncate">{i.event_name}</span>
                            )}
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
