1 important

Verdict: This fixes stale-state reloads for fresh sessions. The committer still has rebind paths that drop the version, so fix the rebinds behind committer/main.dang:87 (lines 388, 818, 1453, 1477) first.

IMPORTANT:
- committer/main.dang:87 — After a session runs `reset`, a `rebase` that stops on a conflict, `rebaseAbort`, or a finished rebase, the committer binding is back at version 0. Those tools rebind with a plain `llm.withTools(tools, except: plumbing)`, and in the engine an explicit withTools sets the version from its own argument, which defaults to 0. On the next reload, 0 ≠ 1, so the engine resets committer state: the saved-workspace map and any in-progress rebase are lost.
  worth it: mid-rebase reloads lose rebaseContinue/Abort; reset's 'return to previous' stops working
      .withTools(currentNode, except: plumbing, version: 1)
  fix: Pass `version: 1` in all four committer continuations (lines 388, 818, 1453, 1477), ideally through a shared `let stateVersion = 1` that `agent` uses too, so one bump updates them all.
  also at committer/main.dang:1453, committer/main.dang:388, committer/main.dang:818, committer/main.dang:1477 · 2/2 votes · fingerprint 8f1497e2d847

Checked and found sound: Old unversioned state now resets on reload instead of failing; Staff worker bindings (peers, chiefLine) are separate types; Version check runs before the field conversion that errored.

Reviewed 0e90428..dfc7196 (1 commit, 2 files changed) at STANDARD depth (votes needed: 2 of 2, or 2 of 3 on a split; nit 1 of 1): 4 finders, triage, 2 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: committer/main.dang:87 (general, behavior, design: "Committer's own state-changing tools rebind themselves with `llm.withT…") into committer/main.dang:87: Committer's own tools rebind without a version, which resets…
