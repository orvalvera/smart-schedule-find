import { useState } from "react";
import { Sparkles, Loader2, Calendar, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { downloadICS, nextOccurrenceLocal } from "@/lib/ics";

interface Suggestion {
  rank: number;
  day: number;
  dayName: string;
  start: string;
  end: string;
  durationMin: number;
  freeCount: number;
  reason: string;
}

const FindATime = ({ eventId }: { eventId: string }) => {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [duration, setDuration] = useState("60");
  const [participantCount, setParticipantCount] = useState(0);

  const find = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("find-a-time", {
        body: { eventId, durationMin: parseInt(duration) },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setSuggestions(data?.suggestions ?? []);
      setParticipantCount(data?.participantCount ?? 0);
      if (!data?.suggestions?.length) {
        toast.info("No se encontraron horarios donde todos coincidan. Prueba con otra duración.");
      } else {
        toast.success(`${data.suggestions.length} horarios sugeridos por la IA`);
      }
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Error al buscar horarios");
    } finally {
      setLoading(false);
    }
  };

  const exportIcs = (s: Suggestion) => {
    try {
      const start = nextOccurrenceLocal(s.day, s.start);
      const end = nextOccurrenceLocal(s.day, s.end);
      if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 0);
      downloadICS(`reunion-${s.dayName}-${s.start}.ics`, {
        title: `Reunión sugerida (${s.durationMin} min)`,
        description: s.reason,
        start, end,
      });
      toast.success(".ics descargado");
    } catch {
      toast.error("No se pudo generar el .ics");
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-foreground">Encontrar la mejor hora</h3>
        </div>
        <div className="flex items-center gap-2">
          <Select value={duration} onValueChange={setDuration} disabled={loading}>
            <SelectTrigger className="h-9 w-[120px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="30">30 minutos</SelectItem>
              <SelectItem value="60">1 hora</SelectItem>
              <SelectItem value="90">1.5 horas</SelectItem>
              <SelectItem value="120">2 horas</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={find} disabled={loading} size="sm">
            {loading ? (
              <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Analizando…</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-1.5" /> Find a Time</>
            )}
          </Button>
        </div>
      </div>

      {suggestions === null ? (
        <p className="text-sm text-muted-foreground">
          La IA analiza la disponibilidad de los participantes y propone los mejores horarios para reunirse.
        </p>
      ) : suggestions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay horarios donde todos estén libres con esa duración.</p>
      ) : (
        <ul className="space-y-2">
          {suggestions.map((s) => (
            <li key={`${s.day}-${s.start}`} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border border-border">
              <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold shrink-0">
                {s.rank}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Calendar className="h-3.5 w-3.5 text-primary" />
                  <p className="font-medium text-foreground text-sm">
                    {s.dayName} · {s.start} – {s.end}
                  </p>
                  <span className="text-[10px] uppercase tracking-wide bg-success/10 text-success px-1.5 py-0.5 rounded">
                    {s.freeCount}/{participantCount} libres
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{s.reason}</p>
              </div>
              <Button variant="ghost" size="sm" className="shrink-0" onClick={() => exportIcs(s)} aria-label="Descargar .ics">
                <Download className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default FindATime;
