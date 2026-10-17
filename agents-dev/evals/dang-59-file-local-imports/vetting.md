# Vetting dang-59-file-local-imports' known issues

The range is f60848c..1058f48: the first 8 of vito/dang#59's 13 commits ("make
imports file-local" through "skip disk reads via mtime cache"), stopping just
before the fixes. The labels come from history, not from reviews: each issue
below was fixed by one of the PR's later commits, the two bugs each with a
regression test that fails at 1058f48. That is why each one is vetted `real`
here already.

### imports-shared-at-runtime
vetted: real
bug · important · confirmed. RunDir still evaluates every file in one flattened
block against a shared env, so imports are file-local only during inference and
an import in a.dang overrides b.dang's own `pub container: String!` at runtime.
Fixed by a83340ce72 (per-file evaluation via CompositeEvalEnv), then b0ffce338a.
Caveat: the runtime's "already defined" shortcut in SlotDecl.Eval predates the
range, so some form of the mismatch may have existed before; what the range
adds is the split itself (per-file scopes in inference, one shared scope at
runtime), which a83340ce72 names as the bug ("file-local imports must hold at
runtime too").

### focused-inference-skips-sibling-variables
vetted: real
bug · important · confirmed. The LSP's focused inference skips the variables
phase for siblings, so a sibling's unannotated `pub answer = ...` is "not found"
from the active buffer. Fixed by 131c9eaf7e, with
TestDiagnosticsResolvesUnannotatedSiblingVars.

### phase-groups-by-index
vetted: real
cleanup · minor · claimed. declarationPhases/bodyPhases are index slices
(inferencePhases[:6], [6:]) that misalign silently when phases change.
Refactored in b0c575c49b.
