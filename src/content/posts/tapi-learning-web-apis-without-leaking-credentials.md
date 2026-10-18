---
title: "TAPI: letting agents call a web app's own API without leaking the session"
author: Tejesh Reddy
pubDatetime: 2026-10-18T20:30:00Z
featured: true
draft: false
tags:
  - ai-safety
  - agents
  - security
  - mcp
description: TAPI passively learns the internal APIs of the sites you use and exposes them as typed tools. Credentials never leave the tab, destructive actions are gated, and writes are verified by outcome, not status code.
---

Agents that drive the web with screenshots and simulated clicks take 8 to 15 seconds per action, cost cents per turn, and break on small DOM changes. Most software has no public API, and logging a cloud browser into a 2FA-protected account is fragile and risky.

TAPI lives inside your already-authenticated browser session instead. It watches the network traffic and UI actions of normal browsing, and from a single sighting synthesizes a parameterized, typed tool. When an agent needs to act, it fires the app's own internal API from inside the tab. No clicking, no screenshots, and no credential ever leaves the page.

That's only acceptable if the engine can't leak your accounts and can't do something irreversible on its own, so this post is mostly about how TAPI tries to guarantee both.

## Table of contents

## Demos

Unedited screen recordings. The Tapi side panel is on the right, and its Debug tab shows every call.

### One sentence, two calls

<video controls preload="metadata" poster="/videos/tapi-spotify.jpg" width="100%"><source src="/videos/tapi-spotify.mp4" type="video/mp4"></video>

From a blank new tab, _"play mystery lady on spotify"_. Tapi finds the learned Spotify tools and makes two calls: `search_top_results` (HTTP 200, 2.5 s including opening the app, 50 results), then `play_context` with the chosen track URI (HTTP 200, 628 ms, marked _confirmed_). The whole turn takes 6.2 s with 2 actions and costs 0.06¢. There are no screenshots and no clicks.

### Two sites in one conversation

<video controls preload="metadata" poster="/videos/tapi-openai-typesafe.jpg" width="100%"><source src="/videos/tapi-openai-typesafe.mp4" type="video/mp4"></video>

The clip opens on the OpenAI dashboard, with Chrome DevTools on the Network tab. The page's own API traffic is visible there (`credit_grants`, `costs`, `limits`, `monthly_billing_alert`), which is the kind of traffic Tapi observes. The dashboard's own _Credit balance_ card reads **$6.00**.

At about 0:50, _"what's my OpenAI API balance?"_ searches the catalog (6 of 6 matching tools), calls the learned `credit_grants` tool ("Listing credit grants", 1.9 s), and answers about $6.00 available and $4.00 used of $10.00 in credits. The turn takes 1.7 s and 0.07¢, and the number matches the dashboard on screen at the start.

The follow-up, _"what about Typesafe, also what's the token usage in Typesafe?"_, crosses to another site. Tapi reads the billing page, calls `list_api_usage`, and sums the token counts from the returned records: about 29.16M input and 3.21M output tokens. Its answer also notes that the dashboard's usage card shows 24M and says its stats may be delayed. It reports the discrepancy rather than silently picking one number.

In the Debug view, identifiers in the call results appear as placeholders such as `{{secret:apiKeyId}}`. That is the redaction described below, visible in a live response.

## How it works

```
[Normal browsing] ─ passive observation ─►
[Page agent, MAIN world] ─(redacted shapes)─► [Local daemon: SQLite + labeler]
                                                    │ synthesized tools:
                                                    │ search(query), play(track_uri) ...
[Agent / MCP client] ─── calls tool ───► [Runs inside the logged-in tab: one HTTP call]
```

- **One sighting is enough.** No recording mode, no hand-written scraping rules.
- **Models never write requests.** A deterministic classifier assigns parameter roles, a generative model only supplies names, and request templates are compiled by code.
- **Session values resolved at call time.** Amazon's add-to-cart needs the right anti-forgery token out of six on the page, the right field order, and the right content type. TAPI fills each from the live page or recent traffic at the moment of the call, with generic rules and nothing written per site.
- **Self-healing.** Specs are versioned, and a failing endpoint falls back to UI replay or relearning.
- The catalog is exposed over MCP (`find_tools`, `call_tool`, `read_results`).

