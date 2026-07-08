// HTTP server — the public, read-only surface (ADR-0001).
//
//   GET /               the live Dashboard (server-rendered + SSE client)
//   GET /events         the SSE stream of Incident change-diffs
//   GET /snapshot.json  the machine-readable snapshot (user story 28)
//   GET /healthz        liveness
//
// Rendering is delegated to the pure renderer; this module only wires HTTP to
// the Store, the clock, and the SSE hub.

import { createServer } from 'node:http';
import {
  renderDashboardHtml,
  renderSnapshot,
  toClientIncident,
} from './render.js';

export function createHttpServer({ store, hub, clock }) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (req.method !== 'GET') {
      res.writeHead(405).end('Method Not Allowed');
      return;
    }

    switch (url.pathname) {
      case '/': {
        const html = renderDashboardHtml(store.allIncidents(), clock());
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }
      case '/snapshot.json': {
        const snapshot = renderSnapshot(store.allIncidents(), clock());
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(snapshot, null, 2));
        return;
      }
      case '/events': {
        hub.subscribe(res);
        // Replay current state to THIS client only, so a late or reconnecting
        // client is in sync without a page refresh.
        const now = clock();
        for (const incident of store.allIncidents()) {
          hub.send(res, 'incident', { op: 'add', incident: toClientIncident(incident, now) });
        }
        return;
      }
      case '/healthz': {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
      }
      default:
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
  });

  return server;
}
