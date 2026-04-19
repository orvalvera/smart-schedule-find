import { useMemo, useState, useRef, useEffect } from "react";
import { BarChart3, Grid3X3, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { EventUser } from "@/pages/EventPage";
import { getISOWeek, getWeeksInYear, formatWeekLabel } from "@/lib/week";

interface Props {
  users: EventUser[];
  weekYear?: number;
  weekNumber?: number;
  onWeekChange?: (year: number, week: number) => void;
}

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const START_HOUR = 7;
const END_HOUR = 22;

const timeSlots: { hour: number; minute: number }[] = [];
for (let h = START_HOUR; h < END_HOUR; h++) {
  timeSlots.push({ hour: h, minute: 0 });
  timeSlots.push({ hour: h, minute: 30 });
}

const formatTime = (h: number, m: number) => {
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
};

interface TooltipData {
  x: number;
  y: number;
  slotIdx: number;
  dayIdx: number;
}

// Color ramp from "no availability" -> "everyone available"
// Uses HSL travelling from a soft red through amber to a vivid green.
const rampColor = (t: number): [number, number, number] => {
  // t in [0,1]; 0 = nobody free, 1 = everyone free
  const tt = Math.max(0, Math.min(1, t));
  // Hue: 8 (red) -> 45 (amber) -> 145 (green)
  const hue = tt < 0.5 ? 8 + (45 - 8) * (tt / 0.5) : 45 + (145 - 45) * ((tt - 0.5) / 0.5);
  const sat = 70 + tt * 15;
  const light = 88 - tt * 38; // lighter on the bad side, deeper on the good side
  return [hue, sat, light];
};

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
};

