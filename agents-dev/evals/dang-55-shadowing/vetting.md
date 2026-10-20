# Vetting dang-55-shadowing's known issues

The range is d7b82e0 alone, the first commit of vito/dang#55 ("shadow imported
types locally", fixes #52), against its parent 8406a0c. The labels come from
history, not from reviews: every issue below was fixed by a later commit of
the same PR, which added a regression test (or golden) that fails at d7b82e0.
That is why each one is vetted `real` here already, except the last two, which
came from reviewer runs (whether a later commit fixed them is not checked) and
await a label (`real` or `dismiss`).

Not labelled: 01ee56e ("protect import aliases") also landed in the PR, but a
local `type Test` reusing the import alias module predates this commit, and
b8711d0 ("keep imported bindings private") is not clearly caused by it.

### fragment-resolves-local-type
vetted: real
bug · important · confirmed. Inline fragment type conditions resolve through
the ambient env (ast_expressions.go:1183), so `... on User` on a Test union or
interface picks the local shadowing User. Fixed by fdc3b6e0de, with
tests/test_inline_fragment_import_shadowing.dang and two error goldens.

### constant-annotation-before-hoist
vetted: real
bug · important · confirmed. Local type names are hoisted in the types phase,
after constants, so `pub maybe: User = null` above a local `type User` binds to
Test.User. Fixed by dcc8f89dfd (a "type names" phase after imports), with
tests/test_imported_type_shadowing_annotation.dang.

### indistinguishable-type-errors
vetted: real
concern · minor · confirmed. The change's own golden shows `cannot use User! as
User!`. Fixed by 9dc903dfda and af13384818, which qualify imported type names in
diagnostics.

### repl-imports-untracked
vetted:
bug · important · claimed (from reviewer runs). Shadowing is detected through
unqualifiedTypeImports, which the REPL's BuildEnvFromImports never fills
(eval.go:382), so in the REPL a local `type Container` still reuses and
mutates Dagger.Container.

### interface-union-redeclare-merges
vetted:
bug · minor · claimed (from reviewer runs). Interface and union pass 0 now
reuse an existing local module (slots.go:1013, :1121), so a REPL redeclaration
merges with the stale one (`union U = A | C` after `A | B` has members A, B,
A, C).

## Sound items

Things found correct when the case was compiled (not by history). Mark each
`sound` (it holds: a finding calling it broken is false) or `dismiss` (it does
not hold, or is no trap); left blank, a finding that contradicts it keeps the
judge's value unless the judge rated it false or a speed bump.

### imported-module-not-mutated
vetted:
A shadowing local declaration gets a fresh module (declareLocalType) instead of
mutating the imported type, so Test.User still resolves to the imported one.

### all-kinds-covered
vetted:
Type, enum, scalar, interface and union declarations all go through
declareLocalType, and the gqlserver tests cover each kind.
