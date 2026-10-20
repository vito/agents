1 important, 1 nit

Verdict: Versioning the agent binding fixes reloading sessions from before the refactor, and it fits how browser already does this. Fix first: committer's reset and rebase rebinds still omit `version`, so they drop back to 0 and the next reload wipes saved workspaces.

IMPORTANT:
- committer/main.dang:87 — reset (committer/main.dang:388), rebaseAbort (818), a rebase that stops at a conflict (1453) and a finished rebase (1477) all return `llm.withTools(tools, except: plumbing)` with no `version`. In the engine, `version` defaults to 0 and replaces the binding in place, so after any of these tools the Committer binding is back at version 0. At the next reload or recomposition, `agent` binds version 1, and `preserveRecomposedTools`/`recomposeToolReceiver` treat 0≠1 as an incompatible state contract and reset the Committer to its defaults. That throws away `savedWorkspaces` and any in-progress rebase. At the merge base both sides were 0, so this state was carried over. I traced this through the engine source (mnt dagger@main: core/llm_object_tools.go:118-135, core/agents_reload.go:82 and 125-130, and llm_composition_test.go:124 "omitting version defaults to 0"). I did not run it end to end.
  worth it: if an agent reloads in the middle of a rebase, it loses the rebase it was resolving, and every reload after a reset forgets the saved workspaces. Both survived before this change. The fix is to pass `version: 1` on all four rebinding calls, or keep it in a shared constant.
  evidence:
      .withTools(currentNode, except: plumbing, version: 1)
  also at committer/main.dang:1453, committer/main.dang:388, committer/main.dang:818, committer/main.dang:1477
  votes: 3/3 confirmed · correctness (general) · fingerprint a39670758ebf

NIT:
- committer/main.dang:83 — The new "Bump version" comment only points at `agent`, but in committer the version also has to match in every `llm.withTools(tools, except: plumbing)` rebind. Either say that in the comment or pull the version into one shared value so the next bump cannot miss those calls.
  worth it: otherwise the next version bump will repeat the mismatch above
  votes: 3/3 confirmed · docs (general) · fingerprint 3c2ccdbdbcf4

Checked and found sound:
- Staff tools return `Dagger.Staff!` and never re-call withTools on Staff, so version 1 survives tool calls.
- Worker bindings (Peers, ChiefLine) are separate types and unversioned, so this change does not affect them.
- The engine's withTools accepts `version` (default 0), and browser/main.dang already uses `version: 1`.
- Bumping to 1 resets saved state from before the `saved`/`members` refactors instead of failing to load it.
- Staff's compositionSource is rebuilt in `agent()` after a version reset, so composition still works.

Reviewed 0e90428..dfc7196 (merge base..head): 1 commit, 2 files changed, at STANDARD depth (3 finders; 3 voters per finding, quorum 2).
Sub-agents composed from: dag://?llm=committer/readonly, dag://?llm=contributor/readonly, dag://?expertise=editor/agent, dag://?llm=reviewer/finder, dag://?llm=reviewer/voter, dag://?llm=reviewer/synthesizer
Failing tests or checks listed for this call under finder-*, voter-* or synthesizer agents are the reviewers' own reproductions, run in private sandboxes (often written to fail on purpose to demonstrate a finding); they are not this change's CI results.

Merged into an earlier finding quoting the same code (3):
  - committer/main.dang:87 (behavior): Committer's reset, rebase (when it stops at a conflict), rebaseContinue/rebaseSkip (when they finish) and rebaseAbort return `llm.withTools(tools, except: plumb…
  - committer/main.dang:87 (design): Only `agent()` binds Committer with `version: 1`. `reset`, `rebaseAbort` and the rebase stop/finish helpers rebind it with a bare `llm.withTools(tools, except:…
  - committer/main.dang:83 (design): The new comment says to bump the version in `agent()` only. In committer every explicit self-rebind (reset, rebase stop/finish, rebaseAbort) must pass the same…
Below quorum (2 of 3): staff/main.dang:67 (0/3 confirmed)

Answer every finding: fix it (a re-review marks it FIXED), or resolve(fingerprint:, reason:). To post one on a pull request, pass its path and line to comment(path:, line:); one marked outside the hunks goes on the conversation instead.
