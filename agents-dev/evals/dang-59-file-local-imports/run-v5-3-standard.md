4 important, 1 concern, 1 nit, 1 decision to record

Verdict: Type-checking now treats imports as file-local, but runtime evaluation and cross-file behavior do not match yet. Fix eval.go:2155, ast_declarations.go:1222 and dir_inference.go:115/145 before merging.

IMPORTANT:
- pkg/dang/eval.go:2155 — Imports are file-local while type checking, but RunDir and DeclareDir still evaluate every file into one shared evalEnv, with all imports going in first. Say a.dang has `import Other` and b.dang has `import Test`, and both schemas define `Status` or a query field. b.dang type-checks against Test, but at runtime the name is already bound to Other's value, because the second install skips names that already exist. The comment at eval.go:2148-2150 also says imports are evaluated per file in source order, which the code does not do.
  worth it: The program type-checks but then runs against the wrong schema and client.
      masterBlock := &ModuleBlock{Forms: allForms, Inline: true}
  fix: Evaluate each file's imports into a per-file child EvalEnv layered over the shared declaration env, mirroring fileEnv. Add a two-file Test/Other test that checks the runtime value. Fix the comment.
  also at pkg/dang/dir_inference.go:62, pkg/dang/eval.go:2150, pkg/dang/eval.go:2153, pkg/dang/eval.go:2149 · 2/2 votes · fingerprint fdbffc5d5bf3
- pkg/dang/dir_inference.go:145 — In focused LSP analysis, sibling files only run the declaration phases. A sibling variable with no type annotation and a computed value (e.g. `pub items = [1, 2, 3]`, or a template with interpolation) is never put into dirEnv. Referencing it from the active buffer gives a false `"items" not found` diagnostic, and completion and hover miss it. Untyped class fields in sibling files are lost the same way, because their types are only inferred in ClassDecl.Infer.
  worth it: The briefing says cross-file references in the active buffer still resolve; for untyped declarations they now report false errors.
      runDirectoryPhases(ctx, scopes, fresh, overall, declarationPhases)
  fix: For siblings, also run the variables phase, or give unannotated computed slots a fresh type variable (DeclareSignature instead of DeclareKnownSignature). Add an LSP test where the sibling declares `pub items = [1]`.
  also at pkg/dang/dir_inference.go:134, pkg/dang/dir_inference.go:127, pkg/lsp/handler.go:306, pkg/dang/dir_inference.go:150 · 2/2 votes · fingerprint b95c90787cb1
- pkg/dang/ast_declarations.go:1222 — Each file's ImportDecl, including each per-file synthetic auto-import, now calls NewEnv on its own. As a result `Dagger.Container` in a.dang and in b.dang are two different *Module instances, and named modules compare by pointer. If a.dang has `pub base: Container! { container.from("alpine") }` and b.dang has `pub b: Container! { base }`, inference fails with `cannot use Container! as Container!`.
  worth it: Multi-file Dagger modules can no longer pass imported types between files.
      i.inferred = NewEnv(i.Name.Name, config.Schema)
  fix: In InferDirectoryFiles/prepareFileScopes, memoize one schema module per import name for the directory (e.g. a map in ctx) and have ImportDecl.Infer reuse it. Add a cross-file Container-passing test.
  also at pkg/dang/dir_inference.go:54, pkg/dang/dir_inference.go:194, pkg/dang/env.go:396, pkg/dang/env.go:977 · 2/2 votes · fingerprint e27a3f245ad0
- pkg/dang/dir_inference.go:115 — RunDir now runs the variables phase one file at a time, so the dependency ordering in orderVariablesForInference only works inside a single file. Take a.dang `pub doubled = base * 2` and b.dang `pub base = 1 + 2`: a's variable is inferred before b's `base` exists, and RunDir fails with `"base" not found`. At the merge base this worked because ordering was global.
  worth it: The briefing claims order independence, but valid directories now fail depending on file names.
      return inferVariablesPhaseResilient(ctx, c.Variables, env, fresh, errs)
  fix: In runDirectoryPhases, special-case the variables phase: concatenate Variables from all scopes, order them globally, then infer each against its own file's fileEnv. Add a two-file test.
  also at pkg/dang/dir_inference.go:83, pkg/dang/dir_inference.go:82, pkg/dang/dir_inference.go:17, pkg/dang/block.go:768 · 2/2 votes · fingerprint ab43e5c60f7a

