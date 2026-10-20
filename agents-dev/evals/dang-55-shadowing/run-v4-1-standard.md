1 important, 3 concerns

Verdict: The shadowing works for files and the LSP, but not yet in the REPL. Fix the import tracking at slots.go:350, and the kind and reuse check at slots.go:1013, before merging.

IMPORTANT:
- pkg/dang/slots.go:350 — In the REPL, imported types are installed by BuildEnvFromImports without import tracking, so declareLocalType treats them as local. Before this change, `interface Node {…}` or `union SearchResult = Cat | Dog` made a fresh module. Now it reuses the imported Test.Node or Test.SearchResult and adds fields or members to it. Classes, enums and scalars still mutate the imported type there too.
  worth it: The REPL breaks the invariant this fix sets up, and interfaces and unions there are a new regression.
      if existing, found := env.LocalNamedType(name); found && !localTypeShadowsImport(env, name) {
  fix: Record each type and value BuildEnvFromImports installs with TrackUnqualifiedTypeImport. Better, have declareLocalType decide ownership from a set of names declared locally instead of the import maps. Add a REPL-env (BuildEnvFromImports) test.
  also at pkg/dang/slots.go:1013, pkg/dang/slots.go:1121, pkg/dang/slots.go:331, pkg/dang/eval.go:382 · 2/2 votes · fingerprint aaa38eade2ab

CONCERN:
- tests/testdata/import_shadowing_local_distinct.golden:4 — Shadowing makes it common to have two different types with the same name, and the mismatch error prints both without qualification. The new golden file locks in messages like "cannot use User! as User!" and "cannot use Node as Node".
  worth it: Users can't tell from the error which side is the imported type.
      Error: cannot use User! as User!
  fix: Leave Module.String unchanged so hover text, docs and other golden output keep plain names. In the type-mismatch error path (hm.UnificationError, or wherever Dang formats it), check whether Have and Want render the same while being different types. Only in that case, qualify the schema-derived side with its import name…
  also at tests/errors/import_shadowing_local_distinct.dang:30, pkg/hm/unify.go:14, pkg/dang/env.go:877, pkg/dang/env.go:871 · 2/2 votes · fingerprint 490590dd24f1
- pkg/dang/ast_expressions.go:1183 — Inline fragments and case patterns on an interface take only a bare Symbol, and that name is looked up in the local scope. Once a local `User` shadows `Test.User`, `Test.search(...).{... on User {name}}` fails with "not a member of union SearchResult". `Test.node(id:"1").{... on User}` gets typed as the local User. Nothing can name the imported type there. Before this change both cases worked, because the local and imported types were the same module.
  worth it: The briefing says qualified access is preserved, but fragments and patterns can't use it.
      memberType, found := modEnv.NamedType(frag.TypeName.Name)
  fix: Resolve fragment and interface type-pattern names against the operand first: union members by name, like the union branch at ast_patterns.go:137-143 already does, or the receiver's schema module. Add a fragment and a case test to test_import_shadowing.dang.
  also at pkg/dang/ast_expressions.go:1195, pkg/dang/dang.peg:215, pkg/dang/ast_patterns.go:170, pkg/dang/ast_patterns.go:139 · outside the hunks but caused by the change: post it on the conversation · 2/2 votes · fingerprint 05eef0ae9696
- pkg/dang/slots.go:1013 — Pass 0 for interfaces and unions used to create a fresh module every time. Now it reuses any existing local module with that name, and never checks its kind. In the REPL's persistent env, `union U = A | B` followed by `union U = A | C` leaves members [A, B, A, C], and a redeclared interface keeps its old fields. A reused `type Foo` stays ObjectKind after `interface Foo`.
  worth it: A changed definition in the REPL keeps the old members and fields of the previous one.
      iface := declareLocalType(mod, i.Name.Name, InterfaceKind)
  fix: For interfaces and unions, keep replacing the module on pass 0 (a `replaceLocalType` helper that also clears the import tracking), or at least reuse only when `mod.Kind == kind`.
  also at pkg/dang/slots.go:1121, pkg/dang/slots.go:350, pkg/dang/slots.go:1170, cmd/dang/repl_tuist.go:427 · 2/2 votes · fingerprint faf8a735d16b

Checked and found sound: Imports infer and evaluate before type declarations; Two-import ambiguity cleared at both infer and eval; Repeated Hoist/Infer passes reuse one module after the clear.

Reviewed 8406a0c..d7b82e0 (1 commit, 5 files changed) at STANDARD depth (votes needed: 2 of 2, or 2 of 3 on a split; nit 1 of 1): 4 finders, triage, 8 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: pkg/dang/slots.go:350 (general, behavior: "In the REPL, the env comes from `BuildEnvFromImports`, which copies im…"), pkg/dang/slots.go:331 (design: "Shadowing is detected only through `unqualifiedTypeImports`, which onl…") into pkg/dang/slots.go:350: REPL's BuildEnvFromImports never tracks unqualified imports,…; tests/testdata/import_shadowing_local_distinct.golden:4 (general: "Shadowing creates two distinct types with the same name, and mismatch…"), tests/errors/import_shadowing_local_distinct.dang:30 (behavior: "Shadowed and imported types share a bare name, so the new mismatches r…"), pkg/hm/unify.go:14 (general-2: "Shadowing now routinely puts two different types with the same name si…") into pkg/hm/unify.go:14: mismatch errors print bare names, e.g. 'cannot use User! as…; pkg/dang/ast_patterns.go:170 (behavior: "With a local `type User` and `import Test`, the pattern `case (Test.no…") into pkg/dang/ast_expressions.go:1183: type patterns and inline fragments take only a bare name, wh…; pkg/dang/slots.go:1121 (behavior: "At the merge base, interface and union pass 0 always created a fresh m…") into pkg/dang/slots.go:1013: interface and union pass 0 now reuse an existing local modul…
