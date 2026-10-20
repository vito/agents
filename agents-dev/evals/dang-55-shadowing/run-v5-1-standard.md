2 important, 3 concerns

Verdict: The shadowing works for ordinary type references, but some paths still pick up the imported type. Fix the constants-phase typing at slots.go:356 and the inline fragment/case lookup at ast_expressions.go:1183 first.

IMPORTANT:
- pkg/dang/slots.go:356 — A literal-valued slot whose annotation names a shadowed type, e.g. `pub current: User = null`, is typed in the constants phase. That phase runs before the types phase, so `User` still resolves to the imported Test.User. The local `type User` then replaces it, so `current` keeps the import's type, and passing it where the local `User` is expected fails with `cannot use User as User`.
  worth it: a plain module-level placeholder silently gets the wrong type. At the merge base both names pointed to one module, so this worked
      mod := NewModule(name, kind)
      	env.AddClass(name, mod)
  fix: Register type names (types pass 0) before the constants phase in InferFormsWithPhases, or classify annotated constants with Variables. Add a `pub x: User = null` case to test_import_shadowing.dang.
  also at pkg/dang/block.go:261, pkg/dang/types.go:60, pkg/dang/slots.go:101 · 2/2 votes · fingerprint 5d55bfcaab8b
- pkg/dang/ast_expressions.go:1183 — Inline fragment names and interface case patterns are resolved in the lexical scope, so a local `type User` now captures them. `Test.search(query:"John").{... on User {name}}` fails with "User is not a member of union SearchResult". `Test.node(id:"1").{... on User!}` type-checks as the local User, so `.origin` is accepted and then fails at runtime. The grammar only takes a bare Symbol here, so there is no way to write `... on Test.User`.
  worth it: breaks fragment code that worked at the merge base and opens a type-soundness hole
      memberType, found := modEnv.NamedType(frag.TypeName.Name)
  fix: In inferInlineFragments and resolveInterfaceTypePattern, look the name up among the operand's members/implementers first (as union case patterns already do by name), and fall back to env. Add fragment tests to test_import_shadowing.
  also at pkg/dang/ast_expressions.go:1204, pkg/dang/ast_patterns.go:170, pkg/dang/dang.peg:215, pkg/dang/ast_expressions.go:1195 · outside the hunks but caused by the change: post it on the conversation · 2/2 votes · fingerprint e73a785e4615

CONCERN:
- pkg/dang/slots.go:350 — Shadowing is detected only through `unqualifiedTypeImports`, and only `ImportDecl` fills that map. The REPL builds its env with `BuildEnvFromImports`, which adds imported classes without tracking them. So typing `type Container { pub value: String! }` in the REPL with Dagger loaded still reuses the imported Dagger Container and mutates it, which is the bug this change fixes for files.
  worth it: the same declaration behaves differently in a file and in the REPL
      if existing, found := env.LocalNamedType(name); found && !localTypeShadowsImport(env, name) {
  fix: Have BuildEnvFromImports call TrackUnqualifiedTypeImport for each class it installs. Better: decide shadowing by ownership (is the existing type a local declaration) rather than by side metadata.
  also at pkg/dang/slots.go:331, pkg/dang/eval.go:382, cmd/dang/repl_tuist.go:427, cmd/dang/repl_tuist.go:202 · 2/2 votes · fingerprint 66982526b3f6
- tests/testdata/import_shadowing_local_distinct.golden:4 — Two different types with the same name can now be in scope, but mismatch errors print bare names. The new golden file records messages like "cannot use User! as User!" and "cannot use Status! as Status!", which give no hint that one side is `Test.User`.
  worth it: the most likely mistake after shadowing gets an error that looks self-contradictory
      cannot use User! as User!
  fix: When Have and Want render identically but are different modules, qualify them with their import name (e.g. `Test.User!`). Track the import name on schema modules in NewEnv, then regenerate the golden.
  also at tests/errors/import_shadowing_local_distinct.dang:30, pkg/hm/unify.go:14, pkg/dang/env.go:877 · 2/2 votes · fingerprint 51ad2e72cee4
- pkg/dang/slots.go:350 — Interface and union pass 0 used to always build a fresh module. Now declareLocalType reuses any existing local type, whatever its kind. In the REPL's persistent typeEnv, redeclaring `union U = A | B` as `union U = C` gives members A,B,C. Redeclaring an interface field with a new type fails with "already defined as". `type Foo` followed by `interface Foo` keeps ObjectKind.
  worth it: REPL redefinitions of interfaces and unions regress
      if existing, found := env.LocalNamedType(name); found && !localTypeShadowsImport(env, name) {
  fix: In declareLocalType, reuse only when the existing module's Kind matches. Or keep unconditional NewModule for interface/union pass 0 and just call clearShadowedUnqualifiedImports.
  also at pkg/dang/slots.go:1121, pkg/dang/slots.go:1013, cmd/dang/repl_tuist.go:427 · 2/2 votes · fingerprint 5d68c6ab8592

Checked and found sound: Hoist and Infer passes share one replacement module; qualified access through the import module still works; eval-time conflict tracking is cleared before rebinding.

Reviewed 8406a0c..d7b82e0 (1 commit, 5 files changed) at STANDARD depth (votes needed: 2 of 2, or 2 of 3 on a split; nit 1 of 1): 4 finders, triage, 10 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: pkg/dang/block.go:261 (general-2: "Top-level constants are inferred before the types phase.") into pkg/dang/slots.go:356: constants phase resolves the annotation to the imported type…; pkg/dang/slots.go:331 (general, behavior: "Shadowing only triggers when the name is in `unqualifiedTypeImports`.") into pkg/dang/slots.go:350: REPL BuildEnvFromImports doesn't track unqualifiedTypeImport…; tests/testdata/import_shadowing_local_distinct.golden:4 (general: "Now that a local type and an imported type can share a display name, m…") into tests/testdata/import_shadowing_local_distinct.golden:4: mismatch errors print bare names that look identical for two…; pkg/dang/ast_expressions.go:1183 (behavior, design: "Once a local type shadows an imported one, inline fragments (`... on U…") into pkg/dang/ast_expressions.go:1183: inline fragments and case patterns resolve bare names lexica…; pkg/dang/slots.go:350 (behavior: "Interface and union pass 0 used to create a fresh module every time.") into pkg/dang/slots.go:350: interface/union pass 0 reuses an existing local type regardl…
Dropped by the evidence checks (2): tests/testdata/import_shadowing_local_distinct.golden:4 (behavior): no cited location holds: tests/testdata/import_shadowing_local_distinct.golden:4 (quoted evidence does not appear in that file at head); tests/testdata/import_shadowing_local_distinct.golden:56 (quoted evidence does not appear in that file at head); tests/testdata/import_shadowing_local_distinct.golden:4 (general-2): quoted evidence does not appear in that file at head
