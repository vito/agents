2 important, 3 concerns, 1 nit

Verdict: The change mostly does what it sets out to: null checks, ID loads and `case` on abstract handles fit the existing selection model. It is not ready to merge yet. Fix first the regression where a multi-type inline-fragment selection on a checked or `case`-bound handle builds nested fragments that the server rejects.

IMPORTANT:
- pkg/dang/ast_expressions.go:1998 — `... on User!` on a nullable field that the server resolves to null now evaluates to null, while the type checker still gives it the non-null type `User!`. At the merge base it raised `inline fragment type assertion failed`. I ran `let u = node(id: "nope").{{... on User!}}; shout(u.name)`, where `shout(x: String!)`. `u == null` was true, and the only failure was a later, unrelated `x: null is not allowed for String!` at the call site. The new test asserts this as intended behavior.
  worth it: the documented non-null assertion no longer asserts, so a null travels under a `T!` type and fails far from where it started
  evidence:
      if typeName == nil {
      		return NullValue{}, nil
      	}
  also at pkg/dang/ast_expressions.go:1635, docs/lit/graphql/interop.md:72, tests/test_graphql_nullable_object.dang:109
  votes: 3/3 confirmed · correctness (general) · fingerprint aa9b9cbcbb14
- pkg/dang/eval.go:962 — A checked nullable interface/union handle (and the handle a `case` arm binds) now has a chain that ends in `... on <Concrete>`. A multi-type inline-fragment selection on it then nests the other fragments inside that one, and the server rejects the query. I ran `let n = node(id: "Post:1"); n.{{ ... on User {{ name }} ... on Post {{ title }} }}` against the test server. It sent `node(id:"Post:1"){... on Post{__typename ... on User { name } ... on Post { title }}}` and failed with `Fragment cannot be spread here as objects of type "Post" can never be of type "User"`. The same function called with the unprobed `favoriteNode` worked. At the merge base `n` kept the plain `node(id:"1")` chain, so this was a valid query.
  worth it: the docs teach this exact pattern for interface values, and binding a nullable interface field or passing it to a `Node`-typed function now breaks it at runtime
  evidence:
      chain = chain.InlineFragment(typeName)
  also at pkg/dang/eval.go:1287, pkg/dang/ast_expressions.go:1958, pkg/dang/ast_expressions.go:1962
  votes: 3/3 confirmed · correctness (behavior) · fingerprint 6415e0cd74dd

CONCERN:
- pkg/dang/eval.go:1247 — A probed handle is re-rooted at the loader, so server errors on it now report the loader's path. `let u = maybeUser(id: "User:1"); u.alwaysFails rescue { e: GraphQLError => toString(e.path) }` gives `["node","alwaysFails"]`, while the inline form `maybeUser(id: "User:1").alwaysFails` gives `["maybeUser","alwaysFails"]` (I ran both). Is it intended that `GraphQLError.path`, which the errors docs present as the way to inspect a failure, now depends on whether the value went through a `let`?
  worth it: code that matches on `e.path` behaves differently depending on how the handle was bound
  evidence:
      loaded, err := loadObjectFromTypedID(id, idType, typeName, g.Schema, g.TypeScope, g.Client)
  also at pkg/dang/eval.go:960, docs/lit/language/errors.md:357
  votes: 2/3 confirmed · behavior (general) · fingerprint 2d778b1f9b76
