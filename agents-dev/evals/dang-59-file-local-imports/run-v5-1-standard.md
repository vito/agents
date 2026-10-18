4 important, 3 concerns

Verdict: File-local imports work for type checking, but cross-file ordering, runtime evaluation and type identity don't match yet. Fix dir_inference.go:82, eval.go:2153 and ast_declarations.go:1222 before merging.

IMPORTANT:
- pkg/dang/dir_inference.go:82 — RunDir now orders top-level computed variables within each file only. If `a.dang` has `pub x = y + 1` and `b.dang` has `pub y = 1 + 2`, a.dang's variables phase runs first and fails with `"y" not found`. The old combined topological sort put y first. A cycle across files also reports 'not found' now, not 'circular'.
  worth it: Valid multi-file modules now fail type checking depending on file names.
      for _, scope := range scopes {
  fix: In runDirectoryPhases, run the variables phase once over every file's variables (one orderVariablesForInference), each form inferred in its own file's fileEnv. Add a two-file test where a.dang depends on b.dang.
  also at pkg/dang/dir_inference.go:114, pkg/dang/dir_inference.go:17, pkg/dang/dir_inference.go:115, pkg/dang/dir_inference.go:19 · 2/2 votes · fingerprint 7114576e8b3c
- pkg/dang/dir_inference.go:145 — In the LSP, a sibling's computed variables with no type annotation (e.g. `pub cfg = load()`) are never added to dirEnv: only the active file gets body phases, and DeclareKnownSignature skips non-constant values. The active buffer then gets a false `"cfg" not found`, which RunDir does not report. Computed fields in sibling types are missing the same way, and sibling functions without a return type only get a fresh type variable.
  worth it: False diagnostics; contradicts the claim that cross-file references still resolve.
      runDirectoryPhases(ctx, scopes, fresh, overall, declarationPhases)
  fix: In focused mode, also run the variables phase for siblings (or at least for un-annotated variables), or run full inference for siblings once and reuse it. Add a sibling `pub x = f()` diagnostics test.
  also at pkg/lsp/handler.go:306, pkg/dang/dir_inference.go:150, pkg/dang/slots.go:137, pkg/dang/block.go:687 · 2/2 votes · fingerprint 115bdd2b49d0
- pkg/dang/eval.go:2153 — Imports are file-local only during type inference. At runtime, RunDir evaluates every file's imports into one shared evalEnv, and the first import of an unqualified name wins. Example: a.dang imports X and b.dang imports Y, both exposing `foo`. Each file type-checks `foo` against its own import, but b's `foo` runs X's binding. At the merge base this was an "ambiguous reference" error at type-check time.
  worth it: Programs that pass type-checking call the wrong schema's function at runtime.
      allForms = append(allForms, block.Forms...)
  fix: Give each file an eval scope that mirrors fileEnv (shared declarations plus that file's import bindings). Failing that, raise a type-check error when sibling files' imports bring in the same unqualified name from different schemas.
  also at pkg/dang/dir_inference.go:57, pkg/dang/eval.go:2155, pkg/dang/import_install.go:126 · 2/2 votes · fingerprint c3d45f82fce5
- pkg/dang/ast_declarations.go:1222 — Every file's ImportDecl, including each auto-injected Dagger import, builds its own `NewEnv` schema module. So `Container` in a.dang and `Container` in b.dang are different `*Module` values, and named modules compare by pointer. If a.dang has `pub makeC: Container! { container }` and b.dang has `pub useC: Container! { makeC }`, b.dang fails with "cannot use Container! as Container!".
  worth it: Breaks Dagger modules split across files, which worked before with one injected import.
      i.inferred = NewEnv(i.Name.Name, config.Schema)
  fix: Build the schema module once per import name per directory run (e.g. a name→Env map in prepareFileScopes passed to ImportDecl), and add a RunDir test that passes Dagger.Container between files.
  also at pkg/dang/dir_inference.go:54, pkg/dang/dir_inference.go:194, pkg/dang/env.go:977, pkg/dang/env_test.go:426 · 2/2 votes · fingerprint 1a3623632a77

CONCERN:
- pkg/lsp/handler.go:408 — The parse cache hands the same *ModuleBlock to every file's analysis, and analyses mutate it. Editing B re-runs declaration phases on open file A's cached AST: FunDecl.InferredScope, ClassDecl.Inferred, the inferred types on declarations and block.Env all get overwritten with signature-only state. A's hover and completion read those nodes from its snapshot. jrpc2 starts a notification after earlier notifications finish but does not wait for in-flight requests, so this can also race with a hover on A. Is that sharing intended?
  worth it: Hover and completion in A depend on edits to B, plus a possible data race.
      if hit && cached.open && cached.text == text {
  fix: Don't share a block between its own analysis and other files' sibling passes: e.g. parse siblings that are open buffers into a separate copy, or cache sibling-use blocks apart from the AST each File exposes.
  also at pkg/dang/dir_inference.go:63, pkg/lsp/handler.go:274, pkg/lsp/handler.go:409, pkg/dang/ast_declarations.go:98 · cited but not found at head: mnt/jrpc2/server.go:246 (path does not exist at head) · 2/2 votes · fingerprint 3363a5d00386
- pkg/dang/dir_inference.go:54 — Auto-imports are now injected into every file. Each injected ImportDecl is a new node, so RunDir and DeclareDir build one NewEnv schema module (and one NewEvalEnvWithSchema) per file per import. Before, it was once per directory. A ten-file Dagger module builds the full Dagger schema env ten times on every load. Is that cost acceptable?
  worth it: Load time for multi-file SDK modules grows with the number of files.
      block.Forms = prependAutoImports(ctx, block.Forms)
  fix: Memoize the schema module per import name inside prepareFileScopes, e.g. seed each new ImportDecl's inferred/client/schema from the first one, so NewEnv runs once per directory.
  also at pkg/dang/ast_declarations.go:1222 · 2/2 votes · fingerprint c086271b2c9d
- pkg/dang/env_test.go:264 — The same source now behaves differently depending on how it is run. With `import Dagger` plus `type Dagger {...}`, `dang run main.dang` (RunFile) still errors with "conflicts with import alias", but RunDir and the LSP let the local type shadow the import. A file that never uses `Dagger.X` passes in directory mode and fails in single-file mode. Should RunFile follow the same rule?
  worth it: Users and the LSP see different results for identical code.
      require.ErrorContains(t, err, "unresolved type: Container")
  fix: Route RunFile through InferDirectoryFiles with a single block, or keep the alias-conflict error in directory mode. Record the chosen rule in docs.
  also at pkg/dang/eval.go:1821, pkg/dang/slots.go:437 · 2/2 votes · fingerprint 94c4deca3167

Checked and found sound: prependAutoImports is idempotent on cached blocks; IO errors stay fatal, sibling parse errors are skipped; ImportDecl reinstalls its cached module into each env.

Reviewed f60848c..1058f48 (8 commits, 13 files changed) at STANDARD depth (votes needed: 2 of 2, or 2 of 3 on a split; nit 1 of 1): 4 finders, triage, 14 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: pkg/dang/dir_inference.go:82 (behavior, general-2: "RunDir now orders computed top-level variables one file at a time, so…") into pkg/dang/dir_inference.go:82: RunDir now orders top-level variables within each file only,…; pkg/dang/dir_inference.go:145 (general, behavior: "In the LSP, sibling files now get only the declaration phases."), pkg/dang/dir_inference.go:150 (general-2: "In the LSP's focused mode, sibling files only get declaration phases.") into pkg/dang/dir_inference.go:145: In the LSP, siblings get declaration phases only, so their u…; pkg/dang/eval.go:2155 (general, design: "Imports are file-local when type checking but share one evalEnv at run…"), pkg/dang/eval.go:2153 (general-2: "Imports are now file-local only during type checking.") into pkg/dang/eval.go:2153: Imports are file-local when type checking but share one eval…; pkg/dang/dir_inference.go:63 (general, design: "Cached blocks are now shared between analyses."), pkg/lsp/handler.go:409 (general-2: "Cached blocks are shared mutable state across analyses.") into pkg/lsp/handler.go:408: Analyses mutate cached ModuleBlocks they share, overwriting…
