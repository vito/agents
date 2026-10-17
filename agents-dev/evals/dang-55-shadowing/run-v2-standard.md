3 concerns

Verdict: The change does what it sets out to do for file-based modules: local type declarations get their own type, and qualified access still reaches the imported one. Deal with the inline-fragment / interface case-pattern regression first, because the imported member can no longer be named at all. It was traced by reading the code but not run.

CONCERN:
- pkg/dang/ast_expressions.go:1183 — Inline fragments (`... on User`) and case type patterns on an interface operand look up the bare name in the local scope. After a local `type User`, `Test.search(...).{ ... on User { name } }` resolves to the local User and fails with "type User is not a member of union SearchResult". The grammar has no qualified form here (`typeName:Symbol`), so the imported member can no longer be selected at all. At the merge base the local User reused Test.User, so this worked. I traced this by reading the code; I could not run it (there is no test runner in this sandbox).
  worth it: the briefing promises qualified access through the import, but these constructs have no qualified spelling, so shadowing a type name cuts off access to the imported member
  evidence:
      memberType, found := modEnv.NamedType(frag.TypeName.Name)
  also at pkg/dang/ast_patterns.go:170, pkg/dang/dang.peg:215, pkg/dang/dang.peg:1019
  outside the change's hunks, though the change causes it: GitHub cannot anchor a line comment there, so post it on the conversation.
  votes: 3/3 confirmed · design (general) · fingerprint 13f80e01258c
- pkg/dang/slots.go:350 — Shadowing is decided by the `unqualifiedTypeImports` tracking map, not by who owns the type. The REPL builds its env with `BuildEnvFromImports`, which calls `AddClass` but never records tracking. So `type Container { pub value: String! }` typed in the REPL still finds the imported Dagger Container, reuses it, and mutates it, the bug this change fixes for files. Should the check instead test whether the existing type is a locally declared module, rather than relying on side metadata that only `ImportDecl` fills in?
  worth it: the same declaration now behaves differently in the REPL and in files, and the REPL still mutates the imported schema type
  evidence:
      if existing, found := env.LocalNamedType(name); found && !localTypeShadowsImport(env, name) {
  also at pkg/dang/slots.go:331, pkg/dang/eval.go:382, cmd/dang/repl_tuist.go:202
  votes: 3/3 confirmed · design (general) · fingerprint fc51b2bac3df
- tests/errors/import_shadowing_local_distinct.dang:30 — The change makes it normal for two different types to share a name, but `Module.String` prints only the bare name. The new golden file locks in messages like "cannot use User! as User!" and "cannot use Node as Node", which give users no hint that one side is `Test.User`. Is it worth qualifying imported type names in diagnostics before these goldens become the reference?
  worth it: the error users will hit most often with this feature contradicts itself on its face
  evidence:
      let userShouldFail: User! = Test.primaryUser
  also at pkg/dang/env.go:877
  votes: 3/3 confirmed · behavior (general) · fingerprint e6632d04ec81

Checked and found sound:
- Hoist pass 0 clears import tracking, so pass 1 and Infer reuse the same local module and type identity holds.
- Qualified `Test.User` / `Dagger.Container` still resolve through the import module; only the unqualified alias is replaced.
- Ambiguity between two imports of one name is cleared for both inference and eval, and phase order keeps it cleared.
- CompositeModule envs route tracking, AddClass and clearing through `primary` consistently.
- Case patterns on an imported union operand still match members by name, so unions are not affected.

Reviewed 8406a0c..d7b82e0 (merge base..head): 1 commit, 5 files changed, at STANDARD depth (3 finders; 3 voters per finding, quorum 2).
Sub-agents composed from: dag://?llm=committer/readonly, dag://?llm=contributor/readonly, dag://?expertise=editor/agent, dag://?llm=reviewer/finder, dag://?llm=reviewer/voter, dag://?llm=reviewer/synthesizer
Failing tests or checks listed for this call under finder-*, voter-* or synthesizer agents are the reviewers' own reproductions, run in private sandboxes (often written to fail on purpose to demonstrate a finding); they are not this change's CI results.

Merged into an earlier finding quoting the same code (4):
  - pkg/dang/ast_expressions.go:1183 (behavior): Inline fragments look up their type name in the local scope, and the grammar accepts only a bare Symbol there, so `... on Test.User` cannot be written. In a mod…
  - pkg/dang/slots.go:350 (behavior): The only signal for shadowing is `unqualifiedTypeImports`, and `BuildEnvFromImports` (the REPL's env builder) adds unqualified classes without tracking them. So…
  - pkg/dang/slots.go:350 (design): A top-level constant or type-only slot annotated with a shadowed name, such as `pub maybe: User = null` next to a local `type User` with `import Test`, now gets…
  - tests/errors/import_shadowing_local_distinct.dang:30 (design): With this change, one scope can hold two different types with the same bare name. Type errors still print only `Module.Name()`, so the new golden file locks in…
Below quorum (2 of 3): pkg/dang/slots.go:325 (0/3 confirmed)
2 weaker concerns over the concern cap (3) not reported: pkg/dang/slots.go:1121, pkg/dang/env.go:876

Answer every finding: fix it (a re-review marks it FIXED), or resolve(fingerprint:, reason:). To post one on a pull request, pass its path and line to comment(path:, line:); one marked outside the hunks goes on the conversation instead.
