import { useState, useRef, useCallback, useMemo } from "react";
import { Upload, Loader2, ImageIcon, CalendarDays, Filter, Link as LinkIcon, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useAuth } from "@/contexts/AuthContext";
import type { ScheduleEvent } from "@/pages/EventPage";

interface Props {
  eventId: string;
  onScheduleAdded: () => void;
}

interface RawICSEvent extends ScheduleEvent {
  date?: Date;
}

function parseICSRaw(text: string): RawICSEvent[] {
  const events: RawICSEvent[] = [];
  const vevents = text.split("BEGIN:VEVENT");

  for (let i = 1; i < vevents.length; i++) {
    const block = vevents[i].split("END:VEVENT")[0];
    const summary = block.match(/SUMMARY[^:]*:(.*)/)?.[1]?.trim() || "Sin título";
    const dtStartMatch = block.match(/DTSTART[^:]*:(\d{8}T\d{6})/);
    const dtEndMatch = block.match(/DTEND[^:]*:(\d{8}T\d{6})/);
    const rruleMatch = block.match(/RRULE[^:]*:(.*)/);
    const bydayMatch = rruleMatch?.[1]?.match(/BYDAY=([A-Z,]+)/);

    if (!dtStartMatch || !dtEndMatch) continue;

    const startStr = dtStartMatch[1];
    const endStr = dtEndMatch[1];
    const startHour = parseInt(startStr.substring(9, 11));
    const startMinute = parseInt(startStr.substring(11, 13));
    const endHour = parseInt(endStr.substring(9, 11));
    const endMinute = parseInt(endStr.substring(11, 13));

    const dayMap: Record<string, number> = {
      MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7,
    };

    const year = parseInt(startStr.substring(0, 4));
    const month = parseInt(startStr.substring(4, 6)) - 1;
    const day = parseInt(startStr.substring(6, 8));
    const date = new Date(year, month, day);

    if (bydayMatch) {
      const days = bydayMatch[1].split(",");
      for (const d of days) {
        const dow = dayMap[d];
        if (dow) {
          events.push({ title: summary, dayOfWeek: dow, startHour, startMinute, endHour, endMinute, date });
        }
      }
    } else {
      let dow = date.getDay();
      dow = dow === 0 ? 7 : dow;
      events.push({ title: summary, dayOfWeek: dow, startHour, startMinute, endHour, endMinute, date });
    }
  }

  return events;
}

