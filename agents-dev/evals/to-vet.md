# To vet: every unlabelled item across the eval cases

Each entry below is an issue or a "sound" item in one of the cases under
agents-dev/evals/ that has no label yet. Reply to an entry by number with its
label; I copy it into that case's vetting.md (`vetted:` under its heading).

- An **issue** is something a review might raise. Label it `real` (worth
  raising on that change: a bug, design guidance, or a quick fix you would
  take) or `dismiss` (not worth the time). A review that raises a dismissed
  issue scores a speed bump.
- A **sound item** is something an earlier review checked and found correct,
  used as a trap. Label it `sound` (it holds, so a finding that says it is
  broken scores false) or `dismiss` (it does not hold, or is no trap).

"Runs" are the reviewer's saved reviews in each case directory
(run-v5-1-standard.md and so on). Issues 1, 2, 4, 5, 7, 9, 10 and 14 were
added from the v5 runs because they kept coming back, and 13 from a v2 run.
None is confirmed by a later fix (for the dang-55 and dang-59 ones, whether a
later commit of the PR fixed them was not checked).

## dang-187: nullable GraphQL object fields (vito/dang#187)

Background: the PR makes a nullable object field (`user(id:)`, `manager`)
compare equal to null by sending a small probe query when the handle
escapes the chain (bound with `let`, passed as an argument), then reloading
it by ID through `node(id:)`; and it makes `case` on an interface or union
value send a query to learn the concrete type. Mutation chains are exempt
from both, because a second query would re-send the mutation.

1. **mutation-union-case-fails** (issue). A `case` over a union that a
   mutation returns, with one arm per member and no `else`, type-checks as
   exhaustive. But a mutation's handle is never resolved to its concrete
   type, so at runtime no arm matches and the program dies with the internal
   "exhaustive case did not match the value" error (code that reads as a
   compiler bug). Unions such as `User | ValidationError` are a common
   mutation result. pkg/dang/ast_patterns.go:444 (the `g.IsMutation` early
   return), :420 (the error); docs/lit/types/interfaces-unions.md:81 says
   such values match only interface patterns or `else`, which a union has no
   interface pattern for. Suggested fix: at type-check time, treat a
   mutation-rooted abstract operand as non-exhaustive (require `else`), or
   raise a clear error in Case.Eval pointing to `.{{... on A}}`. Raised in
   all three v5 runs; a finder reproduced it with a probe schema.

2. **nonnull-fragment-on-null** (issue). `node(id: "nope").{{... on User!}}`
   now evaluates to null, though the `!` asserts presence and the result is
   typed `User!`; so `u.name == null` holds for a `String!` and the failure
   surfaces later at some typed boundary. At the merge base it raised the
   type-assertion error. The change's own test
   (tests/test_graphql_nullable_object.dang:109) asserts the null, so this
   may be deliberate. pkg/dang/ast_expressions.go:1998. Suggested fix: when
   the receiver is null and any fragment is non-null, raise the assertion
   error (in evalGraphQLLazyInlineFragments, its list variant and
   ObjectSelection.Eval's null-receiver return), or type the result nullable
   when the receiver is. Raised in v5 runs 2 and 3; a voter reproduced it.

3. **mutation-sent-once** (sound item): "No mutation is sent twice; the
   mutation test enforces it." Your vetting note already records two runs
   seeing `touched.{{... on Post!}}.title` on a mutation result send the
   mutation twice (`{touchNode{__typename}}`, then the fragment). v5 run 3
   adds that the docs' advice for mutation results (interfaces-unions.md:81,
   "narrow with `.{{... on Post}}`") does the same: the lazy fragment asks
   for `__typename`, then re-runs the mutation per field; only the
   field-selecting form `.{{... on Post {{ title }} }}` runs it once. If that
   holds, this wants `dismiss` (and the double send could become an issue of
   its own).

## dang-59-file-local-imports (vito/dang#59, first 8 commits)

