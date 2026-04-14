import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import { Calendar, Plus, Users, Link2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface GroupEvent {
  id: string;
  name: string;
  created_at: string;
  _count?: number;
}

const GroupPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [groupName, setGroupName] = useState("");
  const [events, setEvents] = useState<GroupEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEventName, setNewEventName] = useState("");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchGroup = useCallback(async () => {
    if (!id) return;
    const { data: group } = await supabase
      .from("groups")
      .select("name")
      .eq("id", id)
      .single();

    if (group) setGroupName(group.name);

    const { data: evts } = await supabase
      .from("events")
      .select("id, name, created_at")
      .eq("group_id", id)
      .order("created_at", { ascending: false });

    if (evts) {
      // Get participant counts
      const eventsWithCounts: GroupEvent[] = [];
      for (const evt of evts) {
        const { count } = await supabase
          .from("event_users")
          .select("*", { count: "exact", head: true })
          .eq("event_id", evt.id);
        eventsWithCounts.push({ ...evt, _count: count ?? 0 });
      }
      setEvents(eventsWithCounts);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchGroup();
  }, [fetchGroup]);

  const createEvent = async () => {
    if (!newEventName.trim()) {
      toast.error("Dale un nombre al evento");
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await supabase
        .from("events")
        .insert({ name: newEventName.trim(), group_id: id })
        .select("id")
        .single();
      if (error) throw error;
      toast.success("Evento creado");
      setNewEventName("");
      navigate(`/event/${data.id}`);
    } catch {
      toast.error("Error al crear evento");
    } finally {
      setCreating(false);
    }
  };

  const shareUrl = `${window.location.origin}/group/${id}`;
  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast.success("Link copiado");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <Calendar className="h-6 w-6 text-primary" />
            <span className="text-xl font-bold text-foreground">SyncAI</span>
          </a>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{groupName || "Grupo"}</h1>
          <p className="text-muted-foreground mt-1">Administra los eventos de tu grupo</p>
        </div>

        {/* Share */}
        <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-3">
          <div className="flex-1 bg-muted rounded-lg px-4 py-2.5 text-sm text-foreground font-mono truncate">
            {shareUrl}
          </div>
          <Button onClick={copyLink} variant="outline" size="sm">
            {copied ? <><Check className="h-4 w-4 mr-1" /> Copiado</> : <><Link2 className="h-4 w-4 mr-1" /> Copiar</>}
          </Button>
        </div>

        {/* Create event */}
        <div className="bg-card rounded-xl border border-border p-6 space-y-4">
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <Plus className="h-5 w-5 text-primary" />
            Crear evento en este grupo
          </h3>
          <div className="flex gap-3">
            <Input
              placeholder="Nombre del evento (ej: Estudio Cálculo)"
              value={newEventName}
              onChange={(e) => setNewEventName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createEvent()}
            />
            <Button onClick={createEvent} disabled={creating}>
              {creating ? "Creando..." : "Crear"}
            </Button>
          </div>
        </div>

        {/* Events list */}
        <div className="space-y-3">
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            Eventos ({events.length})
          </h3>
          {loading ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : events.length === 0 ? (
            <div className="bg-card rounded-xl border border-border p-8 text-center">
              <p className="text-muted-foreground">No hay eventos aún. ¡Crea el primero!</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {events.map((evt) => (
                <button
                  key={evt.id}
                  onClick={() => navigate(`/event/${evt.id}`)}
                  className="bg-card rounded-xl border border-border p-5 text-left hover:border-primary/50 transition-colors w-full"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-foreground">{evt.name || "Sin nombre"}</p>
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                        <Users className="h-3 w-3" /> {evt._count} participantes
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(evt.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GroupPage;
