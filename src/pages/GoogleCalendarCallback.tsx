import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const GoogleCalendarCallback = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const code = params.get("code");
    const error = params.get("error");
    const returnTo = sessionStorage.getItem("gcal_return_to") || "/";

    if (error) {
      setStatus("error");
      setErrorMsg(error);
      return;
    }
    if (!code) {
      setStatus("error");
      setErrorMsg("No authorization code received");
      return;
    }

    const redirectUri = `${window.location.origin}/google-calendar/callback`;
    supabase.functions
      .invoke("google-calendar-callback", { body: { code, redirectUri } })
      .then(({ data, error: fnErr }) => {
        if (fnErr || data?.error) {
          setStatus("error");
          setErrorMsg(fnErr?.message || data?.error || "Unknown error");
          return;
        }
        setStatus("success");
        toast.success("Google Calendar conectado");
        setTimeout(() => navigate(returnTo, { replace: true }), 1200);
      });
  }, [params, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="bg-card border border-border rounded-xl p-8 max-w-md w-full text-center space-y-4">
        {status === "loading" && (
          <>
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
            <h1 className="text-xl font-semibold text-foreground">Conectando Google Calendar...</h1>
          </>
        )}
        {status === "success" && (
          <>
            <CheckCircle2 className="h-10 w-10 text-primary mx-auto" />
            <h1 className="text-xl font-semibold text-foreground">¡Conectado!</h1>
            <p className="text-sm text-muted-foreground">Redirigiendo...</p>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle className="h-10 w-10 text-destructive mx-auto" />
            <h1 className="text-xl font-semibold text-foreground">Error de conexión</h1>
            <p className="text-sm text-muted-foreground break-words">{errorMsg}</p>
            <Button onClick={() => navigate("/")}>Volver</Button>
          </>
        )}
      </div>
    </div>
  );
};

export default GoogleCalendarCallback;
