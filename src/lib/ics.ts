// Generate a downloadable .ics (iCalendar) string for a single event
// and trigger a browser download.

function pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }

function toICSDate(d: Date): string {
  // Local time floating (no Z) to avoid timezone confusion across calendars
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function toICSDateUTC(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

export interface ICSEvent {
  title: string;
  description?: string;
  start: Date;
  end: Date;
  location?: string;
}

export function buildICS(evt: ICSEvent): string {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@smart-schedule`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Smart Schedule//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toICSDateUTC(new Date())}`,
    `DTSTART:${toICSDate(evt.start)}`,
    `DTEND:${toICSDate(evt.end)}`,
    `SUMMARY:${escapeICS(evt.title)}`,
    evt.description ? `DESCRIPTION:${escapeICS(evt.description)}` : "",
    evt.location ? `LOCATION:${escapeICS(evt.location)}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}

function escapeICS(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

export function downloadICS(filename: string, evt: ICSEvent) {
  const blob = new Blob([buildICS(evt)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".ics") ? filename : `${filename}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Compute next date (in local time) where weekday matches dayOfWeek (0=Mon..6=Sun
// following ISO convention used in the app) at given HH:mm.
export function nextOccurrenceLocal(dayOfWeek: number, hhmm: string, from = new Date()): Date {
  const [h, m] = hhmm.split(":").map(Number);
  // JS getDay: 0=Sun..6=Sat. App uses 0=Mon..6=Sun. Convert app day -> js day:
  const targetJS = (dayOfWeek + 1) % 7; // Mon(0)->1, Sun(6)->0
  const d = new Date(from);
  d.setHours(h, m, 0, 0);
  const diff = (targetJS - d.getDay() + 7) % 7;
  if (diff === 0 && d.getTime() < from.getTime()) d.setDate(d.getDate() + 7);
  else d.setDate(d.getDate() + diff);
  return d;
}