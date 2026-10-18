1 important

Verdict: The version bump fixes the reload failure for old sessions, but committer's other rebinds still go back to version 0. Fix the unversioned withTools calls at committer/main.dang:388, 818, 1453 and 1477 before merging.

IMPORTANT:
- committer/main.dang:87 — In committer, `reset`, the rebase stop (`advance`), `finished` and abort all rebind tools with `llm.withTools(tools, except: plumbing)` and no version. That sets the binding back to version 0. On the next reload it is compared with the `agent()` binding at version 1, so the engine throws the Committer state away: saved workspaces and any rebase in progress are lost. At the merge base both sides were 0, so this state survived reloads.
  worth it: after any reset or rebase, reloading loses the `saved` workspaces and in-progress rebase state
      .withTools(currentNode, except: plumbing, version: 1)
  fix: Pass `version: 1` at all four rebind sites, committer/main.dang lines 388, 818, 1453 and 1477, through one shared `let toolsVersion = 1` that `agent()` also uses, so a bump changes every site.
  also at committer/main.dang:388, committer/main.dang:1453, committer/main.dang:818, committer/main.dang:1477 · 2/2 votes · fingerprint fe09cc0a602f

Checked and found sound: Old version-0 sessions now reset instead of failing; Matching versions still keep saved state on reload; Staff rebinds keep the version through Staff! returns.

Reviewed 0e90428..dfc7196 (1 commit, 2 files changed) at STANDARD depth (votes needed: 2 of 2, or 2 of 3 on a split; nit 1 of 1): 4 finders, triage, 4 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: committer/main.dang:87 (general, design, general-2: "Four committer tools rebind with `llm.withTools(tools, except: plumbin…") into committer/main.dang:87: committer rebinds via withTools without version reset bindin…
Below quorum: staff/main.dang:67 (0/2, needed 2)
