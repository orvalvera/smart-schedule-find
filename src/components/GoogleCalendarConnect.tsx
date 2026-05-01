import { useEffect, useState, useCallback } from "react";
import { Calendar, Link as LinkIcon, Unlink, Loader2, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface Props {
  variant?: "card" | "compact";
}

const GoogleCalendarConnect = ({ variant = "card" }: Props) => {
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);
  const [working, setWorking] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!user) { setChecking(false); return; }
    const { data } = await supabase
      .from("google_calendar_tokens")
      .select("id, last_synced_at")
      .eq("user_id", user.id)
      .maybeSingle();
    setConnected(!!data);
    setLastSynced((data as { last_synced_at?: string | null } | null)?.last_synced_at ?? null);
    setChecking(false);
  }, [user]);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  const connect = async () => {
    setWorking(true);
    try {
      sessionStorage.setItem("gcal_return_to", window.location.pathname);
      const redirectUri = `${window.location.origin}/google-calendar/callback`;
      const { data, error } = await supabase.functions.invoke("google-calendar-auth", {
        body: { redirectUri },
      });
      if (error || !data?.authUrl) throw new Error(error?.message || "No auth URL");
      window.location.href = data.authUrl;
    } catch (err) {
      console.error(err);
      toast.error("No se pudo iniciar la conexión con Google");
      setWorking(false);
    }
  };

  const disconnect = async () => {
    if (!user) return;
    setWorking(true);
    // Route through the edge function so the refresh token is REVOKED at Google
    // before the row is deleted. Never delete the row directly from the client.
    const { error } = await supabase.functions.invoke("google-calendar-disconnect");
    setWorking(false);
    if (error) { toast.error("Error al desconectar"); return; }
    setConnected(false);
    setLastSynced(null);
    toast.success("Google Calendar desconectado y revocado");
  };

  const sync = async () => {
    if (!user) return;
    setWorking(true);
    try {
      const now = new Date();
      const start = new Date(now); start.setDate(now.getDate() - 7);
      const end = new Date(now); end.setDate(now.getDate() + 60);
      const { data, error } = await supabase.functions.invoke("google-calendar-events", {
        body: {
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await refreshStatus();
      toast.success(`Calendario sincronizado (${data?.count ?? 0} eventos)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al sincronizar");
    } finally {
      setWorking(false);
    }
  };

  if (variant === "compact") {
    if (checking) return null;
    return connected ? (
      <Button variant="outline" size="sm" onClick={disconnect} disabled={working}>
        <Unlink className="h-4 w-4 mr-2" /> Desconectar Google
      </Button>
    ) : (
      <Button variant="outline" size="sm" onClick={connect} disabled={working}>
        {working ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <LinkIcon className="h-4 w-4 mr-2" />}
        Conectar Google Calendar
      </Button>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border p-5 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-10 w-10 rounded-lg bg-accent flex items-center justify-center shrink-0">
          {connected ? <CheckCircle2 className="h-5 w-5 text-primary" /> : <Calendar className="h-5 w-5 text-accent-foreground" />}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-foreground truncate">Google Calendar</p>
          <p className="text-xs text-muted-foreground truncate">
            {checking ? "Comprobando conexión..." :
              connected
                ? (lastSynced
                    ? `Sincronizado hace ${formatDistanceToNow(new Date(lastSynced), { locale: es })}`
                    : "Conectado · sincroniza para importar tu disponibilidad")
                : "Conecta tu cuenta para importar tu disponibilidad"}
          </p>
        </div>
      </div>
      {!checking && (connected ? (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={sync} disabled={working}>
            {working ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Sincronizar
          </Button>
          <Button variant="ghost" size="sm" onClick={disconnect} disabled={working}>
            <Unlink className="h-4 w-4 mr-2" /> Desconectar
          </Button>
        </div>
      ) : (
        <Button size="sm" onClick={connect} disabled={working}>
          {working ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <LinkIcon className="h-4 w-4 mr-2" />}
          Conectar
        </Button>
      ))}
    </div>
  );
};

export default GoogleCalendarConnect;
