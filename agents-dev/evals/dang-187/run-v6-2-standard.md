3 important, 2 concerns, 1 nit

Verdict: The change makes null checks and `case` work on GraphQL object and abstract fields without breaking the existing laziness model. Fix eval.go:962 and ast_expressions.go:1998 first, then the warning at rescue_analysis.go:576.

IMPORTANT:
- pkg/dang/ast_expressions.go:1998 — `... on User!` on a null receiver now evaluates to null instead of failing the assertion. The expression is still typed `User!`, so `let y = node(id: "nope").{{... on User!}}; y.name` prints `null` for a `String!` field. At the merge base this raised `inline fragment type assertion failed`.
  worth it: Non-null types no longer guarantee non-null values, and the docs promise an assertion.
      if typeName == nil {
      		return NullValue{}, nil
  fix: In evalGraphQLLazyInlineFragments (and the list path), return the assertion error when typeName is nil and any fragment is NonNull. Change the `== null` assertion at test_graphql_nullable_object.dang:109 to expect an error.
  also at pkg/dang/ast_expressions.go:1636, docs/lit/graphql/interop.md:72, tests/test_graphql_nullable_object.dang:109 · 2/2 votes · fingerprint c005aa824559
- pkg/dang/rescue_analysis.go:576 — The rescue analysis still treats escaping nullable root fields called with arguments as lazy, even though they are probed now. `let m = maybeUser(id: "nope") rescue null` sends `{maybeUser{id __typename}}` inside the rescue but still warns `a lazy User leaves this rescue without executing`. The same happens through a qualified import: `Test.user(id: "nope").posts rescue null`.
  worth it: The common `user(id:)` / `node(id:)` case gets a false warning with misleading advice.
      if classifyGQLSymbol(fn, n.selectedThrough) == gqlLeafField {
  fix: For a FunCall applying a Symbol, classify against the FunCall's inferred type, as chainMayBeNull already does. Resolve import-namespace receivers to the Query type. Add warning fixtures for both cases.
  also at pkg/dang/rescue_analysis.go:270, pkg/dang/rescue_analysis.go:303 · 2/2 votes · fingerprint a0146de01668
- pkg/dang/eval.go:962 — A handle that was probed or matched by `case` now has a chain ending in `node(id){... on <Concrete>}`. Inline fragments on it that name another type make invalid GraphQL. Example: `let n = node(id: "User:1")` followed by `n.{{ ... on User {{name}} ... on Post {{title}} }}` fails with "Fragment cannot be spread here as objects of type User can never be of type Post". The same thing happens in a `case` interface arm (`u: User => …, n: Node => n.{{…}}`).
  worth it: Normal interface code that worked at the merge base now fails at runtime.
      chain = chain.InlineFragment(typeName)
  fix: In the inline-fragment eval, when gqlVal.TypeName is already concrete, emit only the fragments whose type it satisfies (treat the rest as no match). Add the escaped-node and case-arm cases to the tests.
  also at pkg/dang/eval.go:1287, pkg/dang/ast_patterns.go:398, pkg/dang/eval.go:338 · 2/2 votes · fingerprint e7ab0b55595a

CONCERN:
- docs/lit/types/interfaces-unions.md:81 — `case` refuses to resolve a handle reached through a mutation because asking "would re-send the mutation". The docs suggest an inline fragment instead, but that sends the mutation again too, twice for `.{{... on Post!}}.title`. With a loader, resolving would send the mutation once and then go through `node(id:)`. Is the trade-off pointing the right way?
  worth it: Concrete patterns silently fall to `else`, and the suggested workaround costs more mutation sends.
      asking would re-send the mutation, so it keeps its declared type and matches only interface patterns (`n: Node`) or `else`. Narrow it with an inline fragment (`.{{... on Post}}`) instead
  fix: Either resolve mutation handles when a loader exists (one mutation send, then load by ID), or change the docs rationale to laziness and drop the inline-fragment advice.
  also at pkg/dang/ast_patterns.go:444, tests/test_graphql_abstract_case.dang:88 · 2/3 votes · fingerprint 2cd6ad79e56f
- pkg/dang/eval.go:863 — Only non-list nullable fields are null-checked. A field typed as a nullable list of objects (e.g. a GitHub connection's `nodes: [Issue]`) stays a lazy handle that never equals null. Yet `user.manager.posts.posts` (a non-null list off a nullable step) is checked and becomes null. resolveNull already handles lists. Is leaving them out intended?
  worth it: Issue #186's `== null` bug remains for one category of nullable fields.
      if typeRef.Kind == introspection.TypeKindNonNull || typeRef.Kind == introspection.TypeKindList {
  fix: Also mark nullable list-of-object fields as MaybeNull in GraphQLFunction.Call, reusing resolveNull's list path, and mirror it in rescue_analysis.
  also at pkg/dang/eval.go:314 · 2/2 votes · fingerprint 26c6070dea04

NIT:
- docs/lit/graphql/interop.md:95 — Several docs still say no request is sent until a value is forced, and none of them mention the null probe on escape or the query that `case` sends: the interop page's Laziness paragraph, the skill reference graphql.md, and control-flow.md's list of tails exempt from the lazy-result warning. The change edited graphql.md, but only to update IDs.
  fix: Add one line to interop.md:95 and graphql.md:64 on probing and `case` resolution. Add nullable object fields to the exempt tails in control-flow.md:137.
  also at .agents/skills/dang-language/reference/graphql.md:64, .agents/skills/dang-language/reference/control-flow.md:137 · 1/1 votes · fingerprint 4b66eb56f79b

Checked and found sound: Selected-through chains still send a single query; ID loading needs ID! or custom scalar ids, not String!; node(id:) loader is checked against the type's interfaces.

Reviewed da1bed3..4e4300a (12 commits, 42 files changed) at STANDARD depth (votes needed: 2 of 2, or 2 of 3 on a split; nit 1 of 1): 4 finders, triage, 16 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: .agents/skills/dang-language/reference/graphql.md:64 (behavior, design, general-2: "The agent skill references are now out of date. graphql.md still says…") into docs/lit/graphql/interop.md:95: Several docs still say no GraphQL request is sent until a va…; pkg/dang/ast_patterns.go:374 (design: "`case` resolves an abstract handle before any clause runs.") into pkg/dang/ast_patterns.go:374: case looks up the concrete type before trying any clause, so…
Below quorum: pkg/dang/eval.go:960 (1/3, needed 2), pkg/dang/ast_patterns.go:374 (0/1, needed 1)
