5 important, 3 concerns, 1 nit

Verdict: The file-local import model and the LSP speedups mostly do what they set out to do, but they change behaviour in ways that aren't fixed yet. Fix first: running only declaration phases on siblings, plus per-file variable ordering, leaves unannotated computed sibling declarations unresolved. Also open: the per-file `NewEnv` type identity break and the shared runtime env for imports.

IMPORTANT:
- pkg/dang/dir_inference.go:145 — In the LSP, siblings now get only the declaration phases. That means an unannotated computed sibling variable (e.g. `pub base = container.from("alpine")` or `let x = someFn()`) is never added to dirEnv, and an unannotated sibling function keeps a fresh type variable as its return type. An active buffer that uses `base` now gets a `"base" not found` diagnostic, and its completion drops `base`, even though RunDir accepts the directory. At the merge base, full inference over all files resolved these names. I didn't run this; it follows from DeclareKnownSignature returning nil when allowComputed=false, and the current tests only use annotated sibling declarations.
  worth it: multi-file modules routinely use unannotated `let`/`pub` helpers across files, so editors would show false errors that `dang run` doesn't report.
  evidence:
      runDirectoryPhases(ctx, scopes, fresh, overall, declarationPhases)
  also at pkg/dang/slots.go:137, pkg/dang/slots.go:148, pkg/dang/ast_declarations.go:130, pkg/lsp/handler.go:306
  votes: 3/3 confirmed · correctness (general) · fingerprint 183c0c579f50
- pkg/dang/eval.go:2155 — Imports are now file-local for type checking but still share one runtime env. Say a.dang imports X and b.dang imports Y, and both schemas expose an unqualified `foo`. Inference types b's `foo` as Y.foo. At runtime, all imports are evaluated into one shared evalEnv and the first binding wins (X's), so b's `foo` evaluates X.foo. At the merge base, both imports went into one env and this was reported as an `ambiguous reference to "foo"` error. I didn't run it; it follows from RunDir's concatenated masterBlock plus the LookupLocal skip.
  worth it: code that type-checks now silently calls a different schema's field than the type checker resolved.
  evidence:
      masterBlock := &ModuleBlock{Forms: allForms, Inline: true}
  also at pkg/dang/import_install.go:126, pkg/dang/dir_inference.go:57
  votes: 3/3 confirmed · correctness (general) · fingerprint 67b3eba24369
