/** Today's date (YYYY-MM-DD) in the local time zone. */
export const today = () => new Date().toLocaleDateString("en-CA");

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
