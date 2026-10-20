1 important

Verdict: The version bump does fix the stale-state reload failure, but it breaks reloads in the committer's own rebinds. Fix the unversioned `withTools` rebinds in committer/main.dang (lines 388, 818, 1453, 1477) first.

IMPORTANT:
- committer/main.dang:87 — Four committer tools rebuild their own binding with `llm.withTools(tools, except: plumbing)` and no `version`: `reset`, a rebase that stops, a rebase that finishes, and `rebaseAbort`. That sets the Committer binding back to version 0, while `agent` now binds version 1. The next reload sees 0≠1 and wipes the state. An in-progress rebase is lost (`rebaseContinue` then says no rebase is in progress), and so are the `saved` workspaces. Before this change both sides were 0, so this state survived a reload.
  worth it: A mid-session self-repair reload now loses rebase progress and the reset history.
      .withTools(currentNode, except: plumbing, version: 1)
  fix: Add `let stateVersion = 1` in Committer and pass `version: stateVersion` in `agent` and at all four rebind sites (lines 388, 818, 1453, 1477). Move the 'bump version' comment onto that constant.
  also at committer/main.dang:388, committer/main.dang:1453, committer/main.dang:1477, committer/main.dang:818 · 2/2 votes · fingerprint 147a79b9f35e

Checked and found sound: Staff has no rebind of its own type mid-session; Peers/ChiefLine bindings on worker LLMs don't need the version; Same-type tool returns keep the binding's version.

Reviewed 0e90428..dfc7196 (1 commit, 2 files changed) at STANDARD depth (votes needed: 2 of 2, or 2 of 3 on a split; nit 1 of 1): 4 finders, triage, 2 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: committer/main.dang:87 (general, behavior, general-2: "The committer's tools that return a new LLM (reset, the rebase stop, r…") into committer/main.dang:87: tools rebind withTools without version, resetting to 0 and w…
