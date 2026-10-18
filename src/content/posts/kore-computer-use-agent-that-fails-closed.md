---
title: "Kore: a computer-use agent that fails closed"
author: Tejesh Reddy
pubDatetime: 2026-10-18T20:00:00Z
featured: true
draft: false
tags:
  - ai-safety
  - computer-use
  - agents
  - rust
description: I wanted to know if an AI could really work on your PC, not through narrow app connectors. Kore reads the OS accessibility tree, learns tasks as state graphs, and verifies every step against real UI state.
---

Most "agents" that act on software do it through connectors: one integration per app, each limited to whatever that app exposes. I started Kore in November 2025 because I was curious whether an AI could actually take over a PC and work on it the way a person does, across any app.

The first version showed me the real problem. Computer-use agents are slow, expensive, and non-deterministic. Each click is a fresh guess from pixels, they take over your mouse and focus, and they often report "done" when nothing happened. That last part is what makes them unsafe to leave running on a real desktop.

So Kore became a Windows computer-use agent built on a different premise: perceive the UI structurally, learn each task once, replay it deterministically, and never claim a success the UI doesn't confirm.

## Table of contents

## Why I kept going

I'd meant to apply to YC with Kore, but the timing didn't work out, so I kept building instead. Every question after that was about the same thing: how do I make this faster, cheaper, more accurate, and safer? Safety got most of my attention. Anyone who lets an agent drive their desktop is mostly worried about what it might do wrong, and so was I.

The ideas I ended up with, grouped by what they're for:

**Speed and cost**

- Learn a task once as a state-graph procedure, then replay it without asking the model what to click.
- Skip steps whose expected state already holds, so a replay can start from the middle.
- Infer slots at record time (`{query}`, `{contact}`) so one procedure covers many inputs.
- Let deterministic rules judge outcomes first and call a small LLM only when they can't.
- Earn confidence per procedure, and fall back to the model when a procedure proves unreliable.

**Accuracy**

- Read the OS UI Automation (UIA) tree instead of guessing from pixels, keeping screenshots as a backup.
- Find and click by label, and when a label is ambiguous, return the candidates instead of guessing.
- Target structurally (control type, patterns, geometry) with no per-app special cases.
- Poll a postcondition after every step, with a time budget per action type.

**Safety**

- Fail closed: fingerprint the UIA tree before and after each action, and call it a failure when nothing changed.
- Run in the background without stealing focus, and put the user's window back if focus drifts.
- Bound recovery: one learned patch, one guided retry, then stop. End runs that repeat an action with no state change.
- Refuse clicks on window chrome, keep a global kill switch, and bind everything to `127.0.0.1`.
- Write an observability bundle for every step so any run can be replayed and audited.

The rest of this post shows those ideas working and explains the ones that matter most.

## Demos

The clips are unedited screen recordings, with Kore's step log in the right-hand panel.

### Cold run, then learned replay

<video controls preload="metadata" poster="/videos/kore-spotify.jpg" width="100%"><source src="/videos/kore-spotify.mp4" type="video/mp4"></video>

Two tasks back to back. The first ("play je te laisserai des mots on spotify") is a cold run: open Spotify, type the query, click the result. Kore's first play click is flagged ✗ in the log. It retries, and only then reports "Task complete".

The second ("play the night we met on spotify") starts with steps tagged **PROCEDURE**: _Focused app for procedure_, _Focused app_, _Entered query_. That is the procedure learned from the first task, replayed with a new `{query}` slot. Picking which result to play is not tagged as procedure, so that last step is still decided live.

### Another app, same loop

<video controls preload="metadata" poster="/videos/kore-flights.jpg" width="100%"><source src="/videos/kore-flights.mp4" type="video/mp4"></video>

_"Show me the cheapest flights from ATL to BLR on August 8."_ Kore opens Chrome, searches Google, clicks the Flights tab, then the Cheapest tab, and lands on the $904 round trip (Aug 8 to Aug 12, the dates Google Flights defaulted to). It also leaves the page's "Travel restricted" banner on screen for the user to see.

### Background mode

