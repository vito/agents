1 important, 3 concerns

Verdict: The change does what it sets out to for imports in files, but it breaks union fragments on a shadowed type, and the REPL still changes the imported type. Fix ast_expressions.go:1183 and slots.go:350 first.

IMPORTANT:
- pkg/dang/ast_expressions.go:1183 — After a local `type User` shadows an import, `Test.search(query: "John").{ ... on User { name } }` resolves `User` to the local type and fails with "type User is not a member of union SearchResult". At the merge base it worked, because the local declaration reused the imported module. The grammar only accepts a bare Symbol after `on`, so `... on Test.User` can't be written either.
  worth it: Once a type is shadowed, fragments on the imported type cannot be written at all.
      memberType, found := modEnv.NamedType(frag.TypeName.Name)
  fix: In inferInlineFragments, look up the fragment's type name among the receiver union's members or the interface's implementers instead of `modEnv.NamedType`. Add an `... on User` case to test_import_shadowing.dang.
  also at pkg/dang/ast_expressions.go:1195, pkg/dang/dang.peg:215 · outside the hunks but caused by the change: post it on the conversation · 2/2 votes · fingerprint f8a3def012a9

CONCERN:
- pkg/dang/slots.go:350 — In the REPL, configured imports are loaded by `BuildEnvFromImports`, which adds imported types with `AddClass` but never calls `TrackUnqualifiedTypeImport`. When a user types `type Container { pub value: String! }`, `declareLocalType` finds the imported `Container`, sees no tracking entry, and reuses it. The declaration then adds fields to the imported schema type, which is the bug this commit sets out to fix.
  worth it: The fix depends on how the import got there, so the REPL keeps the old bug.
      if existing, found := env.LocalNamedType(name); found && !localTypeShadowsImport(env, name) {
  fix: Record locally declared type names (e.g. a `localTypeDecls` set on Module) and reuse an existing type only if it is in that set. Or call `TrackUnqualifiedTypeImport` in `BuildEnvFromImports`.
  also at pkg/dang/slots.go:331, pkg/dang/eval.go:382, cmd/dang/repl_tuist.go:202 · 2/2 votes · fingerprint bd9e0111702a
- pkg/dang/slots.go:350 — Which `User` a top-level annotation means now depends on the inference phase. Literal, `null` or type-only slots like `pub u: User = null` are inferred in the constants phase, which runs before the types phase hoists the local `type User`. So `u` gets `Test.User`, while every later `User` means the local type. At the merge base both were the same mutated module, so `u.origin` worked; now it fails as missing.
  worth it: Within one scope, the same type name resolves to two different types.
      if existing, found := env.LocalNamedType(name); found && !localTypeShadowsImport(env, name) {
  fix: Register local type names (types pass 0) before the constants phase in InferFormsWithPhases, or classify type-annotated slots as Variables. Add a `pub u: User = null` case to test_import_shadowing.
  also at pkg/dang/block.go:261, pkg/dang/block.go:302, pkg/dang/types.go:60 · 2/2 votes · fingerprint a9b67ca5b3bc
- tests/errors/import_shadowing_local_distinct.dang:30 — Shadowing creates two different types with the same printed name, and type errors print bare module names. The new golden file accepts messages like "cannot use User! as User!", "cannot use Status! as Status!" and "cannot use Node as Node". Should the imported side print qualified (`Test.User!`) so these errors are readable?
  worth it: These errors are the main signal users get when they mix up local and imported types.
      let userShouldFail: User! = Test.primaryUser
  fix: When printing a type that belongs to an import module (or when the two names in a mismatch are equal), use its qualified name such as `Test.User`, then regenerate the golden file.
  also at tests/errors/import_shadowing_local_distinct.dang:31, tests/testdata/import_shadowing_local_distinct.golden:4, tests/testdata/import_shadowing_local_distinct.golden:56, pkg/dang/env.go:875 · 2/2 votes · fingerprint 66a12271810b
Also raised, past the 3 strongest concerns:
- pkg/dang/slots.go:350 — Interface and union declarations used to build a fresh module on pass 0. They now go through `declareLocalType`, which reuses any local type already registered under that name. In the REPL, which keeps one type env across entries, redefining `interface Foo { pub a: String! }` as `interface Foo { pub a: Int! }` now fails with "already defined". Redefining `union U = A | B` as `A | C` leaves members A, B, A, C.
  fix: Only reuse the existing module for the ClassDecl/EnumDecl/ScalarDecl Hoist-then-Infer case. Interface and union pass 0 should always call NewModule+AddClass and clear the shadowed import, as they did at the merge base. · 2/2 votes

Checked and found sound: Imports are tracked before types pass 0 registers names; Pass 1 and Infer reuse the new local module; Clearing the alias resolves two-import ambiguity at type and eval time.

Reviewed 8406a0c..d7b82e0 (1 commit, 5 files changed) at STANDARD depth (votes needed: 2 of 2, or 2 of 3 on a split; nit 1 of 1): 4 finders, triage, 10 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: pkg/dang/slots.go:350 (general: "The fix only works when imports go through ImportDecl, which records t…"), pkg/dang/slots.go:331 (general-2: "Shadowing only happens when the name is recorded in `unqualifiedTypeIm…") into pkg/dang/slots.go:350: REPL BuildEnvFromImports doesn't track imports, so local typ…; tests/testdata/import_shadowing_local_distinct.golden:4 (behavior: "When a local type shadows an import, a mismatch between the two prints…"), tests/errors/import_shadowing_local_distinct.dang:30 (general-2: "When a local type shadows an import, values from the import, such as t…") into tests/errors/import_shadowing_local_distinct.dang:30: shadowed types print the same name in mismatch errors; pkg/dang/slots.go:1013 (design: "`InterfaceDecl` and `UnionDecl` used to create a fresh module in pass…") into pkg/dang/slots.go:350: interface/union redeclaration in REPL reuses existing local…
Dropped by the evidence checks (1): tests/testdata/import_shadowing_local_distinct.golden:4 (general): no cited location holds: tests/testdata/import_shadowing_local_distinct.golden:4 (quoted evidence does not appear in that file at head); tests/testdata/import_shadowing_local_distinct.golden:43 (quoted evidence does not appear in that file at head)
