1 important, 1 nit

Verdict: The staff half does what it sets out to, but the committer half doesn't yet. Its rebinding tools at committer/main.dang:388, 818, 1453 and 1477 need `version: 1` before this merges.

IMPORTANT:
- committer/main.dang:87 — Five committer tools rebind the toolset with `llm.withTools(tools, except: plumbing)` and no version: reset, rebase, rebaseContinue, rebaseSkip and rebaseAbort. The binding then drops back to version 0, so the next reload sees 0≠1 and resets Committer to its defaults. Saved workspaces and the `saved` addresses are lost, and so is any rebase in progress. That breaks rebaseAbort and leaves the conflict markers in the tree with no banner.
  worth it: Resetting tool state was meant as a one-time migration. As written, every reload after a reset or rebase resets it again.
      .withTools(currentNode, except: plumbing, version: 1)
  fix: Define a single `let stateVersion = 1` in Committer. Pass `version: stateVersion` in agent() and at lines 388, 818, 1453 and 1477, so a bump changes every binding together.
  also at committer/main.dang:388, committer/main.dang:818, committer/main.dang:1453, committer/main.dang:1477 · 2/2 votes · fingerprint 86e004c38635

NIT:
- committer/main.dang:83 — The new comment says to bump the version in `agent()`. It doesn't mention that the committer's rebinding tools must pass the same number, so a future bump will leave them behind again. Both the `reset` comment ("so the map persists") and this one assume one binding site, but there are five.
  fix: Reword the comment to point at a shared `stateVersion` constant that every `withTools(currentNode…)`/rebind call in committer uses.
  also at committer/main.dang:385 · 1/1 votes · fingerprint 77a22418ea5d

Checked and found sound: A version mismatch skips field conversion, so the old error goes away; Staff tools return Staff!, so they keep the bound version; Staff's worker bindings (peers, chiefLine) are other types and unaffec…

Reviewed 0e90428..dfc7196 (1 commit, 2 files changed) at STANDARD depth (votes needed: 2 of 2, or 2 of 3 on a split; nit 1 of 1): 4 finders, triage, 3 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: committer/main.dang:87 (behavior, design, general-2: "The four continuation rebinds in committer (`reset`, `rebaseAbort`, th…") into committer/main.dang:87: rebind tools call withTools without a version, so the stored…
