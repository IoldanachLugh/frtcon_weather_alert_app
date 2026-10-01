# Working on this repo

> Shared for portfolio & demonstration purposes. All rights reserved.

This project was built with Claude Code as a pair programmer. This file is
what Claude Code reads automatically at the start of each session. The same
advice applies to anyone else working on the code.

## Read these first

- **[README.md](README.md)** explains what the app does, how it's built, and
  how the code is laid out.
- **[CONTEXT.md](CONTEXT.md)** covers hosting, design decisions and the
  reasons for them, and known gotchas. Read it before changing deployment,
  the service worker, or anything else infrastructure-related.
- **[PLAN.md](PLAN.md)** is the code review log. Each entry records what was
  changed and how it was verified. Check it before changing an area it
  covers, so you don't undo a deliberate decision, like looking up alerts
  by point or moving Frost Advisory to FRTCON 4.

## Keeping the docs current

- If a change makes something in the README or CONTEXT.md wrong, update the
  doc in the same change.
- When you fix something or decide against it, add an entry to PLAN.md
  saying what changed, how it was verified, and anything left out of scope.
