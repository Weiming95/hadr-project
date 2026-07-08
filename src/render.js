// Renderer — pure functions from a set of Incidents to the published surfaces:
// the Dashboard HTML and the machine-readable JSON snapshot (user story 28).
//
// Pure and deterministic: given the same Incidents + the same `now`, byte-for-
// byte identical output. `stale` is computed here (display-derived, never
// stored, user story 8). The page server-renders its rows AND carries a small
// client that applies SSE change-diffs in place — so it works without JS and
// updates live with it (ADR-0001, user story 3).

import { Status } from './domain.js';

// An Incident with no fresh observation for this long reads as "not developing".
export const STALE_MS = 90 * 60_000; // 90 minutes

/** Project the stored Incident into the compact shape sent to clients / JSON. */
export function toClientIncident(incident, now) {
  return {
    id: incident.incidentId,
    hazard: incident.hazard,
    tier: incident.tier,
    status: incident.status,
    stale: incident.status === Status.ACTIVE
      && now - (incident.lastObserved ?? 0) > STALE_MS,
    severity: incident.severity,
    magnitude: incident.magnitude ?? null,
    place: incident.place ?? null,
    country: incident.country ?? null,
    alert: incident.alert ?? null,
    geometry: incident.geometry ?? null,
    firstObserved: incident.firstObserved ?? null,
    lastObserved: incident.lastObserved ?? null,
    corrections: incident.provenance?.corrections ?? [],
    provenanceCount: incident.provenance?.observations?.length ?? 0,
  };
}

/** Rank: active before retracted; within each, severity desc then recency. */
export function rankIncidents(clientIncidents) {
  return [...clientIncidents].sort((a, b) => {
    const ar = a.status === Status.RETRACTED ? 1 : 0;
    const br = b.status === Status.RETRACTED ? 1 : 0;
    if (ar !== br) return ar - br;
    if (b.severity !== a.severity) return b.severity - a.severity;
    return (b.lastObserved ?? 0) - (a.lastObserved ?? 0);
  });
}

/** The JSON snapshot: the seed for anyone building tooling on top (US 28). */
export function renderSnapshot(incidents, now) {
  const items = rankIncidents(incidents.map((i) => toClientIncident(i, now)));
  return {
    generatedAt: now,
    count: items.length,
    incidents: items,
  };
}

export function renderDashboardHtml(incidents, now) {
  const items = rankIncidents(incidents.map((i) => toClientIncident(i, now)));
  const rows = items.map(rowHtml).join('\n');
  const bootstrap = jsonForScript(items);
  const generated = new Date(now).toISOString();

  return `<main>
  <header class="hd">
    <h1>HADR Monitor</h1>
    <p class="sub">Current disaster Incidents · USGS earthquakes · <span id="gen" data-ts="${now}">${generated}</span></p>
  </header>
  <table id="incidents">
    <thead>
      <tr><th>Sev</th><th>Hazard</th><th>Where</th><th>Tier</th><th>Status</th><th>Updated</th></tr>
    </thead>
    <tbody id="rows">
${rows}
    </tbody>
  </table>
  <p class="empty" id="empty"${items.length ? ' hidden' : ''}>No current Incidents.</p>
  <footer class="ft">Read-only. Data at best ~1 minute old. <a href="/snapshot.json">JSON snapshot</a>.</footer>
</main>
${styleTag()}
<script id="bootstrap" type="application/json">${bootstrap}</script>
${clientScript()}
`;
}

function rowHtml(ci) {
  const cls = [
    'row',
    `tier-${ci.tier.toLowerCase()}`,
    `status-${ci.status.toLowerCase()}`,
    ci.stale ? 'stale' : '',
  ].filter(Boolean).join(' ');
  return `      <tr class="${cls}" data-id="${esc(ci.id)}">`
    + `<td class="sev">${sevText(ci)}</td>`
    + `<td>${esc(ci.hazard)}</td>`
    + `<td>${esc(whereText(ci))}${correctionText(ci)}</td>`
    + `<td><span class="badge">${esc(ci.tier)}</span></td>`
    + `<td>${esc(ci.status)}${ci.stale ? ' <span class="tag">stale</span>' : ''}</td>`
    + `<td>${esc(fmtTime(ci.lastObserved))}</td></tr>`;
}

function sevText(ci) {
  return ci.magnitude != null ? `M ${ci.magnitude.toFixed(1)}` : ci.severity.toFixed(1);
}
function whereText(ci) {
  return ci.place || ci.country || 'Location unknown';
}
function correctionText(ci) {
  const mag = ci.corrections.filter((c) => c.field === 'magnitude').pop();
  if (!mag) return '';
  return ` <span class="corr">corrected M ${Number(mag.from).toFixed(1)}→${Number(mag.to).toFixed(1)}</span>`;
}
function fmtTime(ts) {
  return ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 16) + 'Z' : '';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Safe to embed inside an HTML <script>: JSON.stringify does not escape `<`,
