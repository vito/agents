3 important, 1 concern

Verdict: The change fixes shadowing for file-based imports, but it doesn't yet hold in the REPL or for interface/union pass 0. Fix slots.go:350 and slots.go:1013 first, then settle ast_expressions.go:1183 and the golden message.

IMPORTANT:
- pkg/dang/slots.go:1013 — Interface and union pass 0 always created a fresh module before. They now go through declareLocalType, which reuses any existing local type, whatever its kind. In the REPL's persistent typeEnv, redeclaring `union U = A | B` as `union U = A | C` keeps B as a member (LinkMember appends to the old list), and an old interface keeps its earlier fields. After `type Foo`, a later `interface Foo` keeps ObjectKind.
  worth it: Iterating on a type in the REPL now leaves stale members and fields behind.
      iface := declareLocalType(mod, i.Name.Name, InterfaceKind)
  fix: Have the interface and union pass 0 keep `NewModule` + `AddClass`, and only add `clearShadowedUnqualifiedImports`. Alternatively, make declareLocalType reuse a module only when the existing Kind matches.
  also at pkg/dang/slots.go:1121, pkg/dang/slots.go:350, pkg/dang/slots.go:1170, cmd/dang/repl_tuist.go:427 · 2/2 votes · fingerprint 2db50a5a9fe6
- pkg/dang/slots.go:350 — The REPL loads imports through BuildEnvFromImports, which never calls TrackUnqualifiedTypeImport. So in `dang` with a Dagger import, typing `type Container { pub value: String! }` finds the imported Container and gets false from localTypeShadowsImport. It then reuses that module and adds the field to Dagger.Container itself, which is the bug this change says it fixes.
  worth it: The fix covers RunDir/Run but not the interactive REPL, where users try things out.
      if existing, found := env.LocalNamedType(name); found && !localTypeShadowsImport(env, name) {
  fix: Decide 'is an import alias' from where the type came from, not from tracking maps. For example, record imported aliases in BuildEnvFromImports too, or mark modules created by local declarations and replace any local type without that mark.
  also at pkg/dang/slots.go:331, pkg/dang/eval.go:382, cmd/dang/repl_tuist.go:202 · 2/2 votes · fingerprint 0eb2cb20bc41
- pkg/dang/ast_expressions.go:1183 — Once a local type shadows an imported one, inline fragments and case patterns on an interface look the name up in the environment and get the local type. `Test.search(query: "John").{ ... on User { name } }` now fails with "type User is not a member of union SearchResult". The grammar only accepts a bare Symbol there, so there is no way to write `Test.User` instead.
  worth it: At the merge base this code worked, and the qualified access the briefing promises does not reach these positions.
      memberType, found := modEnv.NamedType(frag.TypeName.Name)
  fix: Resolve fragment and pattern names against the operand's own members or implementers by name first, as the union case-pattern branch already does. Add a shadowing test with `... on User` and an interface case.
  also at pkg/dang/ast_patterns.go:170, pkg/dang/ast_patterns.go:139, pkg/dang/dang.peg:215 · outside the hunks but caused by the change: post it on the conversation · 2/2 votes · fingerprint df9842a43b8c

CONCERN:
- tests/testdata/import_shadowing_local_distinct.golden:4 — Once a local type shadows an import, any mismatch prints the two types under the same name. The new golden records `cannot use User! as User!` and `cannot use Node as Node`. Dagger code like `pub c: Container! { container }` next to a local `type Container` used to compile; now it fails with `cannot use Container! as Container!`. Should the golden lock in that message?
  worth it: Users will hit this when migrating, and the message gives no hint about the cause.
      Error: cannot use User! as User!
  fix: When the two type names in an assignability error are equal, print them qualified by their owning module (Test.User vs User). Then regenerate import_shadowing_local_distinct.golden.
  also at tests/testdata/import_shadowing_local_distinct.golden:43, pkg/dang/env.go:348 · 2/2 votes · fingerprint 617996dbecab

Checked and found sound: Imports are inferred and evaluated before type hoisting; Eval-time clearing targets the same Mod used for tracking; Qualified Test.X still resolves through the import module.

Reviewed 8406a0c..d7b82e0 (1 commit, 5 files changed) at STANDARD depth (votes needed: 2 of 2, or 2 of 3 on a split; nit 1 of 1): 4 finders, triage, 10 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: pkg/dang/slots.go:1013 (general: "Interface and union decls used to get a fresh module every time.") into pkg/dang/slots.go:1013: interface/union pass 0 now reuses an existing local type, so…; pkg/dang/slots.go:331 (general, behavior: "Shadowing only works when an ImportDecl recorded the alias."), pkg/dang/slots.go:350 (general-2: "The REPL builds its environment with BuildEnvFromImports.") into pkg/dang/slots.go:350: REPL's BuildEnvFromImports never tracks unqualified imports,…; pkg/dang/slots.go:350 (behavior: "Top-level constants and directive declarations are inferred before typ…"), pkg/dang/block.go:261 (design: "Top-level slots with literal values, such as `pub fallback: Container…") into pkg/dang/block.go:261: constants and directives are inferred before types pass 0, s…; pkg/dang/env.go:348 (general-2: "Shadowing makes two different types with the same name common, but typ…") into tests/testdata/import_shadowing_local_distinct.golden:4: type errors show both shadowed types under the same name, e.…
Dropped by the evidence checks (1): tests/testdata/import_shadowing_local_distinct.golden:17 (general): quoted evidence does not appear in that file at head
Below quorum: pkg/dang/slots.go:350 (0/2, needed 2)
