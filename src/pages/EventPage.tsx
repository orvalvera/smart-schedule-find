import { useParams } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import { Calendar, Link2, Check, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ScheduleUpload from "@/components/ScheduleUpload";
import AvailabilityGrid from "@/components/AvailabilityGrid";

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
}

const EventPage = () => {
  const { id } = useParams<{ id: string }>();
  const [users, setUsers] = useState<EventUser[]>([]);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchUsers = useCallback(async () => {
    if (!id) return;
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
  }, [fetchUsers]);

  const shareUrl = `${window.location.origin}/event/${id}`;

  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast.success("Link copiado al portapapeles");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleScheduleAdded = () => {
    fetchUsers();
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="border-b border-border px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <Calendar className="h-6 w-6 text-primary" />
            <span className="text-xl font-bold text-foreground">SyncAI</span>
          </a>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Share header */}
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
                <>
                  <Check className="h-4 w-4 mr-2" /> Copiado
                </>
              ) : (
                <>
                  <Link2 className="h-4 w-4 mr-2" /> Copiar Link
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Left column: Upload + Users */}
          <div className="space-y-6">
            <ScheduleUpload eventId={id!} onScheduleAdded={handleScheduleAdded} />

            {/* Users list */}
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
                    <li
                      key={u.id}
                      className="flex items-center gap-3 px-3 py-2 bg-muted rounded-lg"
                    >
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
                        {u.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {u.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {u.schedule.length} clases
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Right column: Grid */}
          <div className="lg:col-span-2">
            <AvailabilityGrid users={users} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default EventPage;
