1 important, 1 nit, 2 pre-existing

Reviewed da1bed3..4e4300a (merge base..head): 12 commits, 42 files changed, at STANDARD depth (3 finders; 3 voters per finding, quorum 2).
Sub-agents composed from: dag://?expertise=browser/agent, dag://?llm=committer/readonly, dag://?llm=contributor/readonly, dag://?expertise=editor/agent, dag://?llm=reviewer/finder, dag://?llm=reviewer/voter

IMPORTANT:
- pkg/dang/eval.go:962 — When a nullable interface or union handle escapes, it is now probed and swapped for a handle whose query chain ends in an inline fragment on the concrete type (`node(id:"User:1"){... on User}`). Its static type is still the interface, so the type checker accepts multi-type inline fragments on it. Those fragments are then nested under the concrete fragment, and the query fails GraphQL validation. Reproduced at head: `let n = node(id: "User:1"); n.{{ ... on User {{ name }} ... on Post {{ title }} }}` sends `node(id:"User:1"){... on User{__typename ... on User { name } ... on Post { title }}}`, and the server rejects it with `Fragment cannot be spread here as objects of type "User" can never be of type "Post"`. A single non-matching fragment (`n.{{... on Post {{title}}}}`) now errors as well, where before it returned null. Before this change, `n` stayed a lazy `node(id:)` handle and both forms worked. The same applies to resolveObject's no-loader path (narrowTo, line 1287), and to any `n: Node` function parameter fed a probed value.
  evidence:
      chain = chain.InlineFragment(typeName)
  votes: 3/3 confirmed · correctness (correctness) · fingerprint 34c9dbf98246

NIT:
- .agents/skills/dang-language/reference/graphql.md:64 — This skill reference still says no request is sent until a GraphQL value is forced. After this change a nullable object, interface or union field (or anything selected off one) sends a `{ id __typename }` probe as soon as it escapes the chain, e.g. `let m = user(id: "User:1").manager`. A `case` with concrete type patterns on an interface or union handle (`case (favoriteNode) { p: Post => ... }`) also sends a query. The user docs (interop.md "Nullable object fields", errors.md) were updated; this agent reference was not, so it now contradicts the runtime.
  evidence:
      GraphQL field access is **lazy**. A GraphQL value accumulates a query chain (`.field`, `.{{...}}`, args); no request is sent until the value is **forced** — materialized at an expected-type boundary (assertion, `print`, assignment to a typed field, indexing into a result, etc.). Forcing runs the built-up selection as a single request.
  votes: 3/3 confirmed · docs (fit) · fingerprint cdc333c5457f

PRE-EXISTING (outside the change's hunks: not this change's doing; GitHub cannot anchor a line comment there):
- .agents/skills/dang-language/reference/graphql.md:61 — This skill reference still says mutations follow the same laziness rules as queries. The change makes nullable object fields reached through a mutation the one exception: they are never null-probed, so they never compare equal to `null`. The change also stops `case` from resolving the concrete type of an abstract handle reached through a mutation, so that handle only matches interface patterns or `else`. The change rewrote the matching sentence in docs/lit/graphql/interop.md ("with one exception: nullable object fields reached through a mutation are not checked for null") but left this copy alone. Agents using the skill will expect `== null` and concrete `case` patterns to work on mutation results.
  evidence:
      - Side effects happen when the call **executes**, which is when its value is **forced** (same laziness rules as queries).
  votes: 3/3 confirmed · docs (fit) · fingerprint b8f196f7a1a8
- .agents/skills/dang-language/reference/control-flow.md:135 — This skill reference still lists only leaf fields and `.{{ }}` selections as GraphQL execution points. The change adds a third: a possibly-null handle escaping the chain is probed. The rescue analysis (classifyField) now treats that as a leaf, so `user(id: "User:2").manager rescue null` no longer warns, as the new tests/warnings/rescue_lazy_result.dang cases show. docs/lit/language/errors.md was updated to say this, but this twin was not, so the agent guidance on where to place `rescue` and when the compiler warns is out of date.
  evidence:
      GraphQL failures happen at **execution points** — a leaf field call (scalar/enum underneath, incl. `@expectedType`-mapped fields like Dagger's `sync`) or a `.{{ }}` selection — not where an object-typed chain is built.
  votes: 3/3 confirmed · docs (fit) · fingerprint ec18bcd5f316