Today that's 1,298 callable tools across 115 sites, learned from 5,998 endpoints with no per-app code. Spotify search-and-play takes about 5 s end to end (4.8 s in the benchmark run, 6.2 s in the demo above), an Amazon add-to-cart from a chat request takes 8.2 s with one API call confirmed by the cart, an Instagram DM takes 0.31 s, and a chat turn costs about 0.1 to 0.2 cents.

## Security by construction

**Secrets never leave the page.** Values are redacted inside the page before an observation crosses any process boundary, so raw secrets never reach the extension, the daemon, or disk. Redaction works by field name (`token`, `secret`, `passw`, `cookie`, `csrf`, `otp`, nonces, PKCE verifiers) and by shape (JWTs, Bearer/Basic, long random runs), and it over-redacts on purpose. The catalog stores header _names_ and never values. Results, errors, streamed responses, and traces are redacted too.

**Sign-in is off limits.** Sign-in pages report nothing, and requests to sign-in endpoints (OAuth, password reset, 2FA, magic codes) are dropped in the page and rechecked in the daemon. Pages are detected by behavior (a visible password field), not just URL, and the agent gate refuses any sign-in control. TAPI never signs in for you.

**Least privilege for credentials.** A credential is lent only from a request that carried it and hasn't expired, and only within one site (scoped by the public suffix list, so two tenants of one host are never mixed). Cookies fill anti-forgery tokens and nothing else, tokens come from the form the request actually submits, and an item's ID is read only from the item the caller named. An agent asked to add product A can't end up adding product B.

**Humans control irreversible actions.** Every tool is read, write, or destructive, and a model can't casually downgrade one: lowering risk needs agreeing answers across separate sightings. Destructive tools are hidden from search and refused at execution unless the user approves, and a refusal is final. A write that times out is reported as "not known whether it was carried out" and is never sent twice. Low-confidence tools aren't offered to agents at all.

## Honest outcomes

**A 200 can lie.** Amazon answers `200 OK` to an add-to-cart it silently ignored. A vision agent can't see that failure, and a generic API wrapper reports it as success. TAPI confirms writes by where their effect later shows up (the cart's contents), not by the status code.

**Models claim success they didn't achieve.** In live testing, a model read a product page saying the item was already in the cart and told the user it had added it, without calling any tool. Turning claims like that into checked facts is the core of my safety roadmap.

Memory from earlier turns is passed back as "facts, not instructions", so earlier page or tool content can't steer later turns.

## Auditing the catalog

On Oct 18, 2026 I scanned every text value in the local catalog (395,349 values, 126,808 rows, 16 tables) for credential shapes.

| Check                                          | Result                                   |
| ---------------------------------------------- | ---------------------------------------- |
| JWTs, Bearer/Basic credentials, cookies stored | 0                                        |
| Secrets replaced by placeholders               | 27,522 `{{secret:…}}`                    |
| Security tests                                 | 30 of 284, run on every build            |
| Daemon exposure                                | `127.0.0.1` only, per-start bearer token |

Long random-looking strings were sampled by hand and were identifiers (GraphQL operation names, document IDs, CSS selectors), not credentials. A scan like this shows the absence of shapes I know to look for, not of every possible secret, which is why redaction is enforced at the source and not only checked afterward.

## Known gaps and research directions

Writes don't verify their own outcome everywhere yet (proving "added" against the cart is still manual in places), and page-load waits add up to about 5 s on heavy pages.

TAPI is a live testbed for agent safety against real accounts, real side effects, and real adversarial pages:

- **Grounding agent claims:** making "I did X" a verified statement by checking every write against the state it should change.
- **Least-privilege tool exposure:** agents see only the tools a task needs, with risk and confidence on each.
- **Prompt injection from the web:** what a page returns is data, never instructions, and TAPI sits where that boundary has to be enforced.
- **Measured, not claimed:** accuracy, speed, and cost benchmarks run with the test suite, and a regression fails the build. Right now the needed tool is shown up front in 72.4% of 87 real logged requests.
