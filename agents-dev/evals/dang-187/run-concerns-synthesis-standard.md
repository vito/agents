1 important, 2 concerns, 1 nit

Verdict: The change mostly does what it sets out to do and fits the system. Nullable object fields now compare equal to null, chains that are only selected through cost one request, and `case` matches abstract handles by their concrete type. The suite passes at head. One confirmed regression should be fixed before merge: once an interface or union handle has been resolved to its concrete type, an inline-fragment projection on it (`n.{{ ... on User {{…}} ... on Post {{…}} }}`) sends a query the server rejects. That covers a bound checked `node(...)`, a `Node` parameter that receives one, and an interface arm after a concrete arm in a `case`. Separately, decide whether a union reached through a mutation should still count as exhaustive in `case`, and whether error paths should name `node` instead of the original field after a reload.
Checked and found sound:
- `!`, `??`, `case` operands, arguments and receivers wrapped in `if` or rescue are not flagged by markSelectedThrough, which only unwraps Grouped, so null checks still probe before a value escapes.
- In `case`, value clauses still compare against the original handle (QueryChain pointer identity), and a null result is null for every clause.
- Treating an error-free null leaf on a MaybeNull chain as null is backed by GraphQL null bubbling and matches the type checker stripping NonNull through a nullable receiver.
- The union probe only selects `id` through per-type inline fragments when the ids share one non-null type, and the loader lookup finds Dagger's `node(id: ID!)` as well as legacy `load<T>FromID`.
- Query counts match the description (`user(id:).name` now one request; a bound handle costs a probe plus one load per later selection), and the full TestDang suite (773 tests) passes at head.

Reviewed da1bed3..4e4300a (merge base..head): 12 commits, 42 files changed, at STANDARD depth (3 finders; 3 voters per finding, quorum 2).
Sub-agents composed from: dag://?llm=committer/readonly, dag://?llm=contributor/readonly, dag://?expertise=editor/agent, dag://?llm=reviewer/finder, dag://?llm=reviewer/voter, dag://?llm=reviewer/synthesizer
Failing tests or checks listed for this call under finder-*, voter-* or synthesizer agents are the reviewers' own reproductions, run in private sandboxes (often written to fail on purpose to demonstrate a finding); they are not this change's CI results.

IMPORTANT:
- pkg/dang/eval.go:1287 — When an interface or union handle has been resolved to its concrete type, an inline-fragment projection on it now fails on the server. This covers a checked nullable `node(...)` bound with `let`, a `Node` function parameter that receives one, and the binding of an interface arm such as `n: Node` after `u: User` in a `case`. The resolved handle's chain already ends in `... on Post`, and the projection adds every fragment the declared type allows inside it. I ran a probe suite test against the gqlserver. `let label(n: Node) { n.{{ ... on User {{ name }} ... on Post {{ title }} }} }; label(node(id: "Post:1"))` sent `{node(id:"Post:1"){... on Post{__typename ... on User { name } ... on Post { title }}}}` and got `Fragment cannot be spread here as objects of type "Post" can never be of type "User"`. `case (favoriteNode) { u: User => …  n: Node => n.{{ …same… }} }` failed the same way. The same projection on the unresolved `favoriteNode` works. At the merge base these handles stayed abstract, so the query was valid.
  worth it: this is the discriminating pattern the new docs recommend, and it now breaks on exactly the handles the change narrows, including any Node-typed parameter.
  evidence:
      g.QueryChain = g.QueryChain.InlineFragment(typeName)
  also at pkg/dang/eval.go:962:
      chain = chain.InlineFragment(typeName)
  also at pkg/dang/ast_expressions.go:1958:
      fragParts = append(fragParts, fmt.Sprintf("... on %s { %s }", frag.TypeName.Name, strings.Join(fieldParts, " ")))
  also at pkg/dang/ast_patterns.go:398:
      childScope.Bind(clause.Binding, typedVal, PrivateVisibility)
  votes: 3/3 confirmed · correctness (general) · fingerprint cb220142fead

