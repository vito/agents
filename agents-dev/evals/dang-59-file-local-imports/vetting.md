# Vetting dang-59-file-local-imports' known issues

The range is f60848c..1058f48: the first 8 of vito/dang#59's 13 commits ("make
imports file-local" through "skip disk reads via mtime cache"), stopping just
before the fixes. The labels come from history, not from reviews: each issue
below was fixed by one of the PR's later commits, the two bugs each with a
regression test that fails at 1058f48. That is why each one is vetted `real`
here already. The three after phase-groups-by-index are the exception: they
came from reviewer runs, not from the PR's later commits (whether one of those
fixed them is not checked), and they await a label (`real` or `dismiss`).

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

### schema-module-per-file
vetted:
bug · important · claimed (from reviewer runs, not history). Each file's
ImportDecl builds its own schema module (ast_declarations.go:1222), so
Container from a.dang and from b.dang are different types: "cannot use
Container! as Container!" across files.

### variables-ordered-per-file
vetted:
bug · important · claimed (from reviewer runs). Computed variables are ordered
within each file only (dir_inference.go:82), so a.dang's `pub x = y + 1` fails
with "y not found" when y is in b.dang. Contradicts lockstep-phases below; if
this is real, lockstep-phases probably wants `dismiss`.

### shared-mutable-parse-cache
vetted:
concern · minor · claimed (from reviewer runs). The LSP's parse cache shares
one mutable AST between a file's own analysis and its siblings' passes
(handler.go:408), so editing B rewrites what A's hover reads, and may race.

## Sound items

Things found correct when the case was compiled (not by history). Mark each
`sound` (it holds: a finding calling it broken is false) or `dismiss` (it does
not hold, or is no trap); left blank, a finding that contradicts it keeps the
judge's value unless the judge rated it false or a speed bump.

### lockstep-phases
vetted:
runDirectoryPhases runs each phase across every file before the next, so
cross-file references work regardless of file order.

### local-shadows-import-in-inference
vetted:
During inference each file's composite env reads the shared dirEnv before its
own imports, so a local declaration shadows an imported name.