- pkg/dang/dir_inference.go:194 — Every file now gets its own `ImportDecl`, including the synthetic auto-import, and each one calls `NewEnv`. `NewEnv` builds a fresh `*Module` for every schema type, and named modules compare by pointer. So `Container!` in a.dang and `Container!` in b.dang are different types: passing a value returned by a function in one file into a parameter typed `Container!` in a sibling now fails with "cannot use Dagger.Container! as Dagger.Container!". At the merge base there was one injected import per directory, so one shared type. This is from reading the code; I had no test runner here. The same root cause rebuilds the schema env once per file on every RunDir.
  worth it: Any Dagger module split across files that passes SDK objects between them stops type-checking, in RunDir, DeclareDir and the LSP alike.
  evidence:
      injected = append(injected, &ImportDecl{
  also at pkg/dang/ast_declarations.go:1222, pkg/dang/env.go:396, pkg/dang/env.go:977
  votes: 3/3 confirmed · correctness (behavior) · fingerprint 394a6d6eb918
- pkg/dang/dir_inference.go:82 — Computed variables are now ordered within each file, not across the directory. At the base, `orderVariablesForInference` saw every file's variables at once. Now it runs once per file, in file-name order. With a.dang `pub greeting = "Hi " + name` and b.dang `pub name = toString(1)`, a's variables are inferred before b's `name` has any type, so the result is `"name" not found`. A cross-file cycle also no longer reports "circular module variable initializer". In the LSP it is worse: focused mode never infers sibling variables or type bodies, so any reference from the active buffer to a sibling's unannotated computed `pub`/`let` (or an untyped computed class field) shows up as an error diagnostic.
  worth it: Valid directory modules that worked at the merge base now fail to type-check, and editors flag correct cross-file references.
  evidence:
      for _, scope := range scopes {
  also at pkg/dang/block.go:768, pkg/dang/slots.go:137, pkg/dang/dir_inference.go:131
  votes: 3/3 confirmed · behavior (behavior) · fingerprint c6b7123d8722
- pkg/dang/eval.go:2153 — Imports are file-local only during type checking; at runtime all files still share one `evalEnv`. Example: a.dang has `import A` and b.dang has `import B`, and both schemas expose a Query field `foo`. Each file type-checks `foo` against its own import. At eval, A's import runs first and binds `foo`, and `installUnqualifiedImportValues` skips names that are already bound. So b.dang's `foo` calls A's field, typed as B's. At the base this was reported as an "ambiguous reference" error.
  worth it: It quietly calls the wrong API instead of raising an error.
  evidence:
      allForms = append(allForms, block.Forms...)
  also at pkg/dang/import_install.go:126, pkg/dang/dir_inference.go:57
  votes: 3/3 confirmed · correctness (behavior) · fingerprint 493de6a71ae2

CONCERN:
- pkg/lsp/handler.go:419 — With the parse cache, the block an open file publishes as `f.AST` is the same object that later sibling analyses re-run declaration phases on. Those analyses reassign `block.Forms`, `block.Env`, `ClassDecl.Inferred` and the nodes' inferred types. jrpc2 only orders a notification after earlier notifications, not after in-flight requests, so a hover/completion on A can run while a didChange on B rewrites A's nodes (hover reads `node.GetInferredType()`). Before, each analysis parsed fresh blocks, so a published snapshot never changed afterwards. Is that intended, or should siblings get a copy, or the cache be keyed so the published AST is never re-inferred?
  worth it: it brings back the kind of shared-AST race the hover code already guards against with shallow copies, and lets A's hover show types from B's declaration-only pass.
  evidence:
      return cached.block, nil
  also at pkg/dang/dir_inference.go:54, pkg/dang/dir_inference.go:63, pkg/lsp/handle_text_document_hover.go:86
  votes: 3/3 confirmed · design (general) · fingerprint 91dfe4e13329
- pkg/dang/dir_inference.go:63 — The parse cache hands the same `*ModuleBlock` to every analysis in the directory. Analyzing B therefore rewrites nodes in A's stored AST: `block.Env` is overwritten, and `ClassDecl.Inferred` is replaced by a declaration-only class from B's run. Completion reads those node envs through `findEnclosingEnvironments`, so A's completion now depends on which sibling was analyzed last, and those writes can overlap A's in-flight requests. Is sharing mutable inferred state across files intended, or should each analysis work on its own copy (or only cache the raw parse)?
  worth it: Editing B makes A's completion show stale or partial results, and the cross-goroutine writes are a data race.
  evidence:
      block.Env = fileEnv
  also at pkg/dang/slots.go:482, pkg/lsp/ast_query.go:52, pkg/lsp/handler.go:408
  votes: 3/3 confirmed · design (behavior) · fingerprint 95f4919856c2
- pkg/lsp/handler.go:255 — For open buffers, the parse cache hands out the same *ModuleBlock that is stored as that file's File.AST snapshot. When sibling buffer B gets a didChange, the declaration phases run again on A's cached block against a new dirEnv. That overwrites block.Env, FunDecl.InferredScope/Inferred and ClassDecl.Inferred on A's nodes with signature-only state, while A's bodies are not re-inferred. A function with no declared return type falls back to a fresh type variable. jrpc2 can run a hover or completion call at the same time as a later notification, so this is also a data race. It breaks the guarantee that waitForSnapshot's comment states. Could A's cached block be cloned, or could its body-inferred state be kept?
  worth it: hover and completion in one open buffer can now change, or race, because of edits in another buffer, where before each analysis worked on its own fresh AST.
  evidence:
      block, err := h.parseFileCached(path)
  also at pkg/lsp/handler.go:498, pkg/dang/dir_inference.go:63, pkg/dang/ast_declarations.go:98, pkg/lsp/ast_query.go:56
  votes: 3/3 confirmed · design (design) · fingerprint be14dd9d84ee

NIT:
- pkg/dang/dir_inference.go:178 — `prependAutoImports` is a line-for-line copy of the existing exported `InjectAutoImports`; call that instead of keeping two copies that can drift apart.
  worth it: removes duplicated logic.
  also at pkg/dang/eval.go:1972
  votes: 3/3 confirmed · design (general) · fingerprint 531066712a55

Checked and found sound:
- Stat/read errors wrap *fs.PathError, so they stay fatal; parse errors are still logged and skipped.
- Cache entries record open vs disk source, so a closed buffer misses the cache and is re-read from disk.
- Synthetic auto-import ImportDecls with nil Loc are skipped safely by collectSymbols, positionWithinNode and rename.
- Re-installing a cached ImportDecl into a fresh importsEnv is idempotent and doesn't add staleness.
- CompositeModule lookup checks dirEnv first and writes go to dirEnv, so locals shadow imports and siblings still see each other.

Reviewed f60848c..1058f48 (merge base..head): 8 commits, 13 files changed, at STANDARD depth (3 finders; 3 voters per finding, quorum 2).
Sub-agents composed from: dag://?llm=committer/readonly, dag://?llm=contributor/readonly, dag://?expertise=editor/agent, dag://?llm=reviewer/finder, dag://?llm=reviewer/voter, dag://?llm=reviewer/synthesizer
Failing tests or checks listed for this call under finder-*, voter-* or synthesizer agents are the reviewers' own reproductions, run in private sandboxes (often written to fail on purpose to demonstrate a finding); they are not this change's CI results.

Merged into an earlier finding quoting the same code (3):
  - pkg/dang/dir_inference.go:178 (behavior): `prependAutoImports` is a line-for-line copy of the exported `InjectAutoImports`, which `RunFile` still uses; call that instead so the two can't drift apart.
  - pkg/dang/dir_inference.go:194 (design): Two files in one directory that both import a schema (or both get it through auto-import) now end up with different type objects for every schema type. Each fil…
  - pkg/dang/eval.go:2153 (design): Imports are file-local only while types are checked. At runtime, RunDir joins every file's forms into one masterBlock that runs against a single shared evalEnv.…
Below quorum (2 of 3): pkg/dang/env_test.go:264 (0/3 confirmed)

Answer every finding: fix it (a re-review marks it FIXED), or resolve(fingerprint:, reason:). To post one on a pull request, pass its path and line to comment(path:, line:); one marked outside the hunks goes on the conversation instead.
