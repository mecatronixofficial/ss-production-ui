export type MachineReportPeriod = "day" | "week" | "month" | "year" | "custom";
export type MachineReportRange = { from: string; to: string };

const iso = (date: Date) => date.toISOString().slice(0, 10);
const dateValue = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && iso(date) === value ? date : null;
};

/** Inclusive calendar ranges; a week starts on Monday. Date arithmetic stays independent of browser time zones. */
export function machineReportRange(period: MachineReportPeriod, anchor: string, custom: MachineReportRange): MachineReportRange | null {
  if (period === "custom") return dateValue(custom.from) && dateValue(custom.to) && custom.from <= custom.to ? custom : null;
  const date = dateValue(anchor);
  if (!date) return null;
  if (period === "day") return { from: anchor, to: anchor };
  if (period === "week") {
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    const from = iso(date);
    date.setUTCDate(date.getUTCDate() + 6);
    return { from, to: iso(date) };
  }
  if (period === "year") return { from: `${anchor.slice(0, 4)}-01-01`, to: `${anchor.slice(0, 4)}-12-31` };
  const from = `${anchor.slice(0, 7)}-01`;
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return { from, to: iso(date) };
}