// `>` or line/paragraph separators, so a feed-supplied "</script>" (or U+2028)
// would break out of the tag. Escape them to their \uXXXX forms — still valid
// JSON that JSON.parse reads back identically.
function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function styleTag() {
  return `<style>
  :root { color-scheme: light dark; --line:#8883; }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.5 system-ui,sans-serif; }
  main { max-width:960px; margin:0 auto; padding:1.5rem; }
  .hd h1 { margin:0 0 .1rem; font-size:1.4rem; }
  .sub { margin:0 0 1rem; opacity:.7; font-size:.85rem; }
  table { width:100%; border-collapse:collapse; }
  th,td { text-align:left; padding:.5rem .6rem; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-size:.72rem; text-transform:uppercase; letter-spacing:.04em; opacity:.6; }
  .sev { font-variant-numeric:tabular-nums; font-weight:600; white-space:nowrap; }
  .badge { font-size:.72rem; padding:.05rem .4rem; border:1px solid var(--line); border-radius:999px; }
  .tier-confirmed .badge { background:#2e7d3222; border-color:#2e7d3288; }
  .tier-provisional .badge { opacity:.7; }
  .status-retracted { opacity:.5; text-decoration:line-through solid 1px; }
  .status-retracted .badge { text-decoration:none; }
  .stale { opacity:.6; }
  .tag { font-size:.7rem; padding:.02rem .35rem; border:1px solid var(--line); border-radius:4px; opacity:.8; }
  .corr { font-size:.72rem; color:#b26a00; }
  .empty { opacity:.6; padding:1rem 0; }
  .ft { margin-top:1.5rem; font-size:.78rem; opacity:.6; }
  tr { transition: background .6s; }
  tr.flash { background:#ffd54f44; }
</style>`;
}

// Client: seed from the embedded snapshot, then apply SSE diffs in place.
// The row builder mirrors rowHtml above so the live handoff is seamless.
function clientScript() {
  return `<script>
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtTime = ts => ts ? new Date(ts).toISOString().replace('T',' ').slice(0,16)+'Z' : '';
  const where = ci => ci.place || ci.country || 'Location unknown';
  const sev = ci => ci.magnitude != null ? 'M '+ci.magnitude.toFixed(1) : ci.severity.toFixed(1);
  const corr = ci => { const m=(ci.corrections||[]).filter(c=>c.field==='magnitude').pop(); return m ? ' <span class="corr">corrected M '+Number(m.from).toFixed(1)+'\\u2192'+Number(m.to).toFixed(1)+'</span>' : ''; };
  const rank = arr => arr.slice().sort((a,b) => {
    const ar=a.status==='Retracted'?1:0, br=b.status==='Retracted'?1:0;
    if (ar!==br) return ar-br;
    if (b.severity!==a.severity) return b.severity-a.severity;
    return (b.lastObserved||0)-(a.lastObserved||0);
  });
  const map = new Map();
  const boot = JSON.parse(document.getElementById('bootstrap').textContent || '[]');
  boot.forEach(ci => map.set(ci.id, ci));
  const tbody = document.getElementById('rows');
  const empty = document.getElementById('empty');
  function rowHtml(ci) {
    const cls = ['row','tier-'+ci.tier.toLowerCase(),'status-'+ci.status.toLowerCase(),ci.stale?'stale':''].filter(Boolean).join(' ');
    return '<td class="sev">'+sev(ci)+'</td>'
      + '<td>'+esc(ci.hazard)+'</td>'
      + '<td>'+esc(where(ci))+corr(ci)+'</td>'
      + '<td><span class="badge">'+esc(ci.tier)+'</span></td>'
      + '<td>'+esc(ci.status)+(ci.stale?' <span class="tag">stale</span>':'')+'</td>'
      + '<td>'+esc(fmtTime(ci.lastObserved))+'</td>';
  }
  function render(flashId) {
    const items = rank([...map.values()]);
    tbody.replaceChildren();
    for (const ci of items) {
      const tr = document.createElement('tr');
      tr.className = ['row','tier-'+ci.tier.toLowerCase(),'status-'+ci.status.toLowerCase(),ci.stale?'stale':''].filter(Boolean).join(' ');
      tr.dataset.id = ci.id;
      tr.innerHTML = rowHtml(ci);
      if (ci.id === flashId) { tr.classList.add('flash'); setTimeout(() => tr.classList.remove('flash'), 1200); }
      tbody.appendChild(tr);
    }
    empty.hidden = items.length > 0;
  }
  render();
  const es = new EventSource('/events');
  es.addEventListener('incident', e => {
    const diff = JSON.parse(e.data);
    const id = diff.incident.id;
    // On connect the server replays every current incident as op:'add'; those
    // are already bootstrapped, so don't flash them. Flash only a genuine
    // change: an update, or an add for an id we hadn't seen.
    const flash = (diff.op === 'update' || !map.has(id)) ? id : null;
    map.set(id, diff.incident);
    render(flash);
  });
})();
</script>`;
}
