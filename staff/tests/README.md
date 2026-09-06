# Harvesting regression checks

From the agents repository, run:

```sh
dagger-dev run python3 staff/tests/integration.py
```

The engine must provide both the asynchronous Agent API and the frozen
Workspace Git API. The script serves the current staff module and exercises
its public harvesting methods with real agent handles and frozen workspaces.
It never starts an agent turn or calls a model, pushes, or exports. The only
host Git commits are in an automatically cleaned-up temporary fixture.

Coverage includes commit-plan metadata, root/ordinary/scoped patches, input
validation, fast-forward and divergent cherry-pick integration, duplicate
pulls, conflict refusal/recovery, and ordinary uncommitted work. Expected
validation failures appear as error spans even when the script passes.

Staff uses real Git history, not a separate staged-commit list. Integration
keeps the engine's 100-commit default bound; explicit SHA/prefix lookup scans
at most 10,000 recent commits. Commit patches are calculated from trees,
against the first parent (or an empty tree for root commits). Merge commits
can be inspected, but conflict recovery refuses to flatten them implicitly.
There is no separate `unmanaged`/gitignored-file harvesting path.
