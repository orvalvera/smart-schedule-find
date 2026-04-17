import { useEffect, useState } from "react";
import { Link as LinkIcon, Unlink, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface Props {
  variant?: "card" | "compact";
}

const GoogleCalendarConnect = ({ variant = "card" }: Props) => {
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!user) { setChecking(false); return; }
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("google_calendar_tokens")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (active) {
        setConnected(!!data);
        setChecking(false);
      }
    })();
    return () => { active = false; };
  }, [user]);

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
    const { error } = await supabase
      .from("google_calendar_tokens")
      .delete()
      .eq("user_id", user.id);
    setWorking(false);
    if (error) { toast.error("Error al desconectar"); return; }
    setConnected(false);
    toast.success("Google Calendar desconectado");
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
    <div className="bg-card rounded-xl border border-border p-5 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-10 w-10 rounded-lg bg-accent flex items-center justify-center shrink-0">
          {connected ? (
            <CheckCircle2 className="h-5 w-5 text-primary" />
          ) : (
            <LinkIcon className="h-5 w-5 text-accent-foreground" />
          )}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-foreground truncate">Google Calendar</p>
          <p className="text-xs text-muted-foreground truncate">
            {checking ? "Comprobando conexión..." : connected ? "Conectado — podrás importar tu calendario en cualquier evento" : "Conecta tu cuenta para importar tu disponibilidad"}
          </p>
        </div>
      </div>
      {!checking && (connected ? (
        <Button variant="outline" size="sm" onClick={disconnect} disabled={working}>
          <Unlink className="h-4 w-4 mr-2" /> Desconectar
        </Button>
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
