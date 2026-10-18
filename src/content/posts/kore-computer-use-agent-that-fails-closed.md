---
title: "Kore: a computer-use agent that learns, verifies, and fails closed"
author: Tejesh Reddy
pubDatetime: 2026-10-18T20:00:00Z
featured: true
draft: false
tags:
  - ai-safety
  - computer-use
  - agents
  - rust
description: Most computer-use agents guess at pixels and report "done" when nothing happened. Kore reads the OS accessibility tree, learns tasks as state graphs, and verifies every step against real UI state.
---

Computer-use agents are slow, expensive, and non-deterministic. Each click is a fresh model guess from pixels. They take over your mouse and focus. Worst of all, they often report "done" when nothing happened. That last property is the one that makes them unsafe to leave running on a real desktop.

Kore is my attempt at a Windows computer-use agent built around a different premise: perceive the UI structurally, learn each task once, replay it deterministically, and never claim a success the UI doesn't confirm.

## Table of contents

## What is different

|                | Typical computer-use agent | Kore                                                       |
| -------------- | -------------------------- | ---------------------------------------------------------- |
| Perception     | Screenshots                | UI Automation (UIA) element tree, screenshot as backup     |
| Repeat a task  | Full model loop again      | Replay a learned procedure                                 |
| Success signal | Model says "done"          | Postconditions checked against the UIA tree                |
| User's desktop | Takes mouse and focus      | Background mode that never steals focus (on a branch)      |
| Failure        | Retries blindly            | Detects no progress, stops, recovers once, or fails closed |

## Architecture

```
 Tauri + React desktop app (chat, live steps, Stop)
            │ Socket.IO
 Python backend: FastAPI + Socket.IO, 127.0.0.1:9991
   ├─ core/loop         control loop and step runner
   ├─ core/procedures   record → store → replay (pre/postconditions)
   ├─ core/judgment     goal and click verdicts: rules first, small LLM if unclear
   ├─ context           UIA capture → element index → retrieval → summary
   └─ actions           UIA find/click, input, system, dispatch
            │ HTTP
 Rust native UIA server, 127.0.0.1:9992
   find · capture · inspect · actuate · verify (before/after tree fingerprints)
```

Everything is local; both servers bind to `127.0.0.1`. Every step writes an observability bundle (the context the model saw, the model call, the action taken), so any run can be replayed and debugged after the fact.

The find/click contract is deliberately boring: match by label, and if the match is ambiguous, return the candidates instead of guessing.

## From stochastic agent to learned state machine

Kore treats a task as moving the desktop from one state to a goal state, then keeps the path that worked.

- **State**: app, window title, focused element name and type, visible anchors, and tags.
- **Goal**: an intent, an app, and slots such as `{contact}` or `{query}`.
- **Procedure**: entry anchors (where it may start), then steps. Each step has an action template, ranked selector candidates, the _expected state tags_ after it, a settle time, and learned failure patches.

Replay walks the graph rather than a script:

1. A precondition gate checks that the current state matches the entry anchors.
2. Steps whose expected state already holds are skipped, so replay works from a midpoint, not only from the start.
3. After each step, Kore polls a postcondition with a per-action time budget. It moves on only when the expected state actually appears.
4. Slots are inferred at record time and filled at replay time, so one procedure covers many inputs.

Confidence is earned, not assumed. Each procedure tracks success and failure counts, reliability, and when it was last verified. Unreliable procedures fall back to the model. In practice, learned replay was about 8x cheaper and 3x faster than full replanning, and it runs the same way each time.

## Safety: a wrong action can't go unnoticed

The design question I kept asking was: _if the agent is wrong, how does anyone find out?_

**Fail closed.** The Rust `verify` step fingerprints the UIA tree before and after each action. Typing isn't a success unless the text appears in the bound window's tree. No change yields an `Actuation_Failure`, not a fake "done".

**Restore what you disturb.** In background mode, a `ZeroFocusController` records the user's foreground window at task start. If focus drifts, it logs a `FocusDeviationEvent` and restores the user's window.

**Bounded recovery.** When a step fails, Kore tries a learned failure patch, then one procedure-guided recovery. Then it stops. It does not loop.

**No runaway loops.** The same action repeated N times with no state change ends the run, and a `max_steps` cap always applies. Clicks on window chrome and title bars are rejected outright.

**Kill switch.** `Ctrl+Shift+X` or `POST /stop` halts everything immediately.

**A judgment layer.** Did the click hit the right thing? Is the goal really met? Deterministic rules decide first, and a small LLM decides only when the rules can't. Verdicts are pass, fail, or ambiguous, and they are cached. The LLM is a tiebreaker, not the authority.

## Zero-Focus background mode

The most interesting branch drives one bound window with posted Windows messages and UIA patterns and never calls `SetForegroundWindow`. It adds per-window `PrintWindow` capture, Chromium wake-up, a CDP client, and focus-deviation restore. Targeting is structural (control type, patterns, geometry), with all app-specific branches removed. A pure `MessageInputPlanner` is covered by Hypothesis property tests. This is the path to several agents working on several windows while the user keeps working.

## Engineering

- Roughly 29k lines of Python, 6.7k of Rust, and 2.7k of TypeScript on `main`.
- 977 tests across 197 files: unit, integration, smoke, property-based, and cargo tests.
- Gates: modules capped at 500 lines, ruff, mypy, clippy, and a coverage gate.
- Spec first, code second. The background mode has a full requirements and design doc.

## What's next

- Merge Zero-Focus and the bound-window lane into `main` for parallel agents.
- Share learned procedures across users, with a trust score.
- Turn the judgment layer into a policy gate for destructive actions (delete, send, pay).

The through-line is the same one I care about in everything I build with agents: claims about the world should be checked against the world.
