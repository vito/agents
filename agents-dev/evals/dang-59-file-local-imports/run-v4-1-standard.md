5 important, 1 concern

Verdict: The file-local import model doesn't hold together yet: runtime binding, shared imported types and cross-file variable ordering still behave as if imports were directory-wide. Fix eval.go:2155 and ast_declarations.go:1222 first.

IMPORTANT:
- pkg/dang/eval.go:2155 — Imports are file-local only during type checking. At runtime, every file's forms are evaluated into one shared evalEnv, and the first import to bind an unqualified name keeps it. If a.dang imports X and b.dang imports Y, and both schemas have a Query field `node`, b's `node` type-checks against Y but calls X's `node` at runtime. Before this change the overlap was reported as an ambiguous reference.
  worth it: the type checker approves a call that actually hits a different API
      masterBlock := &ModuleBlock{Forms: allForms, Inline: true}
  fix: Detect unqualified names that different files' imports provide, and keep reporting them as ambiguous. Or evaluate each file against its own eval overlay on top of the shared declaration env.
  also at pkg/dang/dir_inference.go:62, pkg/dang/import_install.go:126, pkg/dang/ast_expressions.go:613 · 2/2 votes · fingerprint a98e0d9d631b
- pkg/dang/dir_inference.go:127 — In focused LSP mode, siblings only run the declaration phases. Their `variable signatures` phase uses DeclareKnownSignature, which skips computed variables that have no type annotation. So a sibling's `pub useTemplates = modules()` never reaches dirEnv. Referencing it from the active buffer reports `"useTemplates" not found`, and completion and hover miss it too.
  worth it: False errors in the editor for ordinary cross-file code that RunDir accepts.
      var declarationPhases = inferencePhases[:6]
  fix: In InferDirectoryFilesFocused, also run the `variables` phase for siblings, keeping type and function bodies limited to the active file. Add a test that opens defs.dang while it references main.dang's `useTemplates`.
  also at pkg/dang/dir_inference.go:150, pkg/dang/dir_inference.go:131, pkg/dang/block.go:687, pkg/dang/slots.go:148 · 2/2 votes · fingerprint 49083331781e
- pkg/dang/ast_declarations.go:1222 — Each file's ImportDecl, including the auto-import that is now added to every file, calls NewEnv on its own, so every file gets a separate copy of each imported type. Named modules are only equal when they are the same pointer. If a.dang has `pub base(): Container! {...}` and b.dang has `pub wrap(): Container! { base }`, type checking fails with "cannot use Dagger.Container! as Dagger.Container!".
  worth it: multi-file Dagger modules routinely pass imported types between files
      i.inferred = NewEnv(i.Name.Name, config.Schema)
  fix: Build one schema module per import name/schema for the whole directory, e.g. memoize NewEnv in prepareFileScopes and share it across files and LSP keystrokes. Add a test that passes a Container across files.
  also at pkg/dang/dir_inference.go:194, pkg/dang/dir_inference.go:57, pkg/dang/dir_inference.go:54, pkg/dang/env.go:977 · 2/2 votes · fingerprint c3dae3476a68
- pkg/dang/dir_inference.go:82 — Variables are now ordered by dependency within each file only, and only for the active file in the LSP. RunDir: `pub y = x + 1` in a.dang with an untyped `pub x = 1 + 1` in b.dang now fails with `"x" not found`. LSP: a sibling's untyped `pub base = container.from(...)` never reaches dirEnv, so the active buffer gets a not-found error.
  worth it: cross-file references that worked at the merge base now break
      for _, scope := range scopes {
  fix: Run the variables phase once across all files, ordered together (orderVariablesForInference over the union, each form inferred in its own fileEnv). In focused mode, also infer sibling variables that have no annotation.
  also at pkg/dang/dir_inference.go:150, pkg/dang/block.go:768, pkg/dang/slots.go:148, pkg/dang/dir_inference.go:134 · 2/2 votes · fingerprint 51c28ec3ef06
- pkg/dang/dir_inference.go:115 — Variables are now ordered by dependency within each file only, and files are inferred in alphabetical order. With a.dang `pub x: String! = y` and b.dang `pub y = "a" + "b"`, x is inferred before y exists and RunDir fails with "y" not found. At the merge base all variables were sorted together, so this worked. The doc comment says resolution works "regardless of file order".
  worth it: Programs that type-checked before now fail depending on file names.
      return inferVariablesPhaseResilient(ctx, c.Variables, env, fresh, errs)
  fix: In runDirectoryPhases, handle the variables phase in one pass: collect Variables from all scopes, run orderVariablesForInference once, and infer each variable in its own file's fileEnv.
  also at pkg/dang/block.go:768, pkg/dang/slots.go:140, pkg/dang/dir_inference.go:19 · 2/2 votes · fingerprint 23a2b6d26c33

CONCERN:
- pkg/lsp/handler.go:418 — The parse cache hands the same *ModuleBlock to every analysis in the directory. That block is also the AST in an open sibling's File snapshot. When A is edited, A's analysis reassigns B's block.Env, ClassDecl.Inferred and FunDecl.InferredScope/Inferred to declaration-only state, while hover or completion on B may be reading them in parallel (jrpc2 does not order requests against later notifications). Is that sharing intended?
  worth it: stale types in B's completion, and possible concurrent map access crashes
      if hit && !cached.open && cached.mtime.Equal(info.ModTime()) && cached.size == info.Size() {
      		return cached.block, nil
  fix: Cache only the source text and parse result, and hand each analysis its own block (a deep copy, or a re-parse when the file is the active one). Or keep inference state off AST nodes for sibling files.
  also at pkg/lsp/handler.go:408, pkg/dang/dir_inference.go:63, pkg/dang/ast_declarations.go:98, pkg/lsp/ast_query.go:60 · 2/2 votes · fingerprint bf2fde6c43a5

Checked and found sound: Auto-import prepending is idempotent on cached blocks; Parse cache switches between open-buffer and disk fingerprints correctly; didChange analyses are serialized against each other.

Reviewed f60848c..1058f48 (8 commits, 13 files changed) at STANDARD depth (votes needed: 2 of 2, or 2 of 3 on a split; nit 1 of 1): 4 finders, triage, 12 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: pkg/dang/eval.go:2155 (general, general-2: "Imports are file-local at type-check time but not at runtime.") into pkg/dang/eval.go:2155: imports are file-local when type-checking but share one eval…; pkg/dang/dir_inference.go:127 (general: "In the LSP's focused mode, sibling variables without a type annotation…"), pkg/dang/dir_inference.go:150 (general-2: "In focused LSP mode, sibling files only run the declaration phases.") into pkg/dang/dir_inference.go:127: in focused LSP mode, siblings' unannotated computed variable…; pkg/dang/dir_inference.go:54 (behavior, general-2: "Each file now gets its own ImportDecl, so `NewEnv` builds a separate s…") into pkg/dang/ast_declarations.go:1222: a NewEnv per file creates distinct named module types, so Co…
