import { useState, useRef, useCallback } from "react";
import { Upload, Loader2, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  eventId: string;
  onScheduleAdded: () => void;
}

const ScheduleUpload = ({ eventId, onScheduleAdded }: Props) => {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, []);

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Escribe tu nombre");
      return;
    }
    if (!file || !preview) {
      toast.error("Sube una imagen de tu horario");
      return;
    }

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
        event_id: eventId,
        name: name.trim(),
        schedule,
      });

      if (insertError) throw insertError;

      toast.success(`¡Horario de ${name} agregado! (${schedule.length} clases detectadas)`);
      setName("");
      setFile(null);
      setPreview(null);
      onScheduleAdded();
    } catch (err) {
      console.error(err);
      toast.error("Error al procesar el horario. Intenta de nuevo.");
    } finally {
      setProcessing(false);
    }
  };

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

      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          dragging
            ? "border-primary bg-accent"
            : "border-border hover:border-primary/50"
        }`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />

        {preview ? (
          <div className="space-y-3">
            <img
              src={preview}
              alt="Preview"
              className="max-h-40 mx-auto rounded-lg object-contain"
            />
            <p className="text-sm text-muted-foreground">{file?.name}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <ImageIcon className="h-10 w-10 text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">
              Arrastra una imagen o haz clic para seleccionar
            </p>
            <p className="text-xs text-muted-foreground">JPG, PNG</p>
          </div>
        )}
      </div>

      <Button
        className="w-full"
        onClick={submit}
        disabled={processing || !file || !name.trim()}
      >
        {processing ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            La IA está leyendo tu horario...
          </>
        ) : (
          "Enviar horario"
        )}
      </Button>
    </div>
  );
};

export default ScheduleUpload;
