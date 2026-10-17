# Vetting agents-tools-version's known issues

The range is dfc7196 alone ("agents: version committer and staff tool state")
against its parent 0e90428 in vito/agents. The label comes from history, not
from reviews: the bug was fixed by vito/agents#34 (merged 2026-10-16) and, in
this repository's history, by c6765e4. That is why it is vetted `real` here
already. Neither fix adds a test (the API does not expose a binding's version);
"confirmed" rests on the fix and the engine's reset message, not a test.

### continuations-bind-version-zero
vetted: real
bug · important · confirmed. The agent entry binds Committer at withTools
version 1, but reset, rebaseAbort and the rebase stop/finish continuations still
rebind it at version 0 (committer/main.dang:388, :818, :1453, :1477), so the next
reload resets its state (saved workspaces, rebase progress). The four call sites
are outside the diff.