Background: the range makes each file's imports visible only to that file
(a.dang's `import Dagger` no longer leaks into b.dang), infers a directory
file by file in lockstep phases, and adds LSP caches. The three issues
history fixed are already labelled; these came from the runs.

4. **schema-module-per-file** (issue). Every file now gets its own
   auto-injected `import Dagger`, and each ImportDecl builds its own schema
   module (pkg/dang/ast_declarations.go:1222,
   `i.inferred = NewEnv(i.Name.Name, config.Schema)`). Types compare by
   module pointer, so `Container` from a.dang and `Container` from b.dang are
   different types: a.dang `pub makeC: Container! { container }` and b.dang
   `pub useC: Container! { makeC }` fails with "cannot use Container! as
   Container!". Dagger modules split across files would stop type-checking;
   it also rebuilds the whole schema once per file. Suggested fix: build one
   schema module per import name per directory (a map in prepareFileScopes)
   and test passing Dagger.Container between files. IMPORTANT in all three
   v5 runs.

5. **variables-ordered-per-file** (issue). Computed top-level variables are
   now ordered within each file only (pkg/dang/dir_inference.go:82), where the
   old directory-wide sort ordered them across files. a.dang `pub x = y + 1`
   with b.dang `pub y = 1 + 2` fails with `"y" not found` because a.dang's
   variables run first; a cross-file cycle says "not found" instead of
   "circular". Suggested fix: order the variables phase once over every
   file's variables, inferring each in its own file's env, with a two-file
   test. IMPORTANT in all three v5 runs and in v4. It contradicts item 6.

6. **lockstep-phases** (sound item): "runDirectoryPhases runs each phase
   across every file before starting the next, so every type name is
   registered before any signature resolves and cross-file references in
   signatures and bodies work regardless of file order." True of the phase
   order, but if item 5 is real, not of variables referring to variables in
   another file: then this wants `dismiss` (or a narrower wording).

7. **shared-mutable-parse-cache** (issue, a design concern). The LSP's parse
   cache hands one mutable AST to both a file's own analysis and its
   siblings' passes (pkg/lsp/handler.go:408). Editing B re-runs declaration
   inference on open file A's cached AST and overwrites the inferred scopes
   and types A's hover and completion read; jrpc2 does not wait for
   in-flight requests, so it can race with a hover on A. Suggested fix: parse
   open siblings into a separate copy, or cache sibling-use blocks apart from
   the AST each file exposes. Raised in all three v5 runs (a question twice,
   IMPORTANT once).

8. **local-shadows-import-in-inference** (sound item): "Each file's
   composite env reads the shared dirEnv before the file's own imports and
   writes to dirEnv, so during inference a local declaration shadows an
   imported name and declarations stay visible to sibling files." No run
   contradicted it.

## dang-55-shadowing (vito/dang#55, first commit: shadow imported types)

Background: with `import Test` in scope, a local `type User` used to reuse
and mutate the imported Test.User; the commit gives it a fresh module and
drops the unqualified import alias, deciding "is this an import?" from a
side table (unqualifiedTypeImports) that ImportDecl fills.

9. **repl-imports-untracked** (issue). The REPL installs its imports with
   BuildEnvFromImports (pkg/dang/eval.go:382), which never records them in
   that table, so in the REPL a local `type Container { ... }` with Dagger
   loaded still reuses and mutates Dagger.Container: the bug the commit
   fixes, left in place for the REPL (pkg/dang/slots.go:350). Suggested fix:
   have BuildEnvFromImports record what it installs (TrackUnqualifiedTypeImport
   and the value variant), or decide shadowing by ownership (is the existing
   type a local declaration?). Raised in all three v5 runs (IMPORTANT once).

10. **interface-union-redeclare-merges** (issue, minor). Interface and union
    declarations used to get a fresh module every time; now they reuse an
    existing local type (pkg/dang/slots.go:1013, :1121). In the REPL's
    persistent environment a redeclaration merges with the stale one:
    `union U = A | B`, then `union U = A | C`, has members A, B, A, C; a
    redeclared interface keeps its old fields. Suggested fix: keep a fresh
    module for interface/union declarations (only clear the shadowed import),
    or reuse only when the existing module's kind matches. Raised in all
    three v5 runs (one of them a fixless one-liner).

11. **imported-module-not-mutated** (sound item): "A local declaration that
    shadows an unqualified imported type gets a fresh module and the alias is
    cleared, instead of reusing and mutating the imported schema type, so
    Test.User after a local `type User` still resolves to the imported type."
    Holds for files and RunDir; item 9 says not in the REPL. If item 9 is
    real, `dismiss` or read this as files only.

12. **all-kinds-covered** (sound item): "Type, enum, scalar, interface and
    union declarations all go through declareLocalType, and the new gqlserver
    tests cover shadowing for each kind." Item 10 is a side effect of exactly
    this (interfaces and unions now reuse modules), but it does not say the
    coverage claim is wrong.

## dang-160-clean (vito/dang#160: Float arguments, lossless numbers)

Background: a known-clean change (nothing was fixed after it), used to
measure noise. It decodes responses with json.Number (UseNumber) so
integers stay exact, lets Float (and Map) values be passed as arguments, and
gives the untyped converter ToValue a json.Number case.

13. **float-arg-six-decimals** (issue). Float arguments now reach
    querybuilder's marshaller, which formats floats with `%f` (six decimals;
    pkg/querybuilder/marshal.go:69): `1.23456789` is sent as `1.234568` and
    `0.0000001` as `0.000000`, silently. NaN and Inf come out as invalid
    GraphQL literals. The new test uses 4.5 and 2.5, which survive.
    Suggested fix: `strconv.FormatFloat(f, 'g', -1, 64)`, reject NaN/Inf,
    test `echoFloat(value: 1.23456789) == 1.23456789`. IMPORTANT in every run
    since v2.

