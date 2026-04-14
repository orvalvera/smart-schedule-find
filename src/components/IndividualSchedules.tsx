import { useState } from "react";
import { ChevronDown, ChevronRight, User } from "lucide-react";
import type { EventUser } from "@/pages/EventPage";

interface Props {
  users: EventUser[];
}

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const START_HOUR = 7;
const END_HOUR = 22;

const formatTime = (h: number, m: number) => {
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
};

const timeSlots: { hour: number; minute: number }[] = [];
for (let h = START_HOUR; h < END_HOUR; h++) {
  timeSlots.push({ hour: h, minute: 0 });
  timeSlots.push({ hour: h, minute: 30 });
}

const IndividualSchedules = ({ users }: Props) => {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (users.length === 0) return null;

  const getUserGrid = (user: EventUser) => {
    const grid: boolean[][] = timeSlots.map(() => Array(7).fill(false));
    for (const event of user.schedule) {
      const dayIdx = event.dayOfWeek - 1;
      if (dayIdx < 0 || dayIdx > 6) continue;
      const startMin = event.startHour * 60 + event.startMinute;
      const endMin = event.endHour * 60 + event.endMinute;
      for (let si = 0; si < timeSlots.length; si++) {
        const slotMin = timeSlots[si].hour * 60 + timeSlots[si].minute;
        const slotEnd = slotMin + 30;
        if (slotMin < endMin && slotEnd > startMin) {
          grid[si][dayIdx] = true;
        }
      }
    }
    return grid;
  };

  return (
    <div className="bg-card rounded-xl border border-border p-6">
      <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
        <User className="h-5 w-5 text-primary" />
        Horarios individuales
      </h3>
      <div className="space-y-2">
        {users.map((user) => {
          const isOpen = expanded === user.id;
          const grid = isOpen ? getUserGrid(user) : null;
          return (
            <div key={user.id} className="border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => setExpanded(isOpen ? null : user.id)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
              >
                <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-xs">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm font-medium text-foreground flex-1 text-left">
                  {user.name}
                </span>
                <span className="text-xs text-muted-foreground mr-2">{user.schedule.length} clases</span>
                {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </button>
              {isOpen && grid && (
                <div className="px-4 pb-4 overflow-x-auto">
                  <table className="w-full border-collapse min-w-[500px]">
                    <thead>
                      <tr>
                        <th className="w-16 text-[10px] font-medium text-muted-foreground text-left py-1" />
                        {DAYS.map((d) => (
                          <th key={d} className="text-[10px] font-semibold text-foreground text-center py-1 px-0.5">{d}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {timeSlots.map((slot, si) => (
                        <tr key={si}>
                          <td className="text-[9px] text-muted-foreground pr-1 py-0 align-top whitespace-nowrap">
                            {slot.minute === 0 ? formatTime(slot.hour, slot.minute) : ""}
                          </td>
                          {DAYS.map((_, di) => (
                            <td key={di} className="p-[1px]">
                              <div className={`h-3 rounded-[2px] ${grid[si][di] ? "bg-busy" : "bg-free-light"}`} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default IndividualSchedules;