const DAYS_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const ScheduleUpload = ({ eventId, onScheduleAdded }: Props) => {
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [icsFile, setIcsFile] = useState<File | null>(null);
  const [rawIcsEvents, setRawIcsEvents] = useState<RawICSEvent[]>([]);
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [tab, setTab] = useState("photo");
  const inputRef = useRef<HTMLInputElement>(null);
  const icsInputRef = useRef<HTMLInputElement>(null);

  // Filters
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);

  // Google Calendar
  const [gcalConnected, setGcalConnected] = useState<boolean>(false);
  const [gcalChecking, setGcalChecking] = useState(true);
  const [gcalDateFrom, setGcalDateFrom] = useState<Date | undefined>(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return d;
  });
  const [gcalDateTo, setGcalDateTo] = useState<Date | undefined>(() => {
    const d = new Date(); d.setDate(d.getDate() + 30); return d;
  });

  // Check Google Calendar connection on mount
  useMemo(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("google_calendar_tokens")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      setGcalConnected(!!data);
      setGcalChecking(false);
    })();
  }, [user]);

  const connectGoogleCalendar = async () => {
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
    }
  };

  const disconnectGoogleCalendar = async () => {
    if (!user) return;
    const { error } = await supabase
      .from("google_calendar_tokens")
      .delete()
      .eq("user_id", user.id);
    if (error) { toast.error("Error al desconectar"); return; }
    setGcalConnected(false);
    toast.success("Google Calendar desconectado");
  };

  const importFromGoogleCalendar = async () => {
    if (!name.trim()) { toast.error("Escribe tu nombre"); return; }
    if (!gcalDateFrom || !gcalDateTo) { toast.error("Selecciona un rango de fechas"); return; }
    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke("google-calendar-events", {
        body: { startDate: gcalDateFrom.toISOString(), endDate: gcalDateTo.toISOString() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const schedule = data?.schedule || [];
      if (schedule.length === 0) {
        toast.warning("No se encontraron eventos en ese rango");
        setProcessing(false);
        return;
      }
      const { error: insertError } = await supabase.from("event_users").insert({
        event_id: eventId, name: name.trim(), schedule, user_id: user?.id,
      });
      if (insertError) throw insertError;
      toast.success(`¡Horario agregado! (${schedule.length} eventos importados)`);
      setName("");
      onScheduleAdded();
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Error al importar";
      toast.error(msg);
    } finally {
      setProcessing(false);
    }
  };

  const toggleDay = (d: number) => {
    setSelectedDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
    );
  };

  const filteredIcsEvents = useMemo(() => {
    return rawIcsEvents.filter((ev) => {
      if (!selectedDays.includes(ev.dayOfWeek)) return false;
      if (ev.date) {
        if (dateFrom && ev.date < dateFrom) return false;
        if (dateTo) {
          const end = new Date(dateTo);
          end.setHours(23, 59, 59);
          if (ev.date > end) return false;
        }
      }
      return true;
    });
  }, [rawIcsEvents, selectedDays, dateFrom, dateTo]);

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
      const parsed = parseICSRaw(text);
      setRawIcsEvents(parsed);
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
    if (tab === "ics") handleIcsFile(f);
    else handleFile(f);
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
        event_id: eventId, name: name.trim(), schedule, user_id: user?.id,
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
    if (filteredIcsEvents.length === 0) { toast.error("No hay eventos con los filtros seleccionados"); return; }
    setProcessing(true);
    try {
      // Strip date field before saving
      const cleanEvents: ScheduleEvent[] = filteredIcsEvents.map(({ date: _, ...rest }) => rest);
      const { error: insertError } = await supabase.from("event_users").insert({
        event_id: eventId, name: name.trim(), schedule: cleanEvents as unknown as import("@/integrations/supabase/types").Json, user_id: user?.id,
      });
      if (insertError) throw insertError;
      toast.success(`¡Horario de ${name} agregado! (${cleanEvents.length} eventos importados)`);
      setName(""); setIcsFile(null); setRawIcsEvents([]);
      setDateFrom(undefined); setDateTo(undefined); setSelectedDays([1, 2, 3, 4, 5, 6, 7]);
      onScheduleAdded();
    } catch (err) {
      console.error(err);
      toast.error("Error al guardar el horario.");
    } finally {
      setProcessing(false);
    }
  };

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
            <CalendarDays className="h-4 w-4" /> .ics
          </TabsTrigger>
          <TabsTrigger value="google" className="flex-1 gap-1">
            <LinkIcon className="h-4 w-4" /> Google
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
                <p className="text-sm text-muted-foreground">{rawIcsEvents.length} eventos en archivo</p>
              </div>
            ) : (
              <div className="space-y-2">
                <CalendarDays className="h-10 w-10 text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">Arrastra un archivo .ics o haz clic para seleccionar</p>
                <p className="text-xs text-muted-foreground">Exporta tu calendario desde Google Calendar, Outlook, etc.</p>
              </div>
            )}
          </div>

          {/* Filters - shown after file upload */}
          {rawIcsEvents.length > 0 && (
            <div className="bg-muted/50 rounded-xl border border-border p-4 space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Filter className="h-4 w-4 text-primary" />
                Filtrar eventos
              </div>

              {/* Date range */}
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium">Rango de fechas</p>
                <div className="flex gap-2 flex-wrap">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className={cn("text-xs", !dateFrom && "text-muted-foreground")}>
                        <CalendarDays className="h-3 w-3 mr-1" />
                        {dateFrom ? format(dateFrom, "dd MMM yyyy", { locale: es }) : "Desde"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} className={cn("p-3 pointer-events-auto")} />
                    </PopoverContent>
                  </Popover>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className={cn("text-xs", !dateTo && "text-muted-foreground")}>
                        <CalendarDays className="h-3 w-3 mr-1" />
                        {dateTo ? format(dateTo, "dd MMM yyyy", { locale: es }) : "Hasta"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={dateTo} onSelect={setDateTo} className={cn("p-3 pointer-events-auto")} />
                    </PopoverContent>
                  </Popover>
                  {(dateFrom || dateTo) && (
                    <Button variant="ghost" size="sm" className="text-xs" onClick={() => { setDateFrom(undefined); setDateTo(undefined); }}>
                      Limpiar
                    </Button>
                  )}
                </div>
              </div>

              {/* Day of week filter */}
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium">Días de la semana</p>
                <div className="flex gap-1.5 flex-wrap">
                  {DAYS_LABELS.map((label, idx) => {
                    const dayNum = idx + 1;
                    const active = selectedDays.includes(dayNum);
                    return (
                      <button
                        key={dayNum}
                        onClick={() => toggleDay(dayNum)}
                        className={cn(
                          "px-2.5 py-1 rounded-md text-xs font-medium transition-colors border",
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-card text-muted-foreground border-border hover:border-primary/50"
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                {filteredIcsEvents.length} de {rawIcsEvents.length} eventos seleccionados
              </p>
            </div>
          )}

          {filteredIcsEvents.length > 0 && (
            <div className="max-h-48 overflow-y-auto space-y-1 bg-muted rounded-lg p-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">Eventos seleccionados:</p>
              {filteredIcsEvents.map((ev, i) => (
                <div key={i} className="text-xs text-foreground flex justify-between px-2 py-1 bg-card rounded">
                  <span className="font-medium truncate mr-2">{ev.title}</span>
                  <span className="text-muted-foreground shrink-0">
                    {DAYS_LABELS[ev.dayOfWeek - 1]} {formatTime(ev.startHour, ev.startMinute)}-{formatTime(ev.endHour, ev.endMinute)}
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

          <Button className="w-full" onClick={submitIcs} disabled={processing || filteredIcsEvents.length === 0 || !name.trim()}>
            {processing ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Guardando...</>) : `Enviar horario (${filteredIcsEvents.length} eventos)`}
          </Button>
        </TabsContent>

        <TabsContent value="google" className="space-y-4 mt-4">
          {gcalChecking ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !gcalConnected ? (
            <div className="border-2 border-dashed border-border rounded-xl p-8 text-center space-y-4">
              <LinkIcon className="h-10 w-10 text-muted-foreground mx-auto" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Conecta tu Google Calendar</p>
                <p className="text-xs text-muted-foreground">
                  Importa tus eventos automáticamente. Solo permiso de lectura.
                </p>
              </div>
              <Button onClick={connectGoogleCalendar} className="w-full">
                <LinkIcon className="h-4 w-4 mr-2" />
                Conectar Google Calendar
              </Button>
            </div>
          ) : (
            <>
              <div className="bg-muted/50 rounded-xl border border-border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <span className="h-2 w-2 rounded-full bg-primary" />
                    Google Calendar conectado
                  </div>
                  <Button variant="ghost" size="sm" onClick={disconnectGoogleCalendar} className="text-xs">
                    <Unlink className="h-3 w-3 mr-1" /> Desconectar
                  </Button>
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground font-medium">Rango de fechas a importar</p>
                  <div className="flex gap-2 flex-wrap">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className={cn("text-xs", !gcalDateFrom && "text-muted-foreground")}>
                          <CalendarDays className="h-3 w-3 mr-1" />
                          {gcalDateFrom ? format(gcalDateFrom, "dd MMM yyyy", { locale: es }) : "Desde"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={gcalDateFrom} onSelect={setGcalDateFrom} className={cn("p-3 pointer-events-auto")} />
                      </PopoverContent>
                    </Popover>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className={cn("text-xs", !gcalDateTo && "text-muted-foreground")}>
                          <CalendarDays className="h-3 w-3 mr-1" />
                          {gcalDateTo ? format(gcalDateTo, "dd MMM yyyy", { locale: es }) : "Hasta"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={gcalDateTo} onSelect={setGcalDateTo} className={cn("p-3 pointer-events-auto")} />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              </div>

              <Button className="w-full" onClick={importFromGoogleCalendar} disabled={processing || !name.trim()}>
                {processing ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Importando eventos...</>
                ) : (
                  <>Importar eventos de Google Calendar</>
                )}
              </Button>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ScheduleUpload;
