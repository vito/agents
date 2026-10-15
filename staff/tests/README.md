# Staff regression checks

From the agents repository, run:

```sh
dagger-dev run python3 staff/tests/integration.py
```

The engine must provide the asynchronous Agent API, the frozen Workspace Git
API, and the expertise record from dagger/dagger#14637 (`LLM.expertise`,
`LLM.compose`, `LLM.recompose`, `Agent.parent`, `LLM.spawn(expertise:)`). The
script serves the current staff module. It never starts an agent turn or calls
a model, pushes, or exports. The only host Git commits are in an automatically
cleaned-up temporary fixture.

It exercises staff's escape hatches for UNCOMMITTED work — `pendingOf` and
`salvagePending` — with real agent handles and frozen workspaces. Coverage
includes pending summaries and path scoping, the pointer to a member's address
when nothing is pending, re-anchored salvage, and overlap failures with and
without conflict markers. Expected validation failures appear as error spans
even when the script passes.

It also exercises the worker role in a synthetic workspace installing staff
and a probe module: a worker spawned from a chief's recorded composition
inherits the probe, has the worker tools and no chief tools, carries its staff
name in its prompt, and has the chief as its parent. `LLM.recompose` on the
worker's snapshot, which is what Editor's reload does, keeps it a worker;
`LLM.compose` with `dag://staff/agent` adds the chief tools.

Committed work is not staff's concern: each member's history is the GitRef
at `dag://staff/members/head?staff-member=<name>`, harvested with git tools. The
agents-dev `committer-refs` and `staff-*` checks cover that path.