14. **fragment-leaf-float-as-int** (issue). Leaves of a nested selection
    inside an inline fragment still go through the untyped ToValue
    (convertNestedSelectionResult, pkg/dang/ast_expressions.go:2026), not the
    schema type. With the new json.Number case (pkg/dang/builtins.go:138), a
    Float field whose value is whole (servers send 4.0 as `4`) becomes an Int,
    so `score / 8` divides as integers (0, not 0.5); at the merge base it was
    a Float. ToValue's new comment says typed leaves never reach it.
    Suggested fix: look up the leaf's schema field in
    convertNestedSelectionResult and convert with its type, as
    convertInlineFragmentResult does, plus a nested-fragment Float test.
    Raised in every run since v2 (5/5), and checked by inspection at both
    ends.

15. **use-number-decode** (sound item): "Execute decodes the response's data
    (and every unpack) with UseNumber, so integers stay exact; the declared
    GraphQL type then decides Int vs Float." Item 14 says the second half
    fails for nested fragment leaves; the decoding itself is not disputed.

16. **float-and-map-arguments** (sound item): "dangValueToGo now serializes
    FloatValue and MapValue (recursively), so a Float result can be passed
    back as a Float argument; the new test round-trips averageRating
    through echoFloat." Runs keep doubting the Map half: no GraphQL argument
    type unifies with a Map, so the MapValue case looks unreachable, and if
    reached its keys go out unquoted. Voted down in most runs.

17. **untyped-number-fallback** (sound item): "ToValue's json.Number case is
    the untyped fallback: an integral number that fits an int becomes an
    Int, anything else a Float." As a fallback it is fine; item 14 is about
    typed values reaching it.

## agents-tools-version (vito/agents dfc7196: version tool state)

Background: the commit bumps Committer's and Staff's tool-state version to
1 in their agent entries; the known bug (labelled real) is that Committer's
continuations still rebind at version 0.

18. **staff-has-no-continuations** (sound item): "Staff is bound with
    withTools only in its agent entry; its other withTools calls bind other
    objects (peers, chiefLine), so bumping Staff's version needs no other
    change." One run raised staff/main.dang:67 against it and was voted down
    0/2 (v2 also 0/3).

19. **version-discards-stale-state** (sound item): "A withTools version bump
    discards saved tool state from an older version instead of failing to
    load it, which is the commit's stated purpose." No run contradicted it.
