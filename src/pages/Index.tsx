import { useNavigate } from "react-router-dom";
import { Sparkles, Users, Clock, ArrowRight, FolderPlus, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import GoogleCalendarConnect from "@/components/GoogleCalendarConnect";

const Index = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [groupDialog, setGroupDialog] = useState(false);
  const [joinDialog, setJoinDialog] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [joinLink, setJoinLink] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);

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

  return (
    <div className="px-6 py-8">
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
              <h3 className="font-semibold text-foreground">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
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
