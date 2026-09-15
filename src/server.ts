/**
 * Long-lived process entry point. `npm start` runs this.
 *
 * The polling services live here rather than in the app, because they are
 * timers: startEventMonitor sets a 10-second interval and scheduleWaveAutomation
 * sets a timer days out. In a serverless runtime a timer is either killed with
 * the invocation or keeps the function billing, and a fresh one would be armed
 * on every cold start. They belong to a process that stays up.
 */
import app from './app';
import { startEventMonitor } from './services/eventMonitor';
import { scheduleWaveAutomation } from './services/waveAutomation';

const PORT = Number(process.env.PORT) || 8080;

app.listen(PORT, () => {
  console.log(`StellarShield backend listening on ${PORT}`);
  startEventMonitor();
  scheduleWaveAutomation();
});
