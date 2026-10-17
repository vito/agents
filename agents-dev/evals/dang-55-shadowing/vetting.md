# Vetting dang-55-shadowing's known issues

The range is d7b82e0 alone, the first commit of vito/dang#55 ("shadow imported
types locally", fixes #52), against its parent 8406a0c. The labels come from
history, not from reviews: every issue below was fixed by a later commit of
the same PR, which added a regression test (or golden) that fails at d7b82e0.
That is why each one is vetted `real` here already.

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