<video controls preload="metadata" poster="/videos/kore-background.jpg" width="100%"><source src="/videos/kore-background.mp4" type="video/mp4"></video>

Same Spotify task with _Bound automation_ on in settings, which drives the target app in the background through native UIA and acts on the bound window only. Kore launches Spotify, clicks Search, types the query, and clicks play while the OBS window I'm recording with stays in front of it.

## How it works

|                | Typical agent         | Kore                                            |
| -------------- | --------------------- | ----------------------------------------------- |
| Perception     | Screenshots           | UI Automation (UIA) tree, screenshots as backup |
| Repeat a task  | Full model loop       | Replay a learned procedure                      |
| Success signal | Model says "done"     | Postconditions checked against the UIA tree     |
| Your desktop   | Takes mouse and focus | Background mode, never steals focus             |
| Failure        | Retries blindly       | Detects no progress, recovers once, or stops    |

A Tauri/React app talks over Socket.IO to a local Python backend (control loop, procedures, judgment, context), which calls a Rust UIA server for find, capture, actuate, and verify.

### From stochastic agent to learned state machine

A task is a path from one desktop state to a goal state, and Kore keeps the path that worked. A **procedure** stores entry anchors, then steps. Each step has an action template, ranked selectors, the _expected state_ afterward, and learned failure patches.

Replay walks that graph rather than a script. It checks preconditions, skips steps whose expected state already holds, and polls a postcondition after every step before moving on. Learned replay came out about 8x cheaper and 3x faster than full replanning, and it behaves the same way each time.

### Safety: a wrong action can't go unnoticed

The question I kept asking was: _if the agent is wrong, how does anyone find out?_

- **Fail closed.** The Rust `verify` step fingerprints the UIA tree before and after each action. Typing isn't a success unless the text shows up in the bound window's tree. No change is an `Actuation_Failure`, not a fake "done".
- **Restore what you disturb.** A `ZeroFocusController` records your foreground window at task start. If focus drifts, it logs a `FocusDeviationEvent` and puts your window back.
- **Bounded recovery.** A failed step gets a learned patch, then one procedure-guided recovery, then Kore stops. `max_steps` always applies.
- **Kill switch.** `Ctrl+Shift+X` or `POST /stop`.
- **Judgment layer.** Did the click hit the right thing? Is the goal really met? Deterministic rules decide first and a small LLM only breaks ties. Verdicts are cached, so the LLM is a tiebreaker, not the authority.

### Background mode

The hardest part was background control on Windows. The branch drives one bound window with posted Windows messages and UIA patterns and never calls `SetForegroundWindow`. It adds per-window `PrintWindow` capture, a CDP client, and focus-deviation restore. The input planner is a pure function covered by Hypothesis property tests. It's the path to several agents on several windows while you keep working.

### Engineering

About 29k lines of Python, 6.7k of Rust, and 2.7k of TypeScript. 977 tests across unit, integration, property-based, and cargo suites, with ruff, mypy, clippy, a coverage gate, and a 500-line module cap. Spec first, code second.

## What happened next

Just before my Amazon internship I wrote to a number of people working on computer use. One of them, Ari Weinstein, replied. He is the CEO and co-founder of Software Applications Inc., the company behind Sky, which OpenAI acquired in October 2025, and he works on computer use there. We set up a call, I showed him Kore, and we kept talking about computer use and what it takes to do it well.

At one point he asked whether I knew how to do real background control on Windows. I didn't yet. I went away, learned how it works, and implemented it in Kore, and it worked. That is where the background mode above comes from. I also spoke with his co-founder, Conrad Kramer, and a lot of our conversation was about the safety implications of letting an agent act on a machine.

It didn't turn into a role, but I learned a lot from those conversations, and they sharpened how I think about the safety side.

## Where it goes next

Merge background mode into `main`, share learned procedures across users with a trust score, and turn the judgment layer into a policy gate for destructive actions (delete, send, pay).

Kore also made me look at the opposite end of the problem. App-specific connectors are fast and reliable, but there's one per app. What if they could be learned instead? That became [TAPI](/posts/tapi-learning-web-apis-without-leaking-credentials/).
