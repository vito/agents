1 important, 3 concerns

Verdict: The change shadows imported types correctly for file-based scripts, but not in the REPL. Fix the REPL path at pkg/dang/slots.go:350 first, then decide on the phase-dependent binding at block.go:261.

IMPORTANT:
- pkg/dang/slots.go:350 — Shadowing only works when the import was recorded in `unqualifiedTypeImports`. The REPL builds its environment with `BuildEnvFromImports`, which calls `AddClass` but never records the import. There, `declareLocalType` hands back the imported module. So `type`/`enum`/`scalar` still change the imported type, and `interface`/`union` now do too. Before this change those two always created a fresh module, so in the REPL they used to shadow correctly.
  worth it: Whether shadowing works now depends on how imports were installed; the REPL regresses for interfaces and unions.
      if existing, found := env.LocalNamedType(name); found && !localTypeShadowsImport(env, name) {
  fix: Make `BuildEnvFromImports` call `TrackUnqualifiedTypeImport`/`TrackUnqualifiedValueImport` for every type and binding it installs, or have it reuse `ImportDecl.importUnqualifiedSymbols`. Add a REPL-style test: `BuildEnvFromImports` followed by `InferFormsWithPhases` on `interface Node {...}`.
  also at pkg/dang/slots.go:1013, pkg/dang/slots.go:1121, pkg/dang/slots.go:331, pkg/dang/eval.go:382 · 2/2 votes · fingerprint 5e30e2e0a779

CONCERN:
- tests/testdata/import_shadowing_local_distinct.golden:4 — A local type and the imported type it shadows now have the same `Name()`. A mismatch between them reads as "cannot use User! as User!" (or "Status! as Status!", "Node as Node"), which tells the user nothing. The new golden file records this as the expected output.
  worth it: Users who hit the new shadowing behavior get errors they can't act on.
      cannot use User! as User!
  fix: In the mismatch error, qualify both type names with their source (e.g. `Test.User` vs `User`) when they match but are different types. Then regenerate `import_shadowing_local_distinct.golden`.
  also at tests/errors/import_shadowing_local_distinct.dang:30, tests/errors/import_shadowing_local_distinct.dang:31, tests/errors/import_shadowing_local_distinct.dang:33, pkg/hm/unify.go:14 · cited but not found at head: tests/testdata/import_shadowing_local_distinct.golden:4 (quoted evidence does not appear in that file at head) · 2/2 votes · fingerprint 96dae37914a1
- pkg/dang/slots.go:1013 — Interfaces and unions now reuse an existing local module instead of creating a new one in Hoist pass 0. In the REPL (one persistent typeEnv), redeclaring `interface Named { pub title: String! }` keeps the old `name` field, so a class implementing it fails with "missing `name`". Redeclaring `union U = A | C` after `A | B` leaves members [A, B, A, C].
  worth it: Redefining types in the REPL now merges with stale definitions instead of replacing them.
      iface := declareLocalType(mod, i.Name.Name, InterfaceKind)
  fix: For InterfaceDecl/UnionDecl keep creating a new module, e.g. give `declareLocalType` a `reuse bool` parameter (true only for class/enum/scalar). Or clear members/fields when reusing.
  also at pkg/dang/slots.go:1121, pkg/dang/slots.go:1170, pkg/dang/slots.go:572, cmd/dang/repl_tuist.go:427 · 2/2 votes · fingerprint 517258f0d8e2
- pkg/dang/block.go:261 — Top-level constant slots are type-checked before types are hoisted. This covers `pub s: Status = null` and value-less `pub s: Status`, and directive declarations run before types too. Their annotation therefore binds to the imported `Test.Status`, while every later use of `Status` means the local enum. A later `s = Status.LOCAL` then fails with a same-name mismatch. At the merge base both names pointed to one module. Is a type's meaning meant to depend on the compile phase?
  worth it: Resolving an unqualified type name now depends on which phase reads it.
      {"constants", func(errs *InferenceErrors) (hm.Type, error) {
  fix: Before the imports phase, collect the names in classified.Types and have ImportDecl skip installing unqualified aliases for them. This replaces the install-then-clear approach entirely.
  also at pkg/dang/block.go:302, pkg/dang/slots.go:101, pkg/dang/ast_declarations.go:1328 · outside the hunks but caused by the change: post it on the conversation · 2/2 votes · fingerprint 647d91af77eb

Checked and found sound: Imports are inferred before types are hoisted in RunDir; Module.Clone gets fresh tracking maps, so the parent is untouched; Repeated Hoist/Infer reuses the shadowing module.

Reviewed 8406a0c..d7b82e0 (1 commit, 5 files changed) at STANDARD depth (votes needed: 2 of 2, or 2 of 3 on a split; nit 1 of 1): 4 finders, triage, 8 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: pkg/dang/slots.go:350 (general, behavior, general-2: "In the REPL, interface and union declarations now reuse any existing l…") into pkg/dang/slots.go:350: REPL's BuildEnvFromImports never tracks imports, so declarat…; tests/testdata/import_shadowing_local_distinct.golden:4 (general: "Shadowing means two distinct types can now share a name."), tests/errors/import_shadowing_local_distinct.dang:30 (behavior, general-2: "Shadowing creates a new kind of mismatch: assigning `Test.primaryUser`…") into pkg/hm/unify.go:14: mismatch errors between a local type and the import it shado…
