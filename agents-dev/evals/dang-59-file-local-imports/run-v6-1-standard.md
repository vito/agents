3 important, 2 concerns

Verdict: Imports do become file-local, but this isn't ready to merge: it breaks multi-file modules that work today. Fix ast_declarations.go:1222 and dir_inference.go:115 first, then dir_inference.go:145.

IMPORTANT:
- pkg/dang/ast_declarations.go:1222 — Each file's ImportDecl now builds its own schema module with `NewEnv`, so `Container` in a.dang and `Container` in b.dang are different `*Module` objects. Named modules compare by pointer, so a value of an imported type passed across files fails to type-check. Example: a.dang has `pub base: Container! {…}` and b.dang calls `useIt(base)` where `useIt(c: Container!)`. The error reads like `cannot use Container! as Container!`. Auto-imports are injected per file, so every multi-file Dagger module is affected.
  worth it: Multi-file Dagger modules that pass SDK types between files stop type-checking.
      i.inferred = NewEnv(i.Name.Name, config.Schema)
  fix: Build each import's schema module once per directory (keyed by import name/config) in prepareFileScopes and share it across files' ImportDecls; add a RunDir test passing Dagger.Container between two files.
  also at pkg/dang/dir_inference.go:57, pkg/dang/dir_inference.go:54, pkg/dang/env.go:977, pkg/dang/env.go:396 · 2/2 votes · fingerprint 0309f0693c85
- pkg/dang/dir_inference.go:145 — In focused LSP mode, siblings only run DeclareKnownSignature. That registers nothing for a computed value without an annotation, such as `pub repo = repository(...)` in demos/github. If the active buffer references one of these sibling values, it gets an undefined-symbol diagnostic, even though RunDir accepts the directory. Sibling functions without a return type likewise come back with an unresolved type variable.
  worth it: false error diagnostics on valid multi-file code; the commit says cross-file refs 'still resolve'
      runDirectoryPhases(ctx, scopes, fresh, overall, declarationPhases)
  fix: For siblings, also run the variables phase (or infer just the untyped top-level slots they declare), and add an LSP test where main.dang references a sibling's `pub x = f()`.
  also at pkg/dang/dir_inference.go:150, pkg/dang/dir_inference.go:127, pkg/lsp/handler.go:306, pkg/dang/slots.go:148 · 2/2 votes · fingerprint 1aefd9a9228c
- pkg/dang/dir_inference.go:115 — RunDir now orders computed variables one file at a time. Take a.dang `pub greeting = "hi " + name` and b.dang `pub name = "wor" + "ld"`: greeting is inferred before `name` exists and fails with `"name" not found`. Before, variables from all files were sorted together and this worked. Cycles that span files now also report 'not found' instead of the cycle.
  worth it: Valid multi-file modules stop type-checking depending on file names.
      return inferVariablesPhaseResilient(ctx, c.Variables, env, fresh, errs)
  fix: Run the variables phase once for the whole directory: call orderVariablesForInference on all files' variables together, then infer each one in its own file's fileEnv (keep a node→scope map).
  also at pkg/dang/dir_inference.go:82, pkg/dang/dir_inference.go:19, pkg/dang/block.go:768, pkg/dang/slots.go:137 · 2/2 votes · fingerprint 0d02d7eb2b31

CONCERN:
- pkg/lsp/handler.go:408 — An open buffer's cached block is both its File.AST and a reused sibling block. Analyzing sibling B re-runs A's declaration phases on those same nodes, overwriting A's block.Env, ClassDecl.Inferred and FunDecl.InferredScope/Inferred with declaration-only state. A's hover and completion therefore depend on whether a sibling was edited since A's last analysis. A request on A that is still in flight when B's didChange is dispatched also reads nodes while they are being written.
  worth it: waitForSnapshot promises isolation that the shared AST no longer provides
      if hit && cached.open && cached.text == text {
  fix: In parseFileCached, don't hand out a cached open-buffer block to a sibling analysis (re-parse open siblings), or have File keep its own parse separate from the shared cache.
  also at pkg/dang/dir_inference.go:63, pkg/lsp/handler.go:274, pkg/lsp/handler.go:409, pkg/dang/slots.go:482 · 2/2 votes · fingerprint b9141734c37f
- pkg/dang/eval.go:2153 — Imports are now file-local only during type checking. RunDir still evaluates every file's ImportDecls into one shared evalEnv, and the first import to bind an unqualified name wins. Example: a.dang imports X and b.dang imports Y, and both schemas have `user`. B's `user` type-checks as Y.user but at runtime calls X.user. Before, the shared env reported this as an ambiguous reference.
  worth it: The checker passes code that runs against the wrong schema, with no error.
      allForms = append(allForms, block.Forms...)
  fix: Evaluate each file's forms in a per-file eval env (that file's imports layered over the shared declaration env), mirroring fileEnv. At minimum, error when sibling files' unqualified import providers differ.
  also at pkg/dang/dir_inference.go:57, pkg/dang/eval.go:2155, pkg/dang/import_install.go:126, pkg/dang/ast_expressions.go:613 · 2/2 votes · fingerprint 5e9ad254e87d

Checked and found sound: prependAutoImports stays idempotent on cached blocks; Cached ImportDecl re-installs its module into each fresh env; Builtin names still resolve before imports via dirEnv.

Reviewed f60848c..1058f48 (8 commits, 13 files changed) at STANDARD depth (votes needed: 2 of 2, or 2 of 3 on a split; nit 1 of 1): 4 finders, triage, 10 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: pkg/dang/ast_declarations.go:1222 (general, general-2: "Each file's `import X`, and each per-file auto-import, now calls NewEn…") into pkg/dang/ast_declarations.go:1222: per-file NewEnv makes schema types differ by pointer across…; pkg/dang/dir_inference.go:127 (general, behavior: "In the LSP's focused mode, siblings only get declarationPhases, which…"), pkg/dang/dir_inference.go:145 (design: "In focused LSP mode, sibling files only get the declaration phases.") into pkg/dang/dir_inference.go:145: focused LSP mode skips sibling variable inference, causing f…; pkg/lsp/handler.go:408 (general: "An open buffer's cached block is the same object as that file's publis…"), pkg/lsp/handler.go:409 (behavior: "Cached blocks are now shared between File A's stored AST and later ana…") into pkg/lsp/handler.go:408: cached open-buffer blocks are mutated by sibling analysis; pkg/dang/dir_inference.go:82 (behavior: "RunDir's variables phase now runs one file at a time, and `orderVariab…") into pkg/dang/dir_inference.go:115: RunDir orders variables per file, so cross-file dependencies…; pkg/dang/eval.go:2155 (general-2: "Type checking now keeps imports per file, but RunDir still evaluates e…") into pkg/dang/eval.go:2153: shared runtime evalEnv disagrees with per-file import type c…
