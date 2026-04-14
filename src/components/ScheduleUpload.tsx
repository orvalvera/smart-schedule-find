import { useState, useRef, useCallback } from "react";
import { Upload, Loader2, ImageIcon, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { ScheduleEvent } from "@/pages/EventPage";

interface Props {
  eventId: string;
  onScheduleAdded: () => void;
}

function parseICS(text: string): ScheduleEvent[] {
  const events: ScheduleEvent[] = [];
  const vevents = text.split("BEGIN:VEVENT");

  for (let i = 1; i < vevents.length; i++) {
    const block = vevents[i].split("END:VEVENT")[0];

    const summary = block.match(/SUMMARY[^:]*:(.*)/)?.[1]?.trim() || "Sin título";

    // Match DTSTART with optional TZID or Z suffix
    const dtStartMatch = block.match(/DTSTART[^:]*:(\d{8}T\d{6})/);
    const dtEndMatch = block.match(/DTEND[^:]*:(\d{8}T\d{6})/);

    // Also handle RRULE for recurring events
    const rruleMatch = block.match(/RRULE[^:]*:(.*)/);
    const bydayMatch = rruleMatch?.[1]?.match(/BYDAY=([A-Z,]+)/);

    if (!dtStartMatch || !dtEndMatch) continue;

    const startStr = dtStartMatch[1];
    const endStr = dtEndMatch[1];

    const startHour = parseInt(startStr.substring(9, 11));
    const startMinute = parseInt(startStr.substring(11, 13));
    const endHour = parseInt(endStr.substring(9, 11));
    const endMinute = parseInt(endStr.substring(11, 13));

    // Map day abbreviations to dayOfWeek (1=Mon, 7=Sun)
    const dayMap: Record<string, number> = {
      MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7,
    };

    if (bydayMatch) {
      // Recurring: create event for each day
      const days = bydayMatch[1].split(",");
      for (const d of days) {
        const dow = dayMap[d];
        if (dow) {
          events.push({ title: summary, dayOfWeek: dow, startHour, startMinute, endHour, endMinute });
        }
      }
    } else {
      // Single event: derive day from date
      const year = parseInt(startStr.substring(0, 4));
      const month = parseInt(startStr.substring(4, 6)) - 1;
      const day = parseInt(startStr.substring(6, 8));
      const date = new Date(year, month, day);
      let dow = date.getDay(); // 0=Sun
      dow = dow === 0 ? 7 : dow; // Convert to 1=Mon, 7=Sun
      events.push({ title: summary, dayOfWeek: dow, startHour, startMinute, endHour, endMinute });
    }
  }

  return events;
}

const ScheduleUpload = ({ eventId, onScheduleAdded }: Props) => {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [icsFile, setIcsFile] = useState<File | null>(null);
  const [icsEvents, setIcsEvents] = useState<ScheduleEvent[]>([]);
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [tab, setTab] = useState("photo");
  const inputRef = useRef<HTMLInputElement>(null);
  const icsInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    if (!f.type.startsWith("image/")) {
      toast.error("Solo se aceptan imágenes (JPG, PNG)");
      return;
    }
    setFile(f);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(f);
  };

  const handleIcsFile = (f: File) => {
    if (!f.name.endsWith(".ics") && f.type !== "text/calendar") {
      toast.error("Solo se aceptan archivos .ics");
      return;
    }
    setIcsFile(f);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseICS(text);
      setIcsEvents(parsed);
      if (parsed.length === 0) {
        toast.warning("No se detectaron eventos en el archivo .ics");
      } else {
        toast.success(`${parsed.length} eventos detectados`);
      }
    };
    reader.readAsText(f);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    if (tab === "ics") {
      handleIcsFile(f);
    } else {
      handleFile(f);
    }
  }, [tab]);

  const submitPhoto = async () => {
    if (!name.trim()) { toast.error("Escribe tu nombre"); return; }
    if (!file || !preview) { toast.error("Sube una imagen de tu horario"); return; }

    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke("process-schedule", {
        body: { imageBase64: preview },
      });
      if (error) throw error;
      const schedule = data?.events || [];
      if (schedule.length === 0) {
        toast.warning("No se detectaron clases en la imagen. Intenta con otra foto.");
        setProcessing(false);
        return;
      }
      const { error: insertError } = await supabase.from("event_users").insert({
        event_id: eventId, name: name.trim(), schedule,
      });
      if (insertError) throw insertError;
      toast.success(`¡Horario de ${name} agregado! (${schedule.length} clases detectadas)`);
      setName(""); setFile(null); setPreview(null);
      onScheduleAdded();
    } catch (err) {
      console.error(err);
      toast.error("Error al procesar el horario. Intenta de nuevo.");
    } finally {
      setProcessing(false);
    }
  };

  const submitIcs = async () => {
    if (!name.trim()) { toast.error("Escribe tu nombre"); return; }
    if (icsEvents.length === 0) { toast.error("Sube un archivo .ics con eventos"); return; }

    setProcessing(true);
    try {
      const { error: insertError } = await supabase.from("event_users").insert({
        event_id: eventId, name: name.trim(), schedule: icsEvents,
      });
      if (insertError) throw insertError;
      toast.success(`¡Horario de ${name} agregado! (${icsEvents.length} eventos importados)`);
      setName(""); setIcsFile(null); setIcsEvents([]);
      onScheduleAdded();
    } catch (err) {
      console.error(err);
      toast.error("Error al guardar el horario.");
    } finally {
      setProcessing(false);
    }
  };

  const DAYS = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  const formatTime = (h: number, m: number) => `${h}:${m.toString().padStart(2, "0")}`;

  return (
    <div className="bg-card rounded-xl border border-border p-6 space-y-4">
      <h3 className="font-semibold text-foreground flex items-center gap-2">
        <Upload className="h-5 w-5 text-primary" />
        Sube tu horario
      </h3>

      <Input
        placeholder="Tu nombre"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={processing}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full">
          <TabsTrigger value="photo" className="flex-1 gap-1">
            <ImageIcon className="h-4 w-4" /> Foto
          </TabsTrigger>
          <TabsTrigger value="ics" className="flex-1 gap-1">
            <CalendarDays className="h-4 w-4" /> Calendario (.ics)
          </TabsTrigger>
        </TabsList>

        <TabsContent value="photo" className="space-y-4 mt-4">
          <div
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
              dragging ? "border-primary bg-accent" : "border-border hover:border-primary/50"
            }`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input ref={inputRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            {preview ? (
              <div className="space-y-3">
                <img src={preview} alt="Preview" className="max-h-40 mx-auto rounded-lg object-contain" />
                <p className="text-sm text-muted-foreground">{file?.name}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <ImageIcon className="h-10 w-10 text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">Arrastra una imagen o haz clic para seleccionar</p>
                <p className="text-xs text-muted-foreground">JPG, PNG</p>
              </div>
            )}
          </div>
          <Button className="w-full" onClick={submitPhoto} disabled={processing || !file || !name.trim()}>
            {processing ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />La IA está leyendo tu horario...</>) : "Enviar horario"}
          </Button>
        </TabsContent>

        <TabsContent value="ics" className="space-y-4 mt-4">
          <div
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
              dragging ? "border-primary bg-accent" : "border-border hover:border-primary/50"
            }`}
            onClick={() => icsInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input ref={icsInputRef} type="file" accept=".ics,text/calendar" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleIcsFile(f); }} />
            {icsFile ? (
              <div className="space-y-3">
                <CalendarDays className="h-10 w-10 text-primary mx-auto" />
                <p className="text-sm font-medium text-foreground">{icsFile.name}</p>
                <p className="text-sm text-muted-foreground">{icsEvents.length} eventos detectados</p>
              </div>
            ) : (
              <div className="space-y-2">
                <CalendarDays className="h-10 w-10 text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">Arrastra un archivo .ics o haz clic para seleccionar</p>
                <p className="text-xs text-muted-foreground">
                  Exporta tu calendario desde Google Calendar, Outlook, etc.
                </p>
              </div>
            )}
          </div>

          {icsEvents.length > 0 && (
            <div className="max-h-48 overflow-y-auto space-y-1 bg-muted rounded-lg p-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">Eventos detectados:</p>
              {icsEvents.map((ev, i) => (
                <div key={i} className="text-xs text-foreground flex justify-between px-2 py-1 bg-card rounded">
                  <span className="font-medium truncate mr-2">{ev.title}</span>
                  <span className="text-muted-foreground shrink-0">
                    {DAYS[ev.dayOfWeek]} {formatTime(ev.startHour, ev.startMinute)}-{formatTime(ev.endHour, ev.endMinute)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium">¿Cómo exportar tu calendario?</p>
            <p>• <strong>Google Calendar:</strong> Ajustes → Importar y exportar → Exportar</p>
            <p>• <strong>Outlook:</strong> Calendario → Compartir → Exportar calendario (.ics)</p>
            <p>• <strong>Apple Calendar:</strong> Archivo → Exportar → Exportar...</p>
          </div>

          <Button className="w-full" onClick={submitIcs} disabled={processing || icsEvents.length === 0 || !name.trim()}>
            {processing ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Guardando...</>) : `Enviar horario (${icsEvents.length} eventos)`}
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ScheduleUpload;
