2 important, 3 concerns, 2 nits

Verdict: The change does what it sets out to: null checks, loading by ID and `case` on abstract types now work whether or not a field is nullable. But valid queries break on narrowed handles, so fix eval.go:962 first, then rescue_analysis.go:564.

IMPORTANT:
- pkg/dang/eval.go:962 — A checked nullable interface handle, or one bound by a `case` arm after resolving, carries `... on <Concrete>` in its chain. A later inline-fragment selection naming another type nests inside that fragment, and the server rejects the query. For example, `let n = node(id: "User:1"); n.{{ ... on User {{name}} ... on Post {{title}} }}` sends `node(id:){... on User{... on User{name} ... on Post{title}}}`.
  worth it: The docs recommend this fragment pattern, and it worked on these handles before because they stayed lazy.
      chain = chain.InlineFragment(typeName)
  fix: In evalGraphQLInlineFragments, when the receiver's TypeName is already concrete, drop fragments that can't match it (yield null fields) instead of spreading them. Add a test on a probed `node(id:)`.
  also at pkg/dang/eval.go:1287, pkg/dang/ast_patterns.go:398, docs/lit/types/interfaces-unions.md:113, pkg/dang/ast_expressions.go:1958 · 2/2 votes · fingerprint c73e5411d44a
- pkg/dang/rescue_analysis.go:564 — Qualified root calls get the wrong rescue diagnosis. `Test.maybeUser(id: "User:1") rescue null` and `Test.maybeUser(id: "User:1").posts rescue null` warn "a lazy User/PostConnection leaves this rescue without executing". At runtime both are probed inside the rescue. The unqualified forms don't warn. classifyGQLSelect and selectMayBeNull find no schema module for the `Test` receiver, so they never see the nullable root field.
  worth it: the warning tells users their rescue guards nothing when it does
      if classifyGQLSelect(n, n.selectedThrough) == gqlLeafField {
  fix: In classifyGQLSelect and selectMayBeNull, treat a Select whose receiver is an import module like a root symbol: classify against the schema's Query type. Add a qualified case to tests/warnings/rescue_lazy_result.dang.
  also at pkg/dang/rescue_analysis.go:303, pkg/dang/rescue_analysis.go:289, pkg/dang/rescue_analysis.go:256 · 2/2 votes · fingerprint 745c0dbcc6fd

CONCERN:
- docs/lit/types/interfaces-unions.md:81 — The interfaces page says `case` doesn't resolve a mutation-returned handle because that would re-send the mutation, and suggests narrowing with `.{{... on Post}}` instead. That lazy fragment re-sends the mutation too: it queries `__typename` through the mutation chain, and then `.title` sends the mutation again. A field-selecting fragment runs it once.
  worth it: people following the advice run side-effecting mutations twice
      - the exception is a value reached through a **mutation**: asking would re-send the mutation, so it keeps its declared type and matches only interface patterns (`n: Node`) or `else`. Narrow it with an inline fragment (`.{{... on Post}}`) instead
  fix: In interfaces-unions.md line 81, recommend a field-selecting fragment (`.{{... on Post {{ title }}}}`), noting it is one round-trip. Apply the same fix to the test's `touched.{{... on Post!}}.title` example.
  also at pkg/dang/ast_expressions.go:1994, tests/test_graphql_abstract_case.dang:88 · 2/2 votes · fingerprint ad02f22d1972
- tests/nullable_object_test.go:170 — The probe fetches `id` and sets KnownID, but selecting `.id` on the probed handle still sends another query. `let u = maybeUser(id: "User:2"); u.id` now costs two requests (`{id __typename}` and then `node(id:){... on User{id}}`) where the merge base needed one. The new test pins this wasted query.
  worth it: The common `x.id` pattern gets an extra round trip for a value already known.
      `query Query {node(id:"User:1"){... on User{id}}}`,
  fix: In GraphQLValue.SelectField/GraphQLFunction.Call, when the field is the loadable `id` with no args and KnownID is set, return KnownID converted via graphQLResultToValue without querying. Update the test expectation.
  also at pkg/dang/eval.go:402 · 2/2 votes · fingerprint 4f3ca07a893f
- pkg/dang/ast_expressions.go:1998 — On a null GraphQL receiver, `... on User!` now returns null instead of the documented assertion error, even though its inferred type is `User!`. Bound to a typed slot, it fails later with `null is not allowed for Test.User!`. Unbound, selections off it quietly turn into null. Is a null result intended for the asserting `!` form, as opposed to the nullable lazy form?
  worth it: `!` no longer guarantees non-null; the failure moves away from the assertion
      if typeName == nil {
      		return NullValue{}, nil
      	}
  fix: In evalGraphQLLazyInlineFragments, raise the assertion error when the receiver is null and a fragment is NonNull. Otherwise make inferInlineFragments return a nullable type for nullable receivers. Update the `{{... on User!}} == null` test.
  also at pkg/dang/ast_expressions.go:1635, docs/lit/graphql/interop.md:72, tests/test_graphql_nullable_object.dang:109 · 2/3 votes · fingerprint e8545602003e

NIT:
- .agents/skills/dang-language/reference/graphql.md:64 — The agent skill's GraphQL reference still says no request is sent until a value is forced. It does not mention that escaping nullable object handles are probed and loaded by ID, or that `case` on an interface or union sends a query. The change edits this file but only swaps IDs; docs/lit got the new section.
  fix: Add a short "Nullable object fields" bullet list to .agents/skills/dang-language/reference/graphql.md mirroring interop.md#nullable-object-fields, plus a note on `case` over abstract types.
  also at .agents/skills/dang-language/reference/control-flow.md:137, .agents/skills/dang-language/reference/graphql.md:61 · 1/1 votes · fingerprint 63f6357758f8
- pkg/dang/ast_patterns.go:375 — `case` resolves an abstract handle before it tries any clause. When an earlier value clause matches, as in `case (f) { f => "same"; p: Post => ...; else => ... }`, it still sends `{favoriteNode{id __typename}}` and never uses the result.
  fix: In Case.Eval, resolve lazily: compute typedVal the first time the loop reaches a type-pattern clause (or a null clause when the handle is MaybeNull), not before the loop.
  also at pkg/dang/ast_patterns.go:385 · 1/1 votes · fingerprint 5a7ed684ca51

Checked and found sound: Mutation handles skip both the probe and case resolution; Union probe skips possible types whose ID types conflict; An error-free null leaf on nullable chains is null.

Reviewed da1bed3..4e4300a (12 commits, 42 files changed) at STANDARD depth (votes needed: 2 of 2, or 2 of 3 on a split; nit 1 of 1): 4 finders, triage, 13 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: pkg/dang/eval.go:1287 (general: "When a nullable interface handle is checked, it is narrowed to its con…") into pkg/dang/eval.go:962: narrowed handle's chain keeps ... on Concrete, so later frag…; pkg/dang/rescue_analysis.go:303 (general-2: "The rescue analysis misses a nullable root field reached through an im…") into pkg/dang/rescue_analysis.go:564: rescue analysis ignores nullable root fields reached through…; .agents/skills/dang-language/reference/graphql.md:64 (general, behavior, design: "The agent skill reference still says GraphQL field access is lazy and…") into .agents/skills/dang-language/reference/graphql.md:64: skill graphql.md still says nothing is sent until a value is…; docs/lit/types/interfaces-unions.md:81 (behavior: "The docs say `case` won't resolve a mutation-returned handle because t…") into docs/lit/types/interfaces-unions.md:81: docs suggest a bare fragment for mutation handles, but it re…