- pkg/dang/ast_patterns.go:444 — Handles reached through a mutation are never resolved. For a union-typed mutation result, no type pattern can match, and a `case` listing every member still type-checks as exhaustive and non-null. At runtime it then fails with the internal-looking `exhaustive case did not match the value`. Mutations that return result unions (Success | Error) are common. Should those `case`s be rejected at compile time, or at least fail with a message that points to the inline-fragment workaround the new docs mention?
  worth it: the new docs say these handles fall back to interface patterns or `else`, but a union has no interface patterns, so the documented path ends in an error the code calls a compiler bug
  evidence:
      if g.IsMutation || !g.isAbstract() {
  also at pkg/dang/ast_patterns.go:139, pkg/dang/ast_patterns.go:420
  votes: 2/3 confirmed · design (behavior) · fingerprint 2470da72a0ed
- docs/lit/types/interfaces-unions.md:81 — The docs give "asking would re-send the mutation" as the reason `case` won't resolve a handle reached through a mutation, and suggest an inline fragment instead. The fragment also re-sends it. I ran `let touched = Mutation.touchNode(id: "Post:1"); touched.{{... on Post!}}.title` and it sent the mutation twice: `{touchNode{__typename}}`, then `{touchNode{... on Post{title}}}`. Each leaf in a `case` arm re-sends it too (`n.id` in the test), so the refusal saves one request but quietly sends a Post to `else`.
  worth it: the workaround the docs recommend costs exactly what the refusal is meant to avoid, so the silent `else` fallthrough may not be worth keeping
  evidence:
      - the exception is a value reached through a **mutation**: asking would re-send the mutation, so it keeps its declared type and matches only interface patterns (`n: Node`) or `else`. Narrow it with an inline fragment (`.{{... on Post}}`) instead
  also at pkg/dang/ast_patterns.go:444, pkg/dang/ast_expressions.go:1994
  votes: 3/3 confirmed · design (design) · fingerprint 7d4002d13a50

NIT:
- .agents/skills/dang-language/reference/graphql.md:64 — The agent skill reference was edited only to change IDs. It still says GraphQL access is fully lazy and that mutations follow "same laziness rules as queries", and it says nothing about the null check when a handle escapes, loading by ID, or the query `case` sends; add the equivalent of interop.md's new "Nullable object fields" notes.
  worth it: agents writing Dang from this reference will expect `== null` and `case` to behave the old way
  also at .agents/skills/dang-language/reference/graphql.md:61
  votes: 3/3 confirmed · docs (general) · fingerprint b3f9b14a57e6

Checked and found sound:
- markSelectedThrough only flags direct receivers, so `!`, `??`, `rescue` and argument expressions still check for null.
- Equality holds after loading: `u == u` stays true, and `case` value clauses compare against the original handle.
- An error-free null leaf on a possibly-null chain becomes null only when there is no error, and Select.Infer already types it nullable.
- Rescue analysis agrees with when eval actually checks for null, for root, nested and selected-through fields.
- Every object in the current Dagger schema implements Node with `id: ID!`, so `@expectedType` loads still resolve through node(id:).

Reviewed da1bed3..4e4300a (merge base..head): 12 commits, 42 files changed, at STANDARD depth (3 finders; 3 voters per finding, quorum 2).
Sub-agents composed from: dag://?llm=committer/readonly, dag://?llm=contributor/readonly, dag://?expertise=editor/agent, dag://?llm=reviewer/finder, dag://?llm=reviewer/voter, dag://?llm=reviewer/synthesizer
Failing tests or checks listed for this call under finder-*, voter-* or synthesizer agents are the reviewers' own reproductions, run in private sandboxes (often written to fail on purpose to demonstrate a finding); they are not this change's CI results.

Merged into an earlier finding quoting the same code (2):
  - .agents/skills/dang-language/reference/graphql.md:64 (behavior): The agent skill reference still says no request is sent until a GraphQL value is forced, and says nothing about nullable object fields being checked when they e…
  - .agents/skills/dang-language/reference/graphql.md:64 (design): The agent skill reference still says GraphQL access sends no request until a value is forced. It doesn't mention that binding, passing or comparing a nullable o…
Below quorum (2 of 3): pkg/dang/ast_patterns.go:374 (0/3 confirmed)

Answer every finding: fix it (a re-review marks it FIXED), or resolve(fingerprint:, reason:). To post one on a pull request, pass its path and line to comment(path:, line:); one marked outside the hunks goes on the conversation instead.
