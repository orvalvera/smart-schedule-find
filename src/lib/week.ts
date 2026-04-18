// ISO week helpers (week 1-53, Monday as first day)
export function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

// Get Monday (start) and Sunday (end) of a given ISO week+year
export function getDateRangeForWeek(year: number, week: number): { start: Date; end: Date } {
  const jan4 = new Date(year, 0, 4);
  const jan4Day = jan4.getDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4Day + 1);
  const start = new Date(week1Monday);
  start.setDate(week1Monday.getDate() + (week - 1) * 7);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function getWeeksInYear(year: number): number {
  const dec28 = new Date(year, 11, 28);
  return getISOWeek(dec28).week;
}

export function formatWeekLabel(year: number, week: number): string {
  const { start, end } = getDateRangeForWeek(year, week);
  const fmt = (d: Date) => d.toLocaleDateString("es", { day: "2-digit", month: "short" });
  return `Semana ${week} · ${fmt(start)} – ${fmt(end)}`;
}
