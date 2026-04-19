import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState, useCallback, useMemo } from "react";
import { Link2, Check, Users, ArrowLeft, RefreshCw, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ScheduleUpload from "@/components/ScheduleUpload";
import AvailabilityGrid from "@/components/AvailabilityGrid";
import IndividualSchedules from "@/components/IndividualSchedules";
import FindATime from "@/components/FindATime";
import EventInvitations from "@/components/EventInvitations";
import { useAuth } from "@/contexts/AuthContext";
import { getISOWeek, getDateRangeForWeek } from "@/lib/week";

export interface ScheduleEvent {
  title: string;
  dayOfWeek: number;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

export interface EventUser {
  id: string;
  name: string;
  schedule: ScheduleEvent[];
  created_at: string;
  user_id?: string | null;
}

const EventPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [users, setUsers] = useState<EventUser[]>([]);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [eventName, setEventName] = useState("");
  const [eventOwnerId, setEventOwnerId] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [autoSyncing, setAutoSyncing] = useState(false);

  const today = useMemo(() => getISOWeek(new Date()), []);
  const [weekYear, setWeekYear] = useState(today.year);
  const [weekNumber, setWeekNumber] = useState(today.week);

  const fetchUsers = useCallback(async () => {
    if (!id) return;

    const { data: evt } = await supabase
      .from("events")
      .select("name, group_id, user_id")
      .eq("id", id)
      .single();
    if (evt?.name) setEventName(evt.name);
    setEventOwnerId(evt?.user_id ?? null);
    if (evt?.group_id) {
      setGroupId(evt.group_id);
      const { data: grp } = await supabase.from("groups").select("name").eq("id", evt.group_id).single();
      if (grp) setGroupName(grp.name);
    }

    const { data, error } = await supabase
      .from("event_users")
      .select("*")
      .eq("event_id", id)
      .order("created_at", { ascending: true });

    if (!error && data) {
      setUsers(
        data.map((u) => ({
          ...u,
          schedule: (u.schedule as unknown as ScheduleEvent[]) || [],
        }))
      );
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchUsers();
    if (!id) return;
    const channel = supabase
      .channel(`event-users-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "event_users", filter: `event_id=eq.${id}` },
        () => fetchUsers()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchUsers, id]);

  // Auto-sync from Google Calendar on event load (if connected and not already participating)
  useEffect(() => {
    if (!user || !id || loading) return;
    const alreadyJoined = users.some((u) => u.user_id === user.id);
    if (alreadyJoined) return;

    let cancelled = false;
    (async () => {
      const { data: token } = await supabase
        .from("google_calendar_tokens")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!token || cancelled) return;

      setAutoSyncing(true);
      try {
        const { start, end } = getDateRangeForWeek(weekYear, weekNumber);
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const { data, error } = await supabase.functions.invoke("google-calendar-events", {
          body: { startDate: start.toISOString(), endDate: end.toISOString(), timeZone: tz },
        });
        if (error || data?.error) return;
        const schedule = data?.schedule || [];
        if (schedule.length === 0) return;

        const displayName =
          (user.user_metadata?.full_name as string | undefined) ||
          (user.email?.split("@")[0]) || "Yo";

        await supabase.from("event_users").insert({
          event_id: id, name: displayName, schedule, user_id: user.id,
        });
        await supabase.from("google_calendar_tokens")
          .update({ last_synced_at: new Date().toISOString() }).eq("user_id", user.id);
        toast.success(`Tu disponibilidad fue importada desde Google Calendar (${schedule.length} eventos)`);
      } catch (e) {
        console.warn("Auto-sync failed:", e);
      } finally {
        if (!cancelled) setAutoSyncing(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, id, loading]);

  // Re-sync from Google Calendar when the selected week changes
  useEffect(() => {
    if (!user || !id || loading) return;
    let cancelled = false;
    (async () => {
      const { data: token } = await supabase
        .from("google_calendar_tokens")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!token || cancelled) return;

      setAutoSyncing(true);
      try {
        const { start, end } = getDateRangeForWeek(weekYear, weekNumber);
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const { data, error } = await supabase.functions.invoke("google-calendar-events", {
          body: { startDate: start.toISOString(), endDate: end.toISOString(), timeZone: tz },
        });
        if (error || data?.error || cancelled) return;
        const schedule = data?.schedule || [];

        const displayName =
          (user.user_metadata?.full_name as string | undefined) ||
          (user.email?.split("@")[0]) || "Yo";

        const mine = users.find((u) => u.user_id === user.id);
        if (mine) {
          await supabase.from("event_users").update({ schedule }).eq("id", mine.id);
        } else if (schedule.length > 0) {
          await supabase.from("event_users").insert({
            event_id: id, name: displayName, schedule, user_id: user.id,
          });
        }
        await supabase.from("google_calendar_tokens")
          .update({ last_synced_at: new Date().toISOString() }).eq("user_id", user.id);
      } catch (e) {
        console.warn("Week sync failed:", e);
      } finally {
        if (!cancelled) setAutoSyncing(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekYear, weekNumber]);

  const refreshFromGoogle = async () => {
    if (!user || !id) return;
    setAutoSyncing(true);
    try {
      const { start, end } = getDateRangeForWeek(weekYear, weekNumber);
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const { data, error } = await supabase.functions.invoke("google-calendar-events", {
        body: { startDate: start.toISOString(), endDate: end.toISOString(), timeZone: tz },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const schedule = data?.schedule || [];

      // Update existing row for this user, or insert
      const mine = users.find((u) => u.user_id === user.id);
      const displayName =
        (user.user_metadata?.full_name as string | undefined) ||
        (user.email?.split("@")[0]) || "Yo";

      if (mine) {
        await supabase.from("event_users").update({ schedule }).eq("id", mine.id);
      } else {
        await supabase.from("event_users").insert({
          event_id: id, name: displayName, schedule, user_id: user.id,
        });
      }
      await supabase.from("google_calendar_tokens")
        .update({ last_synced_at: new Date().toISOString() }).eq("user_id", user.id);
      toast.success(`Disponibilidad actualizada (${schedule.length} eventos)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al sincronizar";
      toast.error(msg);
    } finally {
      setAutoSyncing(false);
    }
  };

  const saveEventName = async () => {
    if (!nameDraft.trim() || !id) return;
    const { error } = await supabase.from("events").update({ name: nameDraft.trim() }).eq("id", id);
    if (error) { toast.error("No se pudo renombrar"); return; }
    setEventName(nameDraft.trim());
    setEditingName(false);
    toast.success("Evento renombrado");
  };

  const shareUrl = `${window.location.origin}/event/${id}`;
  const isOwner = !!user && user.id === eventOwnerId;

  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast.success("Link copiado al portapapeles");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-full bg-background">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="space-y-2">
          {groupId && (
            <button
              onClick={() => navigate(`/group/${groupId}`)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Volver a {groupName || "grupo"}
            </button>
          )}
          {editingName ? (
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveEventName(); if (e.key === "Escape") setEditingName(false); }}
                className="text-2xl font-bold h-auto py-1"
              />
              <Button size="sm" onClick={saveEventName}>Guardar</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingName(false)}>Cancelar</Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-foreground">
                {eventName || "Evento sin nombre"}
              </h1>
              {isOwner && (
                <Button variant="ghost" size="sm" className="h-8" onClick={() => { setNameDraft(eventName); setEditingName(true); }}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="text-sm font-medium text-muted-foreground mb-2">
            Comparte este link con tus amigos
          </h2>
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-muted rounded-lg px-4 py-3 text-sm text-foreground font-mono truncate">
              {shareUrl}
            </div>
            <Button onClick={copyLink} variant="outline" className="shrink-0">
              {copied ? (
                <><Check className="h-4 w-4 mr-2" /> Copiado</>
              ) : (
                <><Link2 className="h-4 w-4 mr-2" /> Copiar Link</>
              )}
            </Button>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          <div className="space-y-6">
            <ScheduleUpload eventId={id!} onScheduleAdded={fetchUsers} />

            {user && (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={refreshFromGoogle}
                disabled={autoSyncing}
              >
                {autoSyncing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
                Sincronizar mi Google Calendar
              </Button>
            )}

            <EventInvitations eventId={id!} isOwner={isOwner} />

            <div className="bg-card rounded-xl border border-border p-6">
              <div className="flex items-center gap-2 mb-4">
                <Users className="h-5 w-5 text-primary" />
                <h3 className="font-semibold text-foreground">
                  Participantes ({users.length})
                </h3>
              </div>
              {loading ? (
                <p className="text-sm text-muted-foreground">Cargando...</p>
              ) : users.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aún no hay participantes. ¡Sé el primero!
                </p>
              ) : (
                <ul className="space-y-2">
                  {users.map((u) => (
                    <li key={u.id} className="flex items-center gap-3 px-3 py-2 bg-muted rounded-lg">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
                        {u.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{u.name}</p>
                        <p className="text-xs text-muted-foreground">{u.schedule.length} eventos</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="lg:col-span-2 space-y-6">
            <FindATime eventId={id!} />
            <AvailabilityGrid
              users={users}
              weekYear={weekYear}
              weekNumber={weekNumber}
              onWeekChange={(y, w) => { setWeekYear(y); setWeekNumber(w); }}
            />
            <IndividualSchedules users={users} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default EventPage;
