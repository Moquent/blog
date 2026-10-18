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

Agents that drive the web like a human, with screenshots and simulated clicks, take 8 to 15 seconds per action, cost cents per turn, and break on minor DOM changes. Most software has no public API, and logging a cloud browser into a 2FA-protected account is both fragile and risky.

TAPI takes the opposite approach. It lives inside your already-authenticated browser session, passively watches the network traffic and UI actions of normal browsing, and from a single sighting synthesizes a parameterized, typed tool. When an agent needs to act, it fires the app's own internal API from inside the tab. No clicking, no screenshots, and no credential ever leaves the page.

Giving an agent that power inside your logged-in accounts is only acceptable if it can't leak those accounts and can't do something irreversible on its own. This post is mostly about how TAPI tries to guarantee both.

## Table of contents

## How it works

```
[Normal browsing] ── passive observation ──►
[Page agent, MAIN world] ──(redacted shapes)──► [Local daemon: SQLite + labeler]
                                                       │
                                            synthesized tools:
                                            search(query), play(track_uri) ...
                                                       │
[Agent / MCP client] ──── calls tool ────► [Runs inside the logged-in tab: one HTTP call]
```

- **One sighting is enough.** A single click or search produces a working, schema-validated tool. There's no recording mode and no hand-written scraping rules.
- **Models never write requests.** A deterministic classifier assigns parameter roles and a generative model only provides semantic names. Request templates are compiled by code, so no model hallucinates an HTTP body.
- **Session values are resolved at call time.** Real apps guard their writes. Amazon's add-to-cart needs the right anti-forgery token out of six on the page, the right field order, and the right content type. TAPI fills each value from the live page or the app's latest traffic at the moment of the call, using generic rules, with nothing written per site.
- **Self-healing.** Tool specs are versioned. If an endpoint fails, TAPI falls back to UI replay or rebuilds the contract from fresh observations.
- It exposes the learned catalog over MCP (`find_tools`, `call_tool`, `read_results`).

Measured so far: Spotify search-and-play in 4.8 s end to end, Amazon add-to-cart from a chat request in 8.2 s with one API call confirmed by the cart, an Instagram DM in 0.31 s, and a chat turn costing about 0.1 to 0.2 cents. The catalog holds 1,298 callable tools across 115 sites, learned from 5,998 endpoints with no per-app code.

## Security by construction

### 1. Secrets never leave the page

Values are redacted inside the page before an observation crosses any process boundary, so raw secrets never reach the extension, the daemon, or the disk. Results coming back from a call are redacted a second time in the daemon.

Redaction has two layers: by field name (`token`, `secret`, `passw`, `auth`, `cookie`, `session`, `csrf`, `otp`, `signature`, PKCE verifiers, nonces) and by shape (JWTs, Bearer/Basic credentials, long random mixed-case runs). The rule is to over-redact rather than risk a session. Hex hashes such as GraphQL persisted-query IDs are kept, because a tool needs them to replay a call.

The catalog stores header _names_, never values. At call time, the value is borrowed from the app's own live traffic inside the tab. Error paths, streamed responses (NDJSON/SSE), and diagnostic traces are redacted too, and tests check that short secrets don't leak through error messages.

### 2. Sign-in is off limits

A sign-in page reports nothing. A request to a sign-in endpoint (token exchange, OAuth callback, password reset, 2FA, magic codes) is dropped in the page, and the same policy is checked again in the daemon before storage. Sign-in pages are detected by behavior (a visible password field), not just by URL. The agent gate refuses any sign-in or "Continue with…" control, so TAPI never signs in on your behalf.

### 3. Least privilege for credentials

- A credential is lent only from a request that actually carried it, and only if it hasn't expired.
- Credentials are scoped per site using the public suffix list, so two tenants of one hosting domain are never conflated.
- Cookies and web storage fill anti-forgery tokens and nothing else. A field that happens to be called `session` is never filled with the session cookie.
- Anti-forgery tokens come from the form the request actually submits. Amazon's product page holds six different tokens across eight forms, and the wrong one is both a failure and a security smell.
- An item's identifier is read only from the item the caller named, so an agent asked to add product A can't end up adding product B.

### 4. Humans stay in control of irreversible actions

Every tool is classified read, write, or destructive. A model can't casually downgrade a destructive tool: lowering risk requires agreeing answers across separate sightings. Destructive tools are hidden from search and refused at execution unless the caller can ask the user, and in the chat panel the user approves each one. A refusal is final, and the agent is told so explicitly.

Uncertain outcomes are never retried blindly. A write that times out is reported as "not known whether it was carried out" and is never sent twice. Low-confidence tools aren't offered to an agent at all.

## Honest outcomes

This is the part I find most interesting from a safety angle.

**A 200 can lie.** Amazon answers `200 OK` to an add-to-cart it silently ignored. A vision agent can't see that failure and a generic API wrapper reports it as success. TAPI confirms writes by where their effect later shows up (the cart's contents), read actively if need be, not by the status code.

**Models claim success they didn't achieve.** In live testing, a model read a product page saying the item was already in the cart and told the user it had added it, without calling any tool. Turning claims like that into checked facts is the core of my safety roadmap.

**Memory is framed as facts, not instructions,** so earlier page or tool content can't steer later turns.

## Auditing the catalog

I audited every text value in the local catalog on Oct 18, 2026: 395,349 values in 126,808 rows across 16 tables.

| Check                                       | Result                                         |
| ------------------------------------------- | ---------------------------------------------- |
| JWTs stored                                 | 0                                              |
| Bearer / Basic credentials stored           | 0                                              |
| Cookie values stored                        | 0                                              |
| Secrets replaced by placeholders at storage | 27,522 `{{secret:…}}`                          |
| Dedicated security tests                    | 30 of 284, run on every build                  |
| Daemon exposure                             | `127.0.0.1` only, per-start bearer token       |
| Recorded security design decisions          | 14, each tied to the failure that motivated it |

The method was a scan for credential shapes (JWT, `Bearer`/`Basic`, cookie headers) across a snapshot of the whole database. Long random-looking strings were sampled by hand and turned out to be identifiers (GraphQL operation names, document IDs, URNs, CSS selectors), not credentials. A scan like this shows absence of the shapes I know to look for; it doesn't prove absence of every possible secret, which is why redaction is enforced at the source rather than only checked afterwards.

## Known gaps

- Writes don't yet verify their own outcome everywhere. Proving "added" against the cart is still manual in places.
- Waiting for a page to finish loading adds up to about 5 s on heavy pages and can be shortened.

## Research directions

TAPI is a live testbed for agent safety in the real world: real accounts, real side effects, real adversarial pages.

- **Grounding agent claims:** making "I did X" a verified statement by checking every write against the state it should change.
- **Least-privilege tool exposure:** an agent sees only the tools a task needs, with risk, confidence, and history on every tool card.
- **Prompt injection from the web:** content a page returns is data the agent reads, never instructions it follows. TAPI sits exactly where that boundary has to be enforced.
- **Measured, not claimed:** a benchmark of accuracy, speed, and cost runs with the test suite, and a change that makes search or learning worse fails the build. Right now the needed tool is shown up front in 72.4% of 87 real logged requests.
