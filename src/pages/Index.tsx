import { useNavigate } from "react-router-dom";
import { Calendar, Sparkles, Users, Clock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { toast } from "sonner";

const Index = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const createEvent = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("events")
        .insert({})
        .select("id")
        .single();

      if (error) throw error;
      navigate(`/event/${data.id}`);
    } catch {
      toast.error("Error al crear el evento");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Nav */}
      <nav className="border-b border-border px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-2">
          <Calendar className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold text-foreground">SyncAI</span>
        </div>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-2xl text-center space-y-8">
          <div className="inline-flex items-center gap-2 bg-accent text-accent-foreground px-4 py-2 rounded-full text-sm font-medium">
            <Sparkles className="h-4 w-4" />
            Potenciado por IA
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-foreground leading-tight tracking-tight">
            Encuentra la hora perfecta{" "}
            <span className="text-primary">sin llenar celdas manuales</span>
          </h1>

          <p className="text-lg text-muted-foreground max-w-lg mx-auto">
            Sube una foto de tu horario y la IA lo lee por ti. Comparte el link
            con tus amigos y descubre al instante cuándo están todos libres.
          </p>

          <Button
            size="lg"
            onClick={createEvent}
            disabled={loading}
            className="text-lg px-8 py-6 rounded-xl font-semibold shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all"
          >
            {loading ? (
              "Creando..."
            ) : (
              <>
                Crear nuevo evento
                <ArrowRight className="ml-2 h-5 w-5" />
              </>
            )}
          </Button>

          {/* Features */}
          <div className="grid sm:grid-cols-3 gap-6 pt-12">
            {[
              {
                icon: Sparkles,
                title: "IA Vision",
                desc: "Sube una foto y la IA extrae tu horario automáticamente",
              },
              {
                icon: Users,
                title: "Colaborativo",
                desc: "Comparte un link y todos suben su horario en segundos",
              },
              {
                icon: Clock,
                title: "Horas libres",
                desc: "Ve al instante cuándo están todos disponibles",
              },
            ].map((f) => (
              <div
                key={f.title}
                className="bg-card rounded-xl p-6 border border-border text-left space-y-3"
              >
                <div className="h-10 w-10 rounded-lg bg-accent flex items-center justify-center">
                  <f.icon className="h-5 w-5 text-accent-foreground" />
                </div>
                <h3 className="font-semibold text-foreground">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;
