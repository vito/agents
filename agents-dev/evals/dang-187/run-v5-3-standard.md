3 important, 5 nits, 1 decision to record

Verdict: The change makes null checks work on nullable GraphQL object fields and lets `case` match the concrete type, and it fits the system. Fix eval.go:1287, ast_patterns.go:444 and ast_expressions.go:1998 first.

IMPORTANT:
- pkg/dang/ast_expressions.go:1998 — A non-null lazy fragment `... on User!` on a null receiver now returns null instead of raising the type-assertion error, though the result is typed `User!`. `let u = node(id: "nope").{{... on User!}}` binds null, and `u.name == null` is true for a `String!`. The failure only shows up later, at some typed boundary.
  worth it: The `!` no longer asserts presence, contrary to the documented runtime error.
      if typeName == nil {
      		return NullValue{}, nil
      	}
  fix: In evalGraphQLLazyInlineFragments (and the list variant), when __typename is nil and any fragment is NonNull, return the assertion error ("expected one of User, got null"). Update the test at test_graphql_nullable_object.dang:109 to expect it.
  also at pkg/dang/ast_expressions.go:1636, docs/lit/graphql/interop.md:72, tests/test_graphql_nullable_object.dang:109 · 2/2 votes · fingerprint f76e9d3a3029
- pkg/dang/ast_patterns.go:444 — A mutation-returned union handle is never resolved, but `case` over all of the union's members still type-checks as exhaustive with no `else`. At runtime no arm matches, and the program fails with the internal "exhaustive case did not match the value" error. Result unions on mutations are a common errors-as-data pattern, and the new docs' advice ("interface patterns or else") doesn't help a union, which has no interface pattern.
  worth it: Code that type-checks fails at runtime with a message that reads as a compiler bug.
      if g.IsMutation || !g.isAbstract() {
      		return false
      	}
  fix: In Case.Eval, when c.exhaustive and the operand is an abstract IsMutation handle, raise a clear error pointing to `.{{... on A ... on B}}`. Or have inference treat such operands as non-exhaustive.
  also at pkg/dang/ast_patterns.go:417, pkg/dang/ast_patterns.go:420, docs/lit/types/interfaces-unions.md:81 · 2/2 votes · fingerprint 00df03f55a87
- pkg/dang/eval.go:1287 — After a nullable interface value is checked, it is narrowed by wrapping its query in `... on User`. A later inline-fragment selection then sends `... on Post` inside that wrapper, and the server rejects the query as invalid. `let n = node(id: "User:1"); n.{{ ... on User {{ name }} ... on Post {{ title }} }}` fails with "Fragment cannot be spread here as objects of type "User" can never be of type "Post"". The same happens inside a `label(n: Node)` helper called with `node(id: "Post:3")!` or with a handle bound by `case`.
  worth it: This worked at the merge base, and this pattern is what the docs recommend for discriminating.
      g.QueryChain = g.QueryChain.InlineFragment(typeName)
  fix: In evalGraphQLInlineFragments, when gqlVal.TypeName is a concrete object type, emit only the fragments whose type is that object or an abstract type containing it, so the others never reach the query. Add a test with a checked `node` handle.
  also at pkg/dang/eval.go:962, pkg/dang/ast_expressions.go:1958 · 2/2 votes · fingerprint 20c7a796181a

NIT:
- docs/lit/types/interfaces-unions.md:81 — For mutation handles, the docs tell readers to narrow with `.{{... on Post}}` instead of `case`, because asking for the type would re-send the mutation. But the lazy fragment also asks for `__typename` on the mutation chain, then runs the mutation again for each field. Only the field-selecting form `.{{... on Post {{ title }} }}` runs it once.
  fix: In interfaces-unions.md line 81, recommend `.{{ ... on Post {{ title }} }}` (field-selecting fragments), not the lazy `.{{... on Post}}` narrowing.
  also at pkg/dang/ast_expressions.go:1994 · 1/1 votes · fingerprint 8aee26bcfc49
