# Implementation notes

Kept by the agent, reviewed by you. One entry per working block.

## Slice 1 — USGS end-to-end through the live Dashboard (issue #4)

Stood up the whole pipeline spine on a single Source (USGS):
`ingest → normalize → correlate → project → score → publish`, plus the SSE
Dashboard, the JSON snapshot, the in-process scheduler, and a single-container
run. Zero runtime dependencies — Node standard library only (`node:sqlite`,
`node:http`, global `fetch`, `node:test`).

### Decisions

- **Zero-dependency stack.** `node:sqlite` (`DatabaseSync`) for the store,
  `node:http` for the server, global `fetch` for feeds, `node:test` for tests.
  Keeps the container trivial (no install step) and the supply chain empty.
  Requires Node ≥ 22.5; developed and verified on v24.
- **Store shape (ADR-0002/0006).** Append-only `observations` (immutable log) +
  projected `incidents` (rebuildable from the log). WAL on disk; `:memory:` in
  tests. DDL kept Postgres-portable (plain SQL types; `seq INTEGER PRIMARY KEY`
  would become `BIGSERIAL`).
- **Correlate on `ids` membership, never the preferred `id`** (feeds/usgs.md
  Q1). Two records collapse iff their source-id sets overlap — so a USGS event
  whose preferred id is promoted (regional → national) stays one Incident, and
  the summary + FDSN reconciliation records of one event collapse together.
- **Deletions via FDSN reconciliation** (feeds/usgs.md Q2). Each poll after the
  first queries `fdsnws/event?updatedafter=…&includedeleted=true&format=geojson`;
  a returned event with `status="deleted"` reprojects its Incident to
  `Status = Retracted`. Retracted Incidents stay visible (never vanish).
- **Tier from USGS review status** (confirmed with the user). `status="reviewed"`
  → `Confirmed`; `"automatic"` → `Provisional`. Tier is sticky (never
  downgrades). This is the single-source stand-in for the cross-source
  corroboration that lands in Slice 2.
- **Corrections are first-class** (ADR-0004, user story 9). The projector retains
  the prior value of a revised field (magnitude, place) in `provenance.corrections`
  rather than overwriting silently; the Dashboard shows e.g. "corrected M 6.1→5.8".
- **Change-diffs drive SSE.** A tick reprojects only touched Incidents and emits
  a diff only when the display/ranking signature actually changes — so a quiet
  poll broadcasts nothing. The Dashboard applies diffs in place (no refresh).
- **Severity is a magnitude placeholder** (as the issue scopes it). The
  lexicographic scorer (alert class → exposure → intensity → recency, ADR-0008)
  lands in Slice 3; the interface already returns explainable `factors`.
- **Injected edges.** `httpGet` and the clock are injected; `tick` is pure with
  respect to them. The primary test seam drives recorded payloads + a fixed clock
  through a real in-memory SQLite and asserts on projections + diffs.

### ADR pointers

The issues reference ADR-0001…0009 as decisions, not as files in this repo yet.
Slice 1 honours: 0001 (SSE), 0002 (event-sourced projection), 0003 (deterministic
sticky correlation), 0004 (Tier/Status/corrections), 0005 (no LLM in the
pipeline — none used this slice), 0006 (SQLite WAL, Postgres-portable), 0007
(single container + in-process scheduler). 0008 (severity weights) and 0009
(ReliefWeb RSS fallback) are *proposed* and out of scope until Slices 3/2.

### Open questions

- **Severity floor / noise.** `all_day` includes M1–2 events, so the live
  Dashboard currently lists ~250 rows. User story 21 (surface only above a
  Severity floor) and story 22 (track GDACS Green silently) are Slice 3 work;
  no floor is applied yet. Confirm the earthquake floor (PAGER yellow+? a
  magnitude cutoff?) when the real scorer lands.
- **`country` from USGS.** USGS gives only free-text `place`; we take the text
  after the last comma as a best-effort location hint (no ISO code). GDACS
  supplies real ISO countries in Slice 2.

### Review fixes (post-PR self-review)

A multi-angle code review ran against the slice (the GitHub `claude-review`
action was a no-op — its `ANTHROPIC_API_KEY` secret is unset — so the review was
run locally instead). Bugs found and fixed:

- **SSE write could crash the process.** A broken client socket emits an async
  `'error'` event, which the synchronous `try/catch` in `broadcast` never caught
  → uncaught exception. Added an `'error'` listener in `sse.js` `subscribe`.
- **`</script>` breakout in the embedded bootstrap JSON.** `JSON.stringify` does
  not escape `<`/`>`, so a feed-supplied `</script>` in a `place` string could
  break out of the tag (XSS / dead client). `render.js` now escapes `<`, `>`,
  U+2028/9 to `\uXXXX` before embedding. Verified against a hostile payload.
- **Quiet-tick upsert skipped persistence.** The old code skipped
  `upsertIncident` when the display signature was unchanged — which also dropped
  newly-accumulated `sourceIds`/`firstObserved`, so a later observation sharing
  only a new id could spawn a duplicate Incident. `pipeline.js` now always
  persists a touched Incident; only the SSE *diff* is gated on a visible change.
- **Deletion with stripped timestamps was missed.** FDSN `includedeleted`
  records can arrive with null `time`/`updated`; the projector's sort key
  `?? 0` sent them to the front, so the deletion was never `latest` and the
  Incident stayed Active. Now falls back to `ingestedAt` (deterministic, part of
  the log). Also made `observations.event_time` nullable so such a record
  inserts. Regression test added.
- **`country` was derived but never persisted** → always null after reload. Added
  the `country` column to `observations` + read-back. Regression test added.
- **Empty `ids` would mint a new Incident every tick.** `usgs.js` now falls back
  to the preferred id when `ids` is empty.
- **`PORT=""` bound a random port** (`Number('')===0`). `main.js` uses
  `Number(PORT) || 8080`.
- **A local publish-write failure inflated the feed backoff.** `scheduler.js`
  now clears backoff on feed success and publishes in its own try; also reuses a
  single `now` so the disk artefacts and SSE payloads share a timestamp.
- **Replay-on-connect flashed every row.** The client now flashes only genuine
  changes (update, or an add for an unseen id), not the bootstrap replay.

Known limitations left for later slices (not bugs in scope): the single-source
correlator does not merge two pre-existing Incidents bridged by one observation
(explicit merge/split is Slice 2); SSE has no per-client backpressure cap
(single-node, few clients — ADR-0001); the client rebuilds the full table on each
connect event (O(N) per event) and does not recompute `stale` on a timer between
diffs.

### Deviations

- **Dedup demonstrated via preferred-id promotion, not two simultaneous feed
  entries.** The issue's phrase "two USGS records for the same quake (shared
  `ids`)" is exercised in the fixture as (a) one event whose preferred id changes
  across ticks while sharing an id, and (b) the same event arriving via both the
  summary and the FDSN reconciliation feed in one tick. Both collapse to one
  Incident. This is the realistic single-source shape; `all_day` does not list
  one physical quake twice at the same instant. No behavioural deviation — the
  correlation rule (id-set overlap) is exactly as specified.
