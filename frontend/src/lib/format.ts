const money = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" });
const number = new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 2 });
const day = new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", year: "numeric" });
const month = new Intl.DateTimeFormat("en-ZA", { month: "short", year: "numeric" });
const dayTime = new Intl.DateTimeFormat("en-ZA", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatMoney = (value: number) => money.format(value);
export const formatNumber = (value: number) => number.format(value);
/** A full timestamp from the API, e.g. "30 Nov 2026, 08:00". */
export const formatDateTime = (iso: string) => dayTime.format(new Date(iso));

/** "2026-03-14" → "14 Mar 2026". Parsed as a local date, never shifted by timezone. */
export const formatDate = (iso: string) => day.format(parseLocal(iso));

/** "2026-03-01" or "2026-03" → "Mar 2026". */
export const formatMonth = (iso: string) =>
  month.format(parseLocal(iso.length === 7 ? `${iso}-01` : iso));

export function parseLocal(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const today = () => toIso(new Date());
export const thisMonth = () => today().slice(0, 7);
