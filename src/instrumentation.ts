// Starts the daily rank-check scheduler when the Node.js server boots (`npm run dev` or `npm start`).
// Every 5 minutes it collects finished DataForSEO searches, and runs the daily job once the scheduled
// hour has passed and today's run hasn't happened.
// The app has to be running for checks to happen; see README for keeping it running.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // The whole server works in US Central Time unless TZ says otherwise (Render runs in UTC).
  if (!process.env.TZ) {
    const { APP_TIME_ZONE } = await import("./lib/timezone");
    process.env.TZ = APP_TIME_ZONE;
  }
  if (process.env.DISABLE_SCHEDULER === "true") return;

  const globalForScheduler = globalThis as unknown as { sellerdoosScheduler?: NodeJS.Timeout };
  if (globalForScheduler.sellerdoosScheduler) return;

  const { schedulerTick } = await import("./lib/jobs");
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await schedulerTick();
    } catch (error) {
      console.error("[SellerDoos] scheduled run failed:", error);
    } finally {
      running = false;
    }
  };

  globalForScheduler.sellerdoosScheduler = setInterval(tick, 5 * 60 * 1000);
  setTimeout(tick, 10_000);
}