- pkg/dang/rescue_analysis.go:303 — The rescue analysis misses the null probe on import-qualified roots. `Test.user(id: "User:2").posts rescue null` warns that a lazy PostConnection leaves the rescue without executing. In fact the probe query runs inside the rescue, and the unqualified `user(...)` form gives no warning. `selectMayBeNull` looks up the receiver `Test` as a schema object, finds none, and returns false.
  fix: In chainMayBeNull/selectMayBeNull, when the receiver isn't a schema object, check whether the Select is a root Query field, as rootFieldMayBeNull does. Add a qualified case to rescue_lazy_result.dang.
  also at pkg/dang/rescue_analysis.go:311 · 1/1 votes · fingerprint 6909582d5ab6
- pkg/dang/ast_expressions.go:1994 — A lazy inline fragment on a handle that is already concrete (a probed nullable interface field) still queries `__typename` and stacks a second fragment. `let n = node(id:"User:1"); n.{{... on User!}}.name` sends three queries, the last being `node(...){... on User{... on User{name}}}`.
  fix: In evalGraphQLLazyInlineFragments, when gqlVal is not isAbstract(), call matchLazyInlineFragment with gqlVal.TypeName directly and don't add another InlineFragment.
  1/1 votes · fingerprint 5c389b6bb6d3
- .agents/skills/dang-language/reference/graphql.md:64 — The agent skill references still say no request is sent until a GraphQL value is forced. They also list only `.sync`, `.stdout` and `.{{ }}` as execution points. Neither mentions that binding a nullable object field now sends a check, or that `case` on an interface or union now queries for the concrete type. The lit docs were updated; these copies were not.
  fix: In graphql.md, add a short 'Nullable object fields' bullet to 'Laziness / forcing' and note the `case` behavior under 'Inline fragments'. In control-flow.md:137, add escaping nullable object fields to the exempt execution points.
  also at .agents/skills/dang-language/reference/control-flow.md:137 · 1/1 votes · fingerprint 6393f2475c2c
- pkg/dang/eval.go:468 — Selecting `.id` on a probed handle sends another query even though the probe already fetched the id and KnownID holds it. The docs-recommended `a.id == b.id` on two nullable lookups costs four requests where two would do.
  fix: Carry KnownID through SelectField into GraphQLFunction. In Call, return it for the `id` leaf when KnownID is set and the field is the loadable id (no args).
  also at pkg/dang/eval.go:281 · 1/1 votes · fingerprint 32a169de6aa8

DECISIONS TO RECORD (defensible choices, not defects):
- pkg/dang/eval.go:1247 — Once a nullable field's handle escapes, later failures report a path that starts at the loader. With `let u = user(id: "User:1")`, `u.alwaysFails` gives `GraphQLError.path` `["node","alwaysFails"]`. Inline `user(id: "User:1").alwaysFails` still gives `["user","alwaysFails"]`. At the merge base both gave the `user` path. The same failure now has a different path depending on whether the value was bound first.
  record: Record in errors.md, next to the GraphQLError `path` example, that a handle that was checked and loaded by ID reports paths from `node`/`load<T>FromID`, not from the field chain that produced it.
  also at pkg/dang/eval.go:338, pkg/dang/eval.go:960, pkg/dang/eval.go:965, pkg/dang/eval.go:1252 · 2/2 votes · fingerprint 15406e54b825

Checked and found sound: Argument, receiver, `!` and `??` operands still probe; Error-free null leaf on nullable chains is sound; case value clauses compare against the original handle.

Reviewed da1bed3..4e4300a (12 commits, 42 files changed) at STANDARD depth (votes needed: 2 of 2, or 2 of 3 on a split; nit 1 of 1): 4 finders, triage, 14 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: pkg/dang/eval.go:960 (general: "A probed handle is reloaded through `node(id:)`, so the `path` on a `G…"), pkg/dang/eval.go:1252 (general-2: "Once a nullable handle is checked and loaded by ID, the server errors…") into pkg/dang/eval.go:1247: a probed handle reloaded via node(id:) reports GraphQLError…; .agents/skills/dang-language/reference/graphql.md:64 (general-2: "The agent skill docs still describe GraphQL access as fully lazy and l…") into .agents/skills/dang-language/reference/graphql.md:64: the agent skill docs still describe GraphQL access as fully…
1 more nit over the nit cap (5) not reported.
