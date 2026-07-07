# HADR Monitor

A monitoring agent for **humanitarian assistance and disaster response (HADR)**.

## What is HADR?

Humanitarian Assistance and Disaster Response is the work of getting help to
people after — and increasingly *before* — a disaster hits: earthquakes,
cyclones, floods, volcanic eruptions, droughts, wildfires. It is run by a
crowded ecosystem — UN agencies (OCHA, WFP, UNHCR), the Red Cross/Red Crescent
movement, national disaster management offices, militaries, and hundreds of
NGOs — and the hardest problem in the first hours is rarely *doing* something.
It is **knowing what is actually happening**.

That knowledge is scattered across dozens of feeds that each see a different
slice of the truth:

- **Seismic networks** (USGS) know an earthquake's magnitude within minutes,
  but nothing about who lives above the fault.
- **Multi-hazard alert systems** (GDACS) fuse hazard data with population and
  vulnerability models to guess at *impact* — but they guess, and they revise.
- **Curated humanitarian services** (ReliefWeb) confirm what matters only after
  humans have weighed in — accurate, contextual, and hours-to-days behind.

Nobody's morning starts with a clean, deduplicated, prioritised picture. They
start with a hundred browser tabs. **That gap is what this project fills.**

## What this project builds

By the end of the week this repository contains an agent that:

- **watches live disaster feeds** — GDACS, USGS and ReliefWeb (see `feeds/`)
- **filters out the noise and assesses what remains** — what happened, where,
  how bad, who is affected
- **publishes a morning situation report** to `dashboard.html` at 08:30
  Singapore time
- **runs on a schedule, unattended**, and stays quiet when nothing has changed

How it does any of that is not specified anywhere in this repository. **That is
the course.** The feeds are real, they disagree with each other, they go down,
and they revise history underneath you — and building something trustworthy on
top of them is the entire exercise.

## Why it is harder than it looks

The feed notes in `feeds/` open with real, unresolved questions. They are worth
reading before you write a line of code, because they are where the difficulty
actually lives:

- **Deduplication.** The same physical earthquake arrives from USGS *and* GDACS
  (both sourced from NEIC) and later from ReliefWeb, under three different
  identifiers, hours or days apart. What makes two records "the same event"?
- **Revision.** USGS events start `"automatic"` and get corrected — magnitude,
  location, sometimes deleted outright. GDACS alert colours change. What happens
  to a report you already published when its event changes underneath it?
- **Prioritisation.** A `Green` M4.6 offshore is noise; a `Red` cyclone over a
  dense coastline is the whole report. Turning alert scores, magnitude,
  population and country into "what leads the 08:30 report" is a judgement call
  you have to encode.
- **Silence.** On a quiet morning — or a morning a feed is down — the report
  should say so calmly, not crash and not cry wolf.
- **Access and rate limits.** ReliefWeb's API now needs a pre-approved
  `appname`; feeds publish no uptime guarantees. What do you build against in
  the meantime, and how does the agent behave politely under load?

## The possibilities

The 08:30 situation report is the assignment, not the ceiling. The same
pipeline — *ingest many disagreeing sources → deduplicate → assess → prioritise
→ publish → repeat on a schedule* — is a general shape, and once it works it
opens onto much more:

- **Alerting & escalation** — page a human the moment a Red-level event lands in
  a region you care about, instead of waiting for 08:30.
- **Geographic & sector focus** — scope the agent to one country, basin, or
  hazard type; layer in your own areas of operation or assets at risk.
- **Impact estimation** — join hazard data to population, infrastructure, and
  vulnerability layers to move from "what happened" toward "who needs what".
- **Trend & historical view** — keep a running store so the report can say "the
  third M6+ on this fault this month", not just today's snapshot.
- **More sources** — weather (cyclone tracks), news, social signals, national
  agencies; each new feed sharpens dedup and confidence.
- **Human-in-the-loop review** — a queue where an analyst confirms, corrects, or
  suppresses the agent's calls before they go out.
- **Machine-readable output** — publish structured data alongside the HTML so
  downstream tools, maps, or dashboards can consume it.

You are, in miniature, building the thing a duty officer wishes they had at
07:00.

## The three days

1. **Plan** — interrogate the feeds, write the PRD, cut it into vertical slices
2. **Autonomy** — build the first slice, write a skill, wire up the 08:30
   routine, launch the overnight loop
3. **Trust** — review code you didn't write, harden the pipeline, demo

## Repository layout

| Path | What lives here |
| --- | --- |
| `feeds/` | Notes on each source feed — endpoints, sample payloads, and the open questions that make integration hard |
| `scripts/` | Deterministic checks — anything that must give the same answer twice does not belong in a prompt |
| `skills/` | Skills you write on Day 2, one folder per skill (a `SKILL.md`, its assets, and which model each step should use) |
| `docs/solutions/` | One learning per file — when something costs you more than ten minutes, the fix goes here so no future session pays for it twice |
| `implementation-notes.md` | Kept by the agent, reviewed by you — decisions, open questions, and any deviation from the PRD or `CLAUDE.md` |
| `CLAUDE.md` | Project conventions the agent must follow — fill this in before your first prompt |

## Artefacts expected by the end

`prd.html` · `system-view.html` · `implementation-notes.md` · `dashboard.html` ·
`goal.md` · at least one skill

## Day 1 setup

1. Sign in to Claude Code with your Team seat
2. Create your own repository from this template, then clone it
3. Run `/install-github-app` so @claude reviews your pull requests from Day 2
4. Install OpenCode and sign in with your Go key

Fill in `CLAUDE.md` before your first prompt. An empty conventions file is also
a decision — just not one you made.
