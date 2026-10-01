# Escape-hatch regression checks

From the agents repository, run:

```sh
dagger-dev run python3 staff/tests/integration.py
```

The engine must provide both the asynchronous Agent API and the frozen
Workspace Git API. The script serves the current staff module and exercises
its escape hatches for UNCOMMITTED work — `pendingOf` and `salvagePending` —
with real agent handles and frozen workspaces. It never starts an agent turn
or calls a model, pushes, or exports. The only host Git commits are in an
automatically cleaned-up temporary fixture.

Coverage includes pending summaries and path scoping, the pointer to a
member's address when nothing is pending, re-anchored salvage, and overlap
failures with and without conflict markers. Expected validation failures
appear as error spans even when the script passes.

Committed work is not staff's concern: each member's history is the GitRef
at `dag://staff/members/head?member=<name>`, harvested with git tools. The
agents-dev `committer-refs` and `staff-*` checks cover that path.