CONCERN:
- pkg/dang/ast_patterns.go:444 — A union-typed handle reached through a mutation is never resolved. The type checker still treats a `case` that lists every union member, with no `else`, as exhaustive. On such a handle no concrete pattern matches, so evaluation reaches the internal "exhaustive case did not match the value" error instead of a clear message. The docs say these values match "only interface patterns or else", but a union operand has no interface patterns. Should exhaustiveness exclude mutation-reached unions, or should this path fail with a clear message?
  worth it: the change closes this gap for query fields but leaves the mutation path failing with an error that says it is a compiler bug.
  evidence:
      if g.IsMutation || !g.isAbstract() {
  also at pkg/dang/ast_patterns.go:420:
      return nil, fmt.Errorf("exhaustive case did not match the value: %v", exprVal)
  also at pkg/dang/ast_patterns.go:139:
      c.exhaustive = hasElse || c.coversAllMembers(exprType)
  also at docs/lit/types/interfaces-unions.md:81:
      - the exception is a value reached through a **mutation**: asking would re-send the mutation, so it keeps its declared type and matches only interface patterns (`n: Node`) or `else`. Narrow it with an inline fragment (`.{{... on Post}}`) instead
  votes: 3/3 confirmed · design (behavior) · fingerprint 7f47d75cf470
- pkg/dang/eval.go:1247 — Once a nullable object handle is bound or passed along, it is probed and reloaded through `node(id:)`. After that, a server error on any of its fields reports a different GraphQLError.path, and the Dang-side message names the field `node` instead of `user`. The value no longer looks like it came from `user(...)`. I ran a probe test: `user(id: "User:1").alwaysFails rescue { e: GraphQLError => toString(e.path) }` gave ["user","alwaysFails"]. `let u = user(id: "User:1"); u.alwaysFails rescue {...}` gave ["node","alwaysFails"]. The query sent was `node(id:"User:1"){... on User{alwaysFails}}`. The same rebasing applies to `case` arms on abstract handles.
  worth it: errors.md presents `path` as the way to inspect failures without parsing text. It now depends on whether the handle was used inline or bound first, which breaks code that matches on paths and makes error reports point at a `node` query the user never wrote.
  evidence:
      loaded, err := loadObjectFromTypedID(id, idType, typeName, g.Schema, g.TypeScope, g.Client)
  also at pkg/dang/eval.go:960:
      chain := querybuilder.Query().Client(client).Select(loader.Name).Arg("id", id)
  also at docs/lit/language/errors.md:352:
      client-side wrapping, and its `path` and `extensions` make the failure
  votes: 3/3 confirmed · behavior (design) · fingerprint 3ba94dca8759

NIT:
- .agents/skills/dang-language/reference/graphql.md:64 — The agent skill reference still says no GraphQL request is sent until a value is forced, and still lists only `.sync`/`.stdout`/`.{{ }}` as execution points. Both are now stale: escaping nullable object fields and `case` on abstract handles also send queries. Update both lines to match docs/lit/graphql/interop.md.
  worth it: agents writing Dang from this reference will expect laziness, and rescue placement, that no longer hold.
  also at .agents/skills/dang-language/reference/control-flow.md:137
  votes: 3/3 confirmed · docs (behavior) · fingerprint 59754f4baad6

Merged into an earlier finding quoting the same code (1):
  - pkg/dang/ast_patterns.go:444 (design): `case` never resolves a handle reached through a mutation. For a mutation that returns a union, a `case` that names every member with no `else` still type-check…
Below quorum (2 of 3): pkg/dang/eval.go:960 (0/3 confirmed), pkg/dang/eval.go:335 (0/3 confirmed)

Answer every finding: fix it (a re-review marks it FIXED), or resolve(fingerprint:, reason:). To post one on a pull request, pass its path and line to comment(path:, line:); one marked outside the hunks goes on the conversation instead.
