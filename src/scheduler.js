// Scheduler — the in-process poll loop (ADR-0007). Runs one pipeline `tick`
// on a cadence, broadcasts the resulting change-diffs over SSE, and republishes
// the on-disk artefacts (dashboard.html + snapshot.json). Backs off on error so
// a flaky feed doesn't hammer the Source or crash the process (user story 25).

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tick } from './pipeline.js';
import { renderDashboardHtml, renderSnapshot, toClientIncident } from './render.js';
import { USGS_POLL_MS } from './sources/usgs.js';

export function createScheduler({
  store,
  hub,
  httpGet,
  clock,
  intervalMs = USGS_POLL_MS,
  publishDir = null,
  logger = console,
}) {
  let timer = null;
  let running = false;
  let stopped = false;
  let backoff = 0; // consecutive-failure count

  async function runOnce() {
    if (running) return; // never overlap ticks
    running = true;
    try {
      const now = clock();
      const { diffs, observations } = await tick({ store, httpGet, now });

      for (const diff of diffs) {
        hub.broadcast('incident', {
          op: diff.op,
          incident: toClientIncident(diff.incident, now),
        });
      }

      // The feed poll succeeded — clear backoff regardless of what publishing
      // does. A local write failure (e.g. a read-only publish dir) must not
      // throttle polling of a healthy Source. Reuse `now` so the published
      // artefacts and the SSE payloads agree on their timestamp.
      backoff = 0;
      if (diffs.length || observations) {
        logger.log(`[tick] ${observations} obs, ${diffs.length} change(s)`);
      }
      if (publishDir) {
        try {
          await publish(store, now, publishDir);
        } catch (err) {
          logger.error(`[publish] ${err.message}`);
        }
      }
    } catch (err) {
      backoff = Math.min(backoff + 1, 6);
      logger.error(`[tick] error (backoff ${backoff}): ${err.message}`);
    } finally {
      running = false;
      scheduleNext();
    }
  }

  function scheduleNext() {
    if (stopped) return;
    // Exponential backoff on failure, capped; normal cadence otherwise.
    const delay = backoff ? Math.min(intervalMs * 2 ** backoff, 15 * 60_000) : intervalMs;
    timer = setTimeout(runOnce, delay);
  }

  return {
    /** Run an immediate tick, then keep polling. Resolves after the first tick. */
    async start() {
      stopped = false;
      await runOnce();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

async function publish(store, now, dir) {
  const incidents = store.allIncidents();
  await writeFile(join(dir, 'dashboard.html'), renderDashboardHtml(incidents, now));
  await writeFile(
    join(dir, 'snapshot.json'),
    JSON.stringify(renderSnapshot(incidents, now), null, 2),
  );
}
