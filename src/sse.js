// SSE hub — holds client connections and pushes Incident change-diffs
// (ADR-0001). One-directional: server → client. No fan-in, no backchannel.

export function createSseHub() {
  const clients = new Set();

  return {
    /** Attach a response as an SSE stream. Returns an unsubscribe function. */
    subscribe(res) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 3000\n\n'); // ask the browser to reconnect after 3s
      clients.add(res);
      res.on('close', () => clients.delete(res));
      // A broken pipe surfaces as an async 'error' event, not a sync throw;
      // without this listener it would become an uncaught exception and take
      // the whole process down.
      res.on('error', () => clients.delete(res));
      return () => clients.delete(res);
    },

    /** Push one named event with a JSON payload to every connected client. */
    broadcast(event, data) {
      const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const res of clients) {
        try {
          res.write(frame);
        } catch {
          clients.delete(res);
        }
      }
    },

    /** Push one event to a single client (used to replay state on connect). */
    send(res, event, data) {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        clients.delete(res);
      }
    },

    get size() {
      return clients.size;
    },
  };
}
