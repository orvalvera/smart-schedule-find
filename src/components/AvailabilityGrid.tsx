import { useMemo, useState, useRef } from "react";
import type { EventUser } from "@/pages/EventPage";

interface Props {
  users: EventUser[];
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

const AvailabilityGrid = ({ users }: Props) => {
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const grid = useMemo(() => {
    const totalUsers = users.length;
    // busyUsers[slotIndex][dayIndex] = set of user names busy
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
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-foreground">Disponibilidad grupal</h3>
        {grid.total > 0 && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
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
        )}
      </div>

      <div className="overflow-x-auto -mx-6 px-6">
        <table className="w-full border-collapse min-w-[600px]">
          <thead>
            <tr>
              <th className="w-20 text-xs font-medium text-muted-foreground text-left py-2" />
              {DAYS.map((d) => (
                <th key={d} className="text-xs font-semibold text-foreground text-center py-2 px-1">{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {timeSlots.map((slot, si) => (
              <tr key={si}>
                <td className="text-[10px] text-muted-foreground pr-2 py-0 align-top whitespace-nowrap">
                  {slot.minute === 0 ? formatTime(slot.hour, slot.minute) : ""}
                </td>
                {DAYS.map((_, di) => (
                  <td key={di} className="p-[1px]">
                    <div
                      className={`h-4 rounded-[3px] transition-colors cursor-pointer hover:ring-2 hover:ring-primary/40 ${getCellStyle(
                        grid.busyUsers[si][di].size
                      )}`}
                      onMouseEnter={(e) => handleMouseEnter(e, si, di)}
                      onMouseLeave={handleMouseLeave}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tooltip */}
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