const AvailabilityGrid = ({ users, weekYear, weekNumber, onWeekChange }: Props) => {
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [heatmap, setHeatmap] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const heatmapWrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const today = useMemo(() => getISOWeek(new Date()), []);
  const year = weekYear ?? today.year;
  const week = weekNumber ?? today.week;
  const totalWeeks = useMemo(() => getWeeksInYear(year), [year]);

  const goPrev = () => {
    if (!onWeekChange) return;
    if (week <= 1) {
      const prevYear = year - 1;
      onWeekChange(prevYear, getWeeksInYear(prevYear));
    } else onWeekChange(year, week - 1);
  };
  const goNext = () => {
    if (!onWeekChange) return;
    if (week >= totalWeeks) onWeekChange(year + 1, 1);
    else onWeekChange(year, week + 1);
  };
  const goToday = () => onWeekChange?.(today.year, today.week);

  const grid = useMemo(() => {
    const totalUsers = users.length;
    const busyUsers: Set<string>[][] = timeSlots.map(() =>
      Array.from({ length: 7 }, () => new Set<string>())
    );

    for (const user of users) {
      for (const event of user.schedule) {
        const dayIdx = event.dayOfWeek - 1;
        if (dayIdx < 0 || dayIdx > 6) continue;
        const startMin = event.startHour * 60 + event.startMinute;
        const endMin = event.endHour * 60 + event.endMinute;
        for (let si = 0; si < timeSlots.length; si++) {
          const slotMin = timeSlots[si].hour * 60 + timeSlots[si].minute;
          const slotEnd = slotMin + 30;
          if (slotMin < endMin && slotEnd > startMin) {
            busyUsers[si][dayIdx].add(user.name);
          }
        }
      }
    }

    return { busyUsers, total: totalUsers };
  }, [users]);

  // Discrete cell style (fallback / "Discreto" mode)
  const getCellStyle = (busyCount: number) => {
    if (grid.total === 0) return "bg-free-light";
    const freeCount = grid.total - busyCount;
    const ratio = freeCount / grid.total;
    if (ratio === 1) return "bg-free";
    if (ratio >= 0.75) return "bg-free-medium";
    if (ratio >= 0.5) return "bg-free-light";
    if (ratio > 0) return "bg-busy-light";
    return "bg-busy";
  };

  // Smooth heatmap rendered via Canvas with bilinear interpolation between
  // slot centers. Produces continuous color transitions between adjacent
  // time cells and adjacent days, instead of solid rectangles.
  useEffect(() => {
    if (!heatmap) return;
    const canvas = canvasRef.current;
    const wrap = heatmapWrapRef.current;
    if (!canvas || !wrap) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = wrap.clientWidth;
    const cssH = wrap.clientHeight;
    if (cssW === 0 || cssH === 0) return;

    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const cols = 7;
    const rows = timeSlots.length;
    // Build a normalised availability field [0,1] per cell (1 = everyone free)
    const field: number[][] = [];
    for (let r = 0; r < rows; r++) {
      const row: number[] = [];
      for (let c = 0; c < cols; c++) {
        if (grid.total === 0) row.push(0.6);
        else row.push((grid.total - grid.busyUsers[r][c].size) / grid.total);
      }
      field.push(row);
    }

    // Render at lower resolution and let the canvas scale: still smooth and fast.
    const sampleW = Math.max(120, Math.floor(cssW / 2));
    const sampleH = Math.max(120, Math.floor(cssH / 2));
    const img = ctx.createImageData(sampleW, sampleH);

    const colW = sampleW / cols;
    const rowH = sampleH / rows;

    for (let py = 0; py < sampleH; py++) {
      // Map pixel to fractional grid coord (cell centers).
      const gy = py / rowH - 0.5;
      const r0 = Math.max(0, Math.min(rows - 1, Math.floor(gy)));
      const r1 = Math.max(0, Math.min(rows - 1, r0 + 1));
      const ty = Math.max(0, Math.min(1, gy - r0));

      for (let px = 0; px < sampleW; px++) {
        const gx = px / colW - 0.5;
        const c0 = Math.max(0, Math.min(cols - 1, Math.floor(gx)));
        const c1 = Math.max(0, Math.min(cols - 1, c0 + 1));
        const tx = Math.max(0, Math.min(1, gx - c0));

        const v00 = field[r0][c0];
        const v10 = field[r0][c1];
        const v01 = field[r1][c0];
        const v11 = field[r1][c1];
        // Bilinear interpolation.
        const v0 = v00 * (1 - tx) + v10 * tx;
        const v1 = v01 * (1 - tx) + v11 * tx;
        const v = v0 * (1 - ty) + v1 * ty;

        const [h, s, l] = rampColor(v);
        const [R, G, B] = hslToRgb(h, s, l);
        const idx = (py * sampleW + px) * 4;
        img.data[idx] = R;
        img.data[idx + 1] = G;
        img.data[idx + 2] = B;
        img.data[idx + 3] = 235;
      }
    }

    // Draw via offscreen canvas so the browser scales smoothly.
    const off = document.createElement("canvas");
    off.width = sampleW;
    off.height = sampleH;
    off.getContext("2d")!.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, 0, 0, cssW, cssH);
  }, [heatmap, grid, users.length]);

  // Re-render heatmap on resize.
  useEffect(() => {
    if (!heatmap) return;
    const obs = new ResizeObserver(() => {
      // trigger by toggling a tiny state? Simpler: just re-run effect via a small forceUpdate hack.
      // We dispatch a manual event; the effect above reads layout each call.
      const canvas = canvasRef.current;
      const wrap = heatmapWrapRef.current;
      if (!canvas || !wrap) return;
      // Re-run the same logic by dispatching a synthetic state change:
      setRenderTick((t) => t + 1);
    });
    if (heatmapWrapRef.current) obs.observe(heatmapWrapRef.current);
    return () => obs.disconnect();
  }, [heatmap]);

  const [renderTick, setRenderTick] = useState(0);
  useEffect(() => {
    // Re-run the canvas effect when tick changes by toggling a no-op dep.
    // We rely on the previous effect's dep list; force by reading layout again here.
    if (!heatmap) return;
    const canvas = canvasRef.current;
    const wrap = heatmapWrapRef.current;
    if (!canvas || !wrap) return;
    // Trigger by dispatching a microtask re-render:
    const id = requestAnimationFrame(() => {
      const evt = new Event("resize");
      window.dispatchEvent(evt);
    });
    return () => cancelAnimationFrame(id);
  }, [renderTick, heatmap]);

  const handleMouseEnter = (e: React.MouseEvent, slotIdx: number, dayIdx: number) => {
    if (grid.total === 0) return;
    const rect = containerRef.current?.getBoundingClientRect();
    const cellRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (!rect) return;
    setTooltip({
      x: cellRect.left - rect.left + cellRect.width / 2,
      y: cellRect.top - rect.top,
      slotIdx,
      dayIdx,
    });
  };

  const handleMouseLeave = () => setTooltip(null);

  const tooltipContent = useMemo(() => {
    if (!tooltip) return null;
    const busy = grid.busyUsers[tooltip.slotIdx][tooltip.dayIdx];
    const allNames = users.map((u) => u.name);
    const freeNames = allNames.filter((n) => !busy.has(n));
    const busyNames = allNames.filter((n) => busy.has(n));
    const slot = timeSlots[tooltip.slotIdx];
    return { freeNames, busyNames, time: `${DAYS[tooltip.dayIdx]} ${formatTime(slot.hour, slot.minute)}` };
  }, [tooltip, grid.busyUsers, users]);

  return (
    <div className="bg-card rounded-xl border border-border p-6 relative" ref={containerRef}>
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-semibold text-foreground">Disponibilidad grupal</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{formatWeekLabel(year, week)}</p>
          </div>
          {grid.total > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs gap-1"
              onClick={() => setHeatmap(!heatmap)}
            >
              {heatmap ? <Grid3X3 className="h-3.5 w-3.5" /> : <BarChart3 className="h-3.5 w-3.5" />}
              {heatmap ? "Discreto" : "Mapa de calor"}
            </Button>
          )}
        </div>

        {/* Week selector */}
        {onWeekChange && (
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={goPrev} aria-label="Semana anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Select value={String(week)} onValueChange={(v) => onWeekChange(year, parseInt(v))}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72 bg-popover">
                {Array.from({ length: totalWeeks }, (_, i) => i + 1).map((w) => (
                  <SelectItem key={w} value={String(w)} className="text-xs">
                    Semana {w}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(year)} onValueChange={(v) => onWeekChange(parseInt(v), Math.min(week, getWeeksInYear(parseInt(v))))}>
              <SelectTrigger className="h-8 w-[90px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                {[today.year - 1, today.year, today.year + 1].map((y) => (
                  <SelectItem key={y} value={String(y)} className="text-xs">{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={goNext} aria-label="Semana siguiente">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={goToday}>
              Hoy
            </Button>
          </div>
        )}

        {grid.total > 0 && (
          heatmap ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              <span>Pocos disponibles</span>
              <span
                className="h-2 w-40 rounded-full"
                style={{
                  background:
                    "linear-gradient(to right, hsl(8,80%,55%), hsl(45,85%,60%), hsl(145,75%,42%))",
                }}
              />
              <span>Todos disponibles</span>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-sm bg-free inline-block" /> Todos
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-sm bg-free-light inline-block" /> Algunos
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-sm bg-busy inline-block" /> Nadie
              </span>
            </div>
          )
        )}
      </div>

      <div className="overflow-x-auto -mx-6 px-6">
        <div className="min-w-[600px]">
          {/* Day header */}
          <div className="grid" style={{ gridTemplateColumns: "5rem repeat(7, minmax(0,1fr))" }}>
            <div />
            {DAYS.map((d) => (
              <div key={d} className="text-xs font-semibold text-foreground text-center py-2 px-1">
                {d}
              </div>
            ))}
          </div>

          {heatmap ? (
            // Continuous heatmap: canvas underneath, transparent hit-grid above
            <div
              className="grid relative"
              style={{ gridTemplateColumns: "5rem repeat(7, minmax(0,1fr))" }}
            >
              {/* Time labels column */}
              <div className="flex flex-col">
                {timeSlots.map((slot, si) => (
                  <div
                    key={si}
                    className="text-[10px] text-muted-foreground pr-2 leading-none"
                    style={{ height: 16 }}
                  >
                    {slot.minute === 0 ? formatTime(slot.hour, slot.minute) : ""}
                  </div>
                ))}
              </div>

              {/* Heatmap area spans the 7 day columns */}
              <div
                ref={heatmapWrapRef}
                className="relative col-span-7 rounded-md overflow-hidden"
                style={{ height: timeSlots.length * 16 }}
              >
                <canvas ref={canvasRef} className="absolute inset-0 block" />

                {/* Subtle horizontal divider lines every 30 minutes */}
                <div className="absolute inset-0 pointer-events-none">
                  {timeSlots.map((slot, si) => (
                    <div
                      key={si}
                      className="absolute left-0 right-0"
                      style={{
                        top: si * 16,
                        height: 1,
                        background:
                          slot.minute === 0
                            ? "hsl(var(--foreground) / 0.08)"
                            : "hsl(var(--foreground) / 0.04)",
                      }}
                    />
                  ))}
                </div>

                {/* Subtle day separators */}
                <div className="absolute inset-0 pointer-events-none flex">
                  {DAYS.map((_, di) => (
                    <div
                      key={di}
                      className="flex-1"
                      style={{
                        borderRight:
                          di < DAYS.length - 1
                            ? "1px solid hsl(var(--foreground) / 0.06)"
                            : undefined,
                      }}
                    />
                  ))}
                </div>

                {/* Invisible hit-grid for tooltips */}
                <div
                  className="absolute inset-0 grid"
                  style={{
                    gridTemplateColumns: "repeat(7, minmax(0,1fr))",
                    gridTemplateRows: `repeat(${timeSlots.length}, 16px)`,
                  }}
                >
                  {timeSlots.map((_, si) =>
                    DAYS.map((_, di) => (
                      <div
                        key={`${si}-${di}`}
                        onMouseEnter={(e) => handleMouseEnter(e, si, di)}
                        onMouseLeave={handleMouseLeave}
                        className="hover:ring-1 hover:ring-primary/40 hover:ring-inset cursor-pointer"
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            // Discrete grid mode (kept as fallback)
            <table className="w-full border-collapse">
              <tbody>
                {timeSlots.map((slot, si) => (
                  <tr key={si}>
                    <td
                      className="text-[10px] text-muted-foreground pr-2 py-0 align-top whitespace-nowrap"
                      style={{ width: "5rem" }}
                    >
                      {slot.minute === 0 ? formatTime(slot.hour, slot.minute) : ""}
                    </td>
                    {DAYS.map((_, di) => {
                      const busyCount = grid.busyUsers[si][di].size;
                      return (
                        <td key={di} className="p-[1px]">
                          <div
                            className={`h-4 rounded-[3px] transition-colors cursor-pointer hover:ring-2 hover:ring-primary/40 ${getCellStyle(
                              busyCount
                            )}`}
                            onMouseEnter={(e) => handleMouseEnter(e, si, di)}
                            onMouseLeave={handleMouseLeave}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {tooltip && tooltipContent && (
        <div
          className="absolute z-50 bg-popover border border-border rounded-lg shadow-lg p-3 pointer-events-none"
          style={{
            left: tooltip.x,
            top: tooltip.y - 8,
            transform: "translate(-50%, -100%)",
            minWidth: 180,
            maxWidth: 260,
          }}
        >
          <p className="text-xs font-semibold text-foreground mb-2">{tooltipContent.time}</p>
          {tooltipContent.freeNames.length > 0 && (
            <div className="mb-1.5">
              <p className="text-[10px] font-medium text-success uppercase tracking-wide mb-0.5">
                Libres ({tooltipContent.freeNames.length})
              </p>
              <p className="text-xs text-foreground">{tooltipContent.freeNames.join(", ")}</p>
            </div>
          )}
          {tooltipContent.busyNames.length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-busy uppercase tracking-wide mb-0.5">
                Ocupados ({tooltipContent.busyNames.length})
              </p>
              <p className="text-xs text-foreground">{tooltipContent.busyNames.join(", ")}</p>
            </div>
          )}
        </div>
      )}

      {grid.total === 0 && (
        <p className="text-sm text-muted-foreground text-center mt-4">
          Sube un horario para ver la disponibilidad del grupo
        </p>
      )}
    </div>
  );
};

export default AvailabilityGrid;
