// Entry point — wire the Store, HTTP server, SSE hub, and Scheduler together
// and run as a single process in a single container (ADR-0007, user story 26).
//
// Environment:
//   PORT            HTTP port (default 8080)
//   HADR_DB         SQLite path (default ./data/hadr.db)
//   HADR_PUBLISH    directory for dashboard.html + snapshot.json (default cwd)
//   HADR_FIXTURES   optional path to a USGS summary GeoJSON file; when set, the
//                   feed is replayed from disk instead of the network, so the
//                   whole system runs offline (user story 27).

import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { systemClock } from './clock.js';
import { httpGet as realHttpGet } from './http.js';
import { createHttpServer } from './server.js';
import { createScheduler } from './scheduler.js';
import { openStore } from './store.js';
import { createSseHub } from './sse.js';

const PORT = Number(process.env.PORT ?? 8080);
const DB_PATH = process.env.HADR_DB ?? './data/hadr.db';
const PUBLISH_DIR = process.env.HADR_PUBLISH ?? process.cwd();
const FIXTURES = process.env.HADR_FIXTURES ?? null;

async function main() {
  if (DB_PATH !== ':memory:') await mkdir(dirname(DB_PATH), { recursive: true });
  const store = openStore({ path: DB_PATH });
  const hub = createSseHub();
  const clock = systemClock;
  const httpGet = FIXTURES ? await fixtureHttpGet(FIXTURES) : realHttpGet;

  const server = createHttpServer({ store, hub, clock });
  server.listen(PORT, () => {
    console.log(`HADR Monitor on http://localhost:${PORT}  (db: ${DB_PATH}${FIXTURES ? ', fixtures' : ''})`);
  });

  const scheduler = createScheduler({ store, hub, httpGet, clock, publishDir: PUBLISH_DIR });
  await scheduler.start();

  const shutdown = () => {
    scheduler.stop();
    server.close();
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Offline replay: serve the same summary payload every tick; no reconciliation.
async function fixtureHttpGet(path) {
  const body = await readFile(path, 'utf8');
  return async (url) => {
    if (url.includes('summary/')) return { status: 200, headers: {}, body };
    return { status: 204, headers: {}, body: '' }; // FDSN reconcile: nothing
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
