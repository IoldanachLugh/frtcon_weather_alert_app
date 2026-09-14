# Instructions for Claude

At the start of any session in this repo, before making changes, read:

1. **`README.md`** — what the app does, how it's built, project structure.
2. **`CONTEXT.md`** — infrastructure, deployment, decisions made and why,
   known gotchas, shelved work. Anything not obvious from the code alone
   lives here. Read this before touching deployment, the service worker,
   or anything infrastructure-related.
3. **`PLAN.md`** — a running code-review findings/fix list, not a permanent
   doc. Items marked `✅ FIXED` have a **Done:** note describing what
   changed and how it was verified — read those before re-touching the
   same area, so you don't redo work or reverse a deliberate decision
   (e.g. the point-based alerts lookup, or the FRTCON 4 reclassification).
   Unmarked items are still open and worth checking before assuming
   something hasn't been considered.

## Keeping these in sync

When a change makes something in `README.md` or `CONTEXT.md` inaccurate,
update it as part of that change, not as separate cleanup later. When
fixing or deciding against something from `PLAN.md`, mark it and add a
**Done:** note the same way the existing entries do (what changed, how it
was verified, anything explicitly left out of scope).
