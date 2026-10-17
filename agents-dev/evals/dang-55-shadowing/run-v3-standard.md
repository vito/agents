3 concerns

Verdict: Imported types are now shadowed correctly in files and the LSP, and the change fits the existing import tracking. The REPL is not covered yet: look at slots.go:331 and slots.go:1013 before merging.

CONCERN:
- pkg/dang/slots.go:331 — Whether a declaration counts as shadowing depends on `unqualifiedTypeImports` entries, and only `ImportDecl` writes those. The REPL builds its env with `BuildEnvFromImports`, which calls `AddClass` without recording anything. So typing `type Container {...}` in a Dagger REPL still reuses the imported `Dagger.Container` and adds fields to it. Traced by hand; I wrote a probe but had no test runner to run it.
  worth it: The fix only applies to `ImportDecl`, so the REPL still corrupts the imported types.
      return len(e.unqualifiedTypeImports[name]) > 0
  also at pkg/dang/slots.go:350, pkg/dang/eval.go:382, cmd/dang/repl_tuist.go:427 · 2/2 votes · fingerprint ab77dfad5fbf
- pkg/dang/slots.go:1013 — In the REPL, where `r.typeEnv` persists between inputs, a second `interface I` or `union U` now reuses the old module instead of creating a fresh one. Redeclaring `interface I { pub a: Int! }` after `pub a: String!` hits SlotDecl's "already defined" error, and `union U = A | C` after `A | B` leaves members A, B, A, C. Not run.
  worth it: Redeclaring types in the REPL worked at the merge base and now fails or keeps stale members.
      iface := declareLocalType(mod, i.Name.Name, InterfaceKind)
  also at pkg/dang/slots.go:1121, pkg/dang/slots.go:350, pkg/dang/slots.go:351, pkg/dang/env.go:972 · 2/2 votes · fingerprint 3f3d837893a0
- tests/testdata/import_shadowing_local_distinct.golden:4 — Now that a local type and an imported type can share a name, mismatch errors print both sides the same way, e.g. "cannot use User! as User!". The new golden file locks in five errors like that, where nothing tells the user which side is Test.User.
  worth it: Users get a type error they cannot act on; showing qualified names would fix it.
      cannot use User! as User!
  also at tests/errors/import_shadowing_local_distinct.dang:30, pkg/hm/unify.go:14 · 2/2 votes · fingerprint 7e0d7066b770

Checked and found sound:
- Imports are inferred and evaluated before types, so tracking exists at pass 0.
- Pass 0 clears tracking, so pass 1 and Infer reuse the same local module.
- Qualified access like Test.User still goes to the unchanged import module.

Reviewed 8406a0c..d7b82e0 (1 commit, 5 files changed) at STANDARD depth (votes needed: important 2 of 3, concern 2 of 2, nit 1 of 1): 3 finders, triage, 8 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates (4): pkg/dang/slots.go:331 (general) into pkg/dang/slots.go:331: REPL env from BuildEnvFromImports never records unqualified imports, so local ty…; pkg/dang/slots.go:1121 (general) into pkg/dang/slots.go:1013: declareLocalType reuses the existing interface/union module on redeclaration, so…; pkg/dang/slots.go:1121 (design) into pkg/dang/slots.go:1013: declareLocalType reuses the existing interface/union module on redeclaration, so…; tests/errors/import_shadowing_local_distinct.dang:30 (general) into tests/testdata/import_shadowing_local_distinct.golden:4: unqualified type names in errors read 'cannot use User! as User!' when a local t…
Dropped by the evidence checks (1): tests/testdata/import_shadowing_local_distinct.golden:4 (design): no cited location holds: tests/testdata/import_shadowing_local_distinct.golden:4 (quoted evidence does not appear in that file at head); tests/testdata/import_shadowing_local_distinct.golden:43 (quoted evidence does not appear in that file at head); tests/testdata/import_shadowing_local_distinct.golden:56 (quoted evidence does not appear in that file at head)
Below quorum: pkg/dang/block.go:261 (1/2, needed 2)
