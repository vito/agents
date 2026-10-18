1 important, 3 concerns

Verdict: Local type declarations now shadow unqualified imports, and qualified access still works. That fits how imports are layered in the system. Fix slots.go:350 first, so constants annotated before the hoist resolve to the same User type as later code.

IMPORTANT:
- pkg/dang/slots.go:350 — Top-level constant slots are inferred in the constants phase, which runs before type declarations are hoisted. So `pub nobody: User = null` (or a bare `pub cur: User`) still binds to the imported Test.User, while later annotations bind to the local User. At the merge base both annotations named one merged type; now `pub u: User = nobody` fails with `cannot use User as User`.
  worth it: the type an annotation resolves to now depends on the slot's phase classification, not its name
      if existing, found := env.LocalNamedType(name); found && !localTypeShadowsImport(env, name) {
  fix: In InferFormsWithPhases, run the types' pass-0 registration before the constants and directives phases. Add a test case with `pub x: User = null` next to the shadowing `type User`.
  also at pkg/dang/slots.go:395, pkg/dang/block.go:261, pkg/dang/block.go:264, pkg/dang/block.go:306 · 2/3 votes · fingerprint 1a07a57752dd

CONCERN:
- pkg/dang/slots.go:331 — The fix decides 'this existing type is an import alias' by looking at the unqualifiedTypeImports map, and that map is wrong in both directions. The REPL's BuildEnvFromImports adds imported classes without recording them, so `type Container {...}` in the REPL still reuses and mutates Dagger.Container. In the other direction, an import that comes after a local type is recorded as a conflict, so reopening that local type later starts from a new, empty module. Should the check compare identity with the import's own types instead?
  worth it: the bug is only fixed for RunDir and file runs, not for the REPL
      return len(e.unqualifiedTypeImports[name]) > 0
  fix: In declareLocalType, treat a type as shadowed when it is not owned locally. For example, keep a set of locally declared names, or check whether `existing` belongs to an imported schema module, instead of reading unqualifiedTypeImports.
  also at pkg/dang/slots.go:350, pkg/dang/slots.go:1013, pkg/dang/eval.go:382, pkg/dang/ast_declarations.go:1323 · 2/2 votes · fingerprint 83aa7df910bd
- tests/errors/import_shadowing_local_distinct.dang:30 — Now that distinct types can share a name, mismatch errors print both sides by their bare Named field. The new golden file locks in messages like "cannot use User! as User!" and "cannot use Node as Node", which give the user no hint that one side is Test.User.
  worth it: the new error users get when they hit shadowing doesn't explain itself
      let userShouldFail: User! = Test.primaryUser
  fix: When Have and Want are distinct modules with equal Name(), print the imported side qualified (e.g. Test.User), then regenerate the golden file.
  also at tests/errors/import_shadowing_local_distinct.dang:33, tests/testdata/import_shadowing_local_distinct.golden:3, pkg/hm/unify.go:14, pkg/dang/env.go:871 · 2/2 votes · fingerprint 07be351451aa
- pkg/dang/ast_expressions.go:1183 — Inline fragments and interface type patterns look up a bare type name in the lexical scope, and the grammar has no qualified form for them. Once a local `type User` shadows the import, `Test.search(query: "x").{... on User { name }}` fails with "type User is not a member of union SearchResult". `case (Test.node(id: "1")) { u: User => ... }` fails with "does not implement interface Node". Neither can be written as `Test.User`.
  worth it: The imported member types can no longer be named in fragments or patterns at all, though they resolved before this change.
      memberType, found := modEnv.NamedType(frag.TypeName.Name)
  fix: Resolve fragment and pattern names against the receiver's union members or interface implementers by name, as `case` already does for unions. Or allow `Module.Type` in the InlineFragment and CaseClause grammar.
  also at pkg/dang/ast_expressions.go:1195, pkg/dang/ast_patterns.go:170, pkg/dang/dang.peg:215, pkg/dang/dang.peg:1019 · outside the hunks but caused by the change: post it on the conversation · 2/2 votes · fingerprint 44dde9e14343
Also raised, past the 3 strongest concerns:
- pkg/dang/slots.go:350 — Interface and union pass 0 used to always create a fresh module. (2/2 votes)

Checked and found sound: Qualified Test.X still resolves to the imported type; local declaration clears two-import ambiguity at infer and eval; imports always run before type hoisting.

Reviewed 8406a0c..d7b82e0 (1 commit, 5 files changed) at STANDARD depth (votes needed: 2 of 2, or 2 of 3 on a split; nit 1 of 1): 4 finders, triage, 11 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: pkg/dang/slots.go:395 (general-2: "Top-level constants and directive declarations are inferred before the…") into pkg/dang/slots.go:350: constants inferred before types are hoisted bind to the impo…; pkg/dang/slots.go:350 (behavior, design: "Shadowing only happens when the name is in unqualifiedTypeImports, and…"), pkg/dang/slots.go:331 (general-2: "Shadowing only kicks in when unqualifiedTypeImports is populated, whic…") into pkg/dang/slots.go:331: REPL's BuildEnvFromImports doesn't record unqualifiedTypeImp…; tests/errors/import_shadowing_local_distinct.dang:30 (general, design: "The local type and the imported type now differ but print under the sa…") into tests/errors/import_shadowing_local_distinct.dang:30: mismatch errors print distinct same-named types by bare name; pkg/dang/ast_expressions.go:1183 (behavior: "Once `User` is declared locally, inline fragments and case type patter…") into pkg/dang/ast_expressions.go:1183: inline fragments/type patterns resolve bare names to the loc…
Dropped by the evidence checks (1): tests/testdata/import_shadowing_local_distinct.golden:4 (behavior): no cited location holds: tests/testdata/import_shadowing_local_distinct.golden:4 (quoted evidence does not appear in that file at head); tests/testdata/import_shadowing_local_distinct.golden:43 (quoted evidence does not appear in that file at head)
