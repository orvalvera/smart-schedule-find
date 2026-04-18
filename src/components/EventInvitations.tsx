import { useEffect, useState } from "react";
import { Mail, X, Send, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface Invitation {
  id: string;
  invited_email: string;
  status: "pending" | "accepted" | "declined";
  created_at: string;
}

const EventInvitations = ({ eventId, isOwner }: { eventId: string; isOwner: boolean }) => {
  const { user } = useAuth();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("event_invitations")
      .select("id, invited_email, status, created_at")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false });
    setInvitations((data as Invitation[]) ?? []);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`invites-${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "event_invitations", filter: `event_id=eq.${eventId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const invite = async () => {
    const e = email.trim().toLowerCase();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { toast.error("Email no válido"); return; }
    if (!user) return;
    setSending(true);
    try {
      const { error } = await supabase.from("event_invitations").insert({
        event_id: eventId,
        invited_by: user.id,
        invited_email: e,
      });
      if (error) throw error;
      toast.success("Invitación enviada");
      setEmail("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al invitar";
      toast.error(msg.includes("duplicate") ? "Ya existe una invitación para ese email" : msg);
    } finally {
      setSending(false);
    }
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("event_invitations").delete().eq("id", id);
    if (error) toast.error("No se pudo eliminar");
  };

  if (!isOwner && invitations.length === 0) return null;

  return (
    <div className="bg-card rounded-xl border border-border p-6 space-y-3">
      <div className="flex items-center gap-2">
        <Mail className="h-5 w-5 text-primary" />
        <h3 className="font-semibold text-foreground">Invitaciones</h3>
      </div>

      {isOwner && (
        <div className="flex gap-2">
          <Input
            placeholder="email@ejemplo.com"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && invite()}
            disabled={sending}
          />
          <Button onClick={invite} disabled={sending || !email.trim()} size="sm">
            <Send className="h-4 w-4 mr-1.5" /> Invitar
          </Button>
        </div>
      )}

      {invitations.length === 0 ? (
        <p className="text-xs text-muted-foreground">Aún no has invitado a nadie.</p>
      ) : (
        <ul className="space-y-1.5">
          {invitations.map((inv) => (
            <li key={inv.id} className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg text-sm">
              <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="flex-1 truncate text-foreground">{inv.invited_email}</span>
              <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                inv.status === "accepted" ? "bg-success/10 text-success" :
                inv.status === "declined" ? "bg-busy/10 text-busy" :
                "bg-muted-foreground/10 text-muted-foreground"
              }`}>
                {inv.status === "accepted" ? <><Check className="h-3 w-3 inline" /> aceptada</> :
                 inv.status === "declined" ? "rechazada" : "pendiente"}
              </span>
              {isOwner && (
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => remove(inv.id)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default EventInvitations;
