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
description: Most computer-use agents guess at pixels and report "done" when nothing happened. Kore reads the OS accessibility tree, learns tasks as state graphs, and verifies every step against real UI state.
---

Computer-use agents are slow, expensive, and non-deterministic. Each click is a fresh guess from pixels, they take over your mouse and focus, and they often report "done" when nothing happened. That last part is what makes them unsafe to leave running on a real desktop.

Kore is a Windows computer-use agent built on a different premise: perceive the UI structurally, learn each task once, replay it deterministically, and never claim a success the UI doesn't confirm.

## Table of contents

## Demos

<video controls preload="metadata" poster="/videos/kore-spotify.jpg" width="100%"><source src="/videos/kore-spotify.mp4" type="video/mp4"></video>

_"Play je te laisserai des mots on Spotify."_

<video controls preload="metadata" poster="/videos/kore-flights.jpg" width="100%"><source src="/videos/kore-flights.mp4" type="video/mp4"></video>

_"Show me the cheapest flights from ATL to BLR on August 8."_

<video controls preload="metadata" poster="/videos/kore-background.jpg" width="100%"><source src="/videos/kore-background.mp4" type="video/mp4"></video>

_Background mode: Kore acts on a bound window while I keep using the machine._

## How it differs

|                | Typical agent         | Kore                                            |
| -------------- | --------------------- | ----------------------------------------------- |
| Perception     | Screenshots           | UI Automation (UIA) tree, screenshots as backup |
| Repeat a task  | Full model loop       | Replay a learned procedure                      |
| Success signal | Model says "done"     | Postconditions checked against the UIA tree     |
| Your desktop   | Takes mouse and focus | Background mode, never steals focus             |
| Failure        | Retries blindly       | Detects no progress, recovers once, or stops    |

A Tauri/React app talks over Socket.IO to a local Python backend (control loop, procedures, judgment, context), which calls a Rust UIA server for find, capture, actuate, and verify. Everything binds to `127.0.0.1`, and every step writes a bundle of what the model saw, what it was asked, and what it did, so any run can be replayed.

## From stochastic agent to learned state machine

A task is a path from one desktop state to a goal state, and Kore keeps the path that worked. A **procedure** stores entry anchors, then steps. Each step has an action template, ranked selectors, the _expected state_ afterward, and learned failure patches.

Replay walks that graph rather than a script. It checks preconditions, skips steps whose expected state already holds (so it can start from the middle), and polls a postcondition after every step before moving on. Slots like `{contact}` or `{query}` are inferred at record time and filled at replay time.

Confidence is earned: each procedure tracks success, failure, and when it was last verified, and unreliable ones fall back to the model. Learned replay came out about 8x cheaper and 3x faster than full replanning, and it behaves the same way each time.

## Safety: a wrong action can't go unnoticed

The question I kept asking was: _if the agent is wrong, how does anyone find out?_

- **Fail closed.** The Rust `verify` step fingerprints the UIA tree before and after each action. Typing isn't a success unless the text shows up in the bound window's tree. No change is an `Actuation_Failure`, not a fake "done".
- **Restore what you disturb.** A `ZeroFocusController` records your foreground window at task start. If focus drifts, it logs a `FocusDeviationEvent` and puts your window back.
- **Bounded recovery.** A failed step gets a learned patch, then one procedure-guided recovery, then Kore stops. Repeating an action with no state change ends the run, `max_steps` always applies, and clicks on window chrome are rejected.
- **Kill switch.** `Ctrl+Shift+X` or `POST /stop`.
- **Judgment layer.** Did the click hit the right thing? Is the goal really met? Deterministic rules decide first and a small LLM only breaks ties. Verdicts are cached, so the LLM is a tiebreaker, not the authority.

## Background mode

The most interesting branch drives one bound window with posted Windows messages and UIA patterns and never calls `SetForegroundWindow`. It adds per-window `PrintWindow` capture, a CDP client, and focus-deviation restore, and targeting is purely structural (control type, patterns, geometry) with no app-specific branches. The input planner is a pure function covered by Hypothesis property tests. It's the path to several agents on several windows while you keep working.

## Engineering

About 29k lines of Python, 6.7k of Rust, and 2.7k of TypeScript. 977 tests across unit, integration, property-based, and cargo suites, with ruff, mypy, clippy, a coverage gate, and a 500-line module cap. Spec first, code second.

## Next

Merge background mode into `main`, share learned procedures across users with a trust score, and turn the judgment layer into a policy gate for destructive actions (delete, send, pay).
