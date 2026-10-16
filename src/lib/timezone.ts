// SellerDoos runs on US Central Time (CST/CDT): "today", date ranges, daily buckets, schedules and order
// times all follow it, wherever the server runs. Set TZ to override (e.g. TZ=America/New_York).
export const APP_TIME_ZONE = "America/Chicago";

/** Today's date in the app's time zone, as yyyy-mm-dd (works in the browser and on the server). */
export const todayInAppZone = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE }).format(now);
