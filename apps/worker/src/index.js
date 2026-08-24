require("dotenv").config();
const cron = require("node-cron");
require("./telegram-bot"); // starts polling for /start (account linking) as a side effect
const { runScanPass } = require("./scan");

const schedule = process.env.SCAN_CRON || "*/5 * * * *";

console.log(`Scanner worker starting, schedule: ${schedule}`);

cron.schedule(schedule, () => {
  runScanPass().catch((err) => console.error("Scan pass failed:", err));
});

// Run one pass immediately on boot too, don't wait for the first cron tick.
runScanPass().catch((err) => console.error("Initial scan pass failed:", err));
