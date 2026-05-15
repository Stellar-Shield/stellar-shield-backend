import { sorobanServer, CONTRACT_IDS, fetchContractEvents } from '../lib/soroban';
import { cacheEvents } from '../lib/redis';

const POLL_INTERVAL_MS = 10_000; // 10 s — ~2 ledgers

let lastLedger = 0;

async function poll() {
  try {
    if (lastLedger === 0) {
      const latest = await sorobanServer.getLatestLedger();
      // Start from 1000 ledgers back to catch recent history
      lastLedger = Math.max(0, latest.sequence - 1000);
    }

    const contractIds = [CONTRACT_IDS.guard, CONTRACT_IDS.registry, CONTRACT_IDS.auth].filter(Boolean);
    if (contractIds.length === 0) return;

    for (const contractId of contractIds) {
      const events = await fetchContractEvents(contractId, lastLedger);

      if (events.length > 0) {
        await cacheEvents(`monitor:${contractId}`, events);

        for (const event of events) {
          const topics = event.topic.map((t) => t.toString());
          console.log(`[event-monitor] contract=${contractId} topics=${topics.join(',')} ledger=${event.ledger}`);

          // Alert on velocity limit exceeded
          if (topics.some((t) => t.includes('velocity') || t.includes('exceeded'))) {
            console.warn(`[event-monitor] ⚠️  VelocityExceeded event detected at ledger ${event.ledger}`);
            // TODO: push notification to user (FCM / WebPush)
          }
        }
      }
    }

    // Advance cursor to latest ledger
    const latest = await sorobanServer.getLatestLedger();
    lastLedger = latest.sequence;
  } catch (err: any) {
    console.error('[event-monitor] poll error:', err.message);
  }
}

export function startEventMonitor() {
  if (!CONTRACT_IDS.guard && !CONTRACT_IDS.registry && !CONTRACT_IDS.auth) {
    console.warn('[event-monitor] No contract IDs configured — skipping monitor');
    return;
  }
  console.log('[event-monitor] Starting Stellar event monitor');
  poll();
  setInterval(poll, POLL_INTERVAL_MS);
}
