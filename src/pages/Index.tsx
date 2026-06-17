import { useNavigate } from "react-router-dom";
import { Sparkles, Users, Clock, ArrowRight, FolderPlus, LogIn, CalendarDays, FolderKanban, Inbox, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import GoogleCalendarConnect from "@/components/GoogleCalendarConnect";
import PageSEO from "@/components/PageSEO";

interface GroupItem { id: string; name: string }
interface EventItem { id: string; name: string; group_id: string | null; created_at: string }

const Index = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [groupDialog, setGroupDialog] = useState(false);
  const [joinDialog, setJoinDialog] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [joinLink, setJoinLink] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [myGroups, setMyGroups] = useState<GroupItem[] | null>(null);
  const [myEvents, setMyEvents] = useState<EventItem[] | null>(null);
  const [search, setSearch] = useState("");

  const loadHome = useCallback(async () => {
    if (!user) return;
    const [{ data: ug }, { data: evts }] = await Promise.all([
      supabase
        .from("user_groups")
        .select("group_id, groups:group_id(id, name)")
        .eq("user_id", user.id),
      supabase
        .from("events")
        .select("id, name, group_id, created_at")
        .order("created_at", { ascending: false })
        .limit(6),
    ]);
    const groups = (ug ?? [])
      .map((r) => (r as unknown as { groups: GroupItem | null }).groups)
      .filter((g): g is GroupItem => !!g);
    setMyGroups(groups);
    setMyEvents((evts ?? []) as EventItem[]);
  }, [user]);

  useEffect(() => { loadHome(); }, [loadHome]);

  const createEvent = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("events")
        .insert({ user_id: user?.id })
        .select("id")
        .single();
      if (error) throw error;
      navigate(`/event/${data.id}`);
    } catch (err) {
      console.error(err);
      toast.error("Error al crear el evento");
    } finally {
      setLoading(false);
    }
  };

  const createGroup = async () => {
    if (!groupName.trim()) {
      toast.error("Escribe un nombre para el grupo");
      return;
    }
    if (!user) {
      toast.error("Debes iniciar sesión");
      return;
    }
    setCreatingGroup(true);
    try {
      const { data, error } = await supabase
        .from("groups")
        .insert({ name: groupName.trim(), user_id: user.id })
        .select("id")
        .single();
      if (error) throw error;
      const { error: joinErr } = await supabase.from("user_groups").insert({
        user_id: user.id,
        group_id: data.id,
        role: "member",
      });
      if (joinErr) console.warn("user_groups insert:", joinErr);
      toast.success("Grupo creado");
      setGroupDialog(false);
      setGroupName("");
      navigate(`/group/${data.id}`);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Error al crear el grupo";
      toast.error(msg);
    } finally {
      setCreatingGroup(false);
    }
  };

  const joinGroup = () => {
    const link = joinLink.trim();
    const groupMatch = link.match(/\/group\/([a-f0-9-]+)/i);
    const eventMatch = link.match(/\/event\/([a-f0-9-]+)/i);
    const uuidMatch = link.match(/^[a-f0-9-]{36}$/i);

    if (groupMatch) navigate(`/group/${groupMatch[1]}`);
    else if (eventMatch) navigate(`/event/${eventMatch[1]}`);
    else if (uuidMatch) navigate(`/group/${link}`);
    else toast.error("Link no válido. Pega el link completo del grupo o evento.");
  };

  const norm = (s: string) => s.toLowerCase().trim();
  const filteredGroups = myGroups?.filter((g) => norm(g.name).includes(norm(search))) ?? null;
  const filteredEvents = myEvents?.filter((e) => norm(e.name || "evento sin nombre").includes(norm(search))) ?? null;

  return (
    <div className="px-6 py-8">
      <PageSEO
        title="SyncAI — Encuentra la hora perfecta para tus reuniones"
        description="Sube una foto de tu horario o conecta Google Calendar para descubrir cuándo están todos tus amigos libres con SyncAI."
        path="/"
      />
      <div className="max-w-3xl mx-auto space-y-8">
        <GoogleCalendarConnect />

        <div className="text-center space-y-6 pt-4">
          <div className="inline-flex items-center gap-2 bg-accent text-accent-foreground px-4 py-2 rounded-full text-sm font-medium">
            <Sparkles className="h-4 w-4" />
            Potenciado por IA
          </div>

          <h1 className="text-4xl sm:text-5xl font-extrabold text-foreground leading-tight tracking-tight">
            Encuentra la hora perfecta{" "}
            <span className="text-primary">sin llenar celdas manuales</span>
          </h1>

          <p className="text-lg text-muted-foreground max-w-lg mx-auto">
            Sube una foto de tu horario, conecta Google Calendar o importa un .ics. Comparte el link con tus amigos y descubre cuándo están todos libres.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button
              size="lg"
              onClick={createEvent}
              disabled={loading}
              className="text-lg px-8 py-6 rounded-xl font-semibold shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all"
            >
              {loading ? "Creando..." : <>Evento rápido <ArrowRight className="ml-2 h-5 w-5" /></>}
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => setGroupDialog(true)}
              className="text-lg px-8 py-6 rounded-xl font-semibold"
            >
              <FolderPlus className="mr-2 h-5 w-5" />
              Crear grupo
            </Button>
          </div>

          <div>
            <Button variant="ghost" onClick={() => setJoinDialog(true)} className="text-muted-foreground hover:text-foreground">
              <LogIn className="mr-2 h-4 w-4" />
              Unirme a un grupo o evento existente
            </Button>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-6 pt-4">
          {[
            { icon: Sparkles, title: "IA Vision", desc: "Sube una foto y la IA extrae tu horario automáticamente" },
            { icon: Users, title: "Colaborativo", desc: "Comparte un link y todos suben su horario en segundos" },
            { icon: Clock, title: "Horas libres", desc: "Ve al instante cuándo están todos disponibles" },
          ].map((f) => (
            <div key={f.title} className="bg-card rounded-xl p-6 border border-border text-left space-y-3">
              <div className="h-10 w-10 rounded-lg bg-accent flex items-center justify-center">
                <f.icon className="h-5 w-5 text-accent-foreground" />
              </div>
              <h2 className="font-semibold text-foreground">{f.title}</h2>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>

        <section className="space-y-3 pt-4">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar grupo o evento por nombre..."
              className="pl-9"
            />
          </div>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <FolderKanban className="h-5 w-5 text-primary" /> Mis grupos
            </h2>
            {filteredGroups && filteredGroups.length > 0 && (
              <span className="text-xs text-muted-foreground">{filteredGroups.length} {search ? "encontrados" : "en total"}</span>
            )}
          </div>
          {filteredGroups === null ? (
            <div className="grid sm:grid-cols-2 gap-3">
              <Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" />
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="bg-card border border-dashed border-border rounded-xl p-6 text-center space-y-2">
              <Inbox className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{search ? "Ningún grupo coincide con tu búsqueda." : "Aún no perteneces a ningún grupo."}</p>
              {!search && (
              <Button variant="outline" size="sm" onClick={() => setGroupDialog(true)}>
                <FolderPlus className="mr-2 h-4 w-4" /> Crear mi primer grupo
              </Button>
              )}
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {filteredGroups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => navigate(`/group/${g.id}`)}
                  className="bg-card border border-border rounded-xl p-4 text-left hover:border-primary/40 hover:shadow-sm transition-all flex items-center gap-3"
                >
                  <div className="h-10 w-10 rounded-lg bg-accent flex items-center justify-center text-accent-foreground font-semibold">
                    {g.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{g.name}</p>
                    <p className="text-xs text-muted-foreground">Abrir grupo</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" /> Eventos recientes
          </h2>
          {filteredEvents === null ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" />
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="bg-card border border-dashed border-border rounded-xl p-6 text-center">
              <p className="text-sm text-muted-foreground">{search ? "Ningún evento coincide con tu búsqueda." : "Aún no hay eventos. Crea uno para empezar."}</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {filteredEvents.map((e) => (
                <li key={e.id}>
                  <button
                    onClick={() => navigate(`/event/${e.id}`)}
                    className="w-full bg-card border border-border rounded-xl p-3 text-left hover:border-primary/40 transition-all flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{e.name || "Evento sin nombre"}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(e.created_at).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Dialog open={groupDialog} onOpenChange={setGroupDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear un grupo</DialogTitle>
            <DialogDescription>
              Los grupos te permiten organizar múltiples eventos para un mismo equipo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <Input
              placeholder="Nombre del grupo (ej: Amigos del gym)"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createGroup()}
            />
            <Button onClick={createGroup} disabled={creatingGroup} className="w-full">
              {creatingGroup ? "Creando..." : "Crear grupo"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={joinDialog} onOpenChange={setJoinDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unirme a un grupo o evento</DialogTitle>
            <DialogDescription>
              Pega el link que te compartieron para acceder directamente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <Input
              placeholder="Pega el link aquí (ej: https://...grupo/abc123)"
              value={joinLink}
              onChange={(e) => setJoinLink(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && joinGroup()}
            />
            <Button onClick={joinGroup} className="w-full">
              <LogIn className="mr-2 h-4 w-4" />
              Ir al grupo o evento
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Index;