CONCERN:
- pkg/dang/dir_inference.go:63 — Cached blocks are now shared by every open file in a directory. When file B's didChange runs, it re-hoists open file A's cached block, overwriting `block.Env`, `ClassDecl.Inferred`, `FunDecl.Inferred`/`InferredScope` and slot types. A's `f.AST` points at that block, and jrpc2 notifications do not wait for in-flight calls, so a hover or completion on A can read these nodes while they are being written. Even without overlap, A's AST is left with declaration-only state from B's run. Is that intended?
  worth it: This is a new data race, and A's hover and completion read state that does not match its TypeEnv.
      block.Env = fileEnv
  fix: Keep cached parses for sibling use, but give each File its own AST: deep-copy or reparse the active block. Alternatively, store per-analysis inference results outside the shared nodes.
  also at pkg/lsp/handler.go:255, pkg/lsp/handler.go:274, pkg/lsp/handler.go:408, pkg/lsp/handler.go:409 · 2/2 votes · fingerprint 389b9a2ec972

NIT:
- pkg/dang/env_test.go:399 — `TestRunDirImportsAreFileLocal` can't tell file-local imports from leaking ones. `container.value` names a field that `Container` doesn't have, so b.dang fails even if the import leaks. The assertion only checks that the error contains "container", which the source text in the error message probably includes either way.
  fix: In b.dang use a field that exists (`container.id` with `ID!`) and assert the error contains `"container" not found`.
  also at pkg/dang/env_test.go:404 · 1/1 votes · fingerprint 5929cddbcaf4

DECISIONS TO RECORD (defensible choices, not defects):
- pkg/dang/env_test.go:264 — `import Dagger` combined with a local `type Dagger` still fails in RunFile with "conflicts with import alias", because imports go into the same env there. RunDir now lets the local type shadow the alias and reports "unresolved type: Container" instead. The same source gives a different error depending on how it is run. The declareLocalType comment that says qualified aliases are protected is now true only for single files.
  record: Pick one rule for both entry points. Either run RunFile through prepareFileScopes or reject local names that match file import aliases in RunDir, then fix the slots.go:418-422 comment to match.
  also at pkg/dang/slots.go:421, pkg/dang/eval.go:1829 · 2/2 votes · fingerprint 77a992be183f

Checked and found sound: auto-import prepending is idempotent on cached blocks; synthetic nil-Loc imports are safe in LSP walkers; IO errors stay fatal, parse errors are skipped.

Reviewed f60848c..1058f48 (8 commits, 13 files changed) at STANDARD depth (votes needed: 2 of 2, or 2 of 3 on a split; nit 1 of 1): 4 finders, triage, 14 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: pkg/dang/eval.go:2153 (design: "Imports are now separate per file during type checking, but evaluation…") into pkg/dang/eval.go:2155: Imports are type-checked per file but evaluated in one share…; pkg/dang/dir_inference.go:127 (general, behavior: "In the LSP, sibling files now only run the declaration phases."), pkg/dang/dir_inference.go:150 (general-2: "Focused LSP inference never adds a sibling's computed variable that ha…") into pkg/dang/dir_inference.go:145: In LSP analysis, sibling files run only the declaration phas…; pkg/lsp/handler.go:408 (general: "When file A is open and unchanged, its stored f.AST is now the same ca…"), pkg/dang/dir_inference.go:63 (behavior, design: "The parse cache shares one AST between open files.") into pkg/dang/dir_inference.go:63: The cached parsed AST is shared between open files, so analy…; pkg/dang/dir_inference.go:194 (general-2: "Each file's `import Dagger`, explicit or auto-injected, now runs its o…") into pkg/dang/ast_declarations.go:1222: Each file's import runs NewEnv separately, giving distinct C…; pkg/dang/dir_inference.go:82 (design: "RunDir now orders variables within each file instead of across the who…") into pkg/dang/dir_inference.go:115: RunDir now orders the variables phase within each file inste…
Below quorum: pkg/dang/ast_declarations.go:1222 (0/1, needed 1)
