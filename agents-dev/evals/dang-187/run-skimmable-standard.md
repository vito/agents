2 concerns, 1 nit

Verdict: The change does what it sets out to do and fits the system. Null checks on nullable GraphQL fields, loading by ID, and `case` on abstract types all work as described. Deal with mutation-sourced unions first: `case` can pass type checking as exhaustive and then match nothing at runtime.

CONCERN:
- pkg/dang/ast_patterns.go:444 — The type checker still accepts a `case` on a union reached through a mutation as exhaustive when its type patterns cover every member and there is no `else`. Because that handle is never resolved, no arm matches at runtime and evaluation fails with an internal-sounding error. I ran a probe against a fake schema `type Mutation { make: R! }` (`union R = A | B`): `case (Mutation.make) { a: A => "a"; b: B => "b" }` failed with `exhaustive case did not match the value: gql:Value:R.make` and sent no queries. Should the type checker refuse to treat mutation-sourced unions as exhaustive, or should the docs say that `else` is required? Mutations returning union payloads (result | error types) are a common GraphQL pattern.
  worth it: the new docs describe this mutation exception, but the realistic union case passes type-checking and then crashes with a message that reads as a compiler bug.
  evidence:
      if g.IsMutation || !g.isAbstract() {
  also at pkg/dang/ast_patterns.go:420, docs/lit/types/interfaces-unions.md:81
  votes: 3/3 confirmed · design (behavior) · fingerprint 1783c6fcc8dc
- docs/lit/types/interfaces-unions.md:81 — For a value reached through a mutation, the interfaces page says `case` won't ask for the concrete type because "asking would re-send the mutation", and recommends an inline fragment (`.{{... on Post}}`) instead. The lazy inline fragment does the same thing: it runs a `__typename` query on the mutation chain. I recorded `let touched = Mutation.touchNode(id: "Post:1"); touched.{{... on Post!}}.title` and saw two requests: `mutation Mutation {touchNode(id:"Post:1"){__typename}}` and then `mutation Mutation {touchNode(id:"Post:1"){... on Post{title}}}`. Should the docs say that narrowing sends the mutation again too, or point to a `.{{ ... on Post {{ … }} }}` projection, which sends it once?
  worth it: the documented workaround brings back the double mutation that the `case` rule was written to avoid, and the new test runs it that way
  evidence:
      asking would re-send the mutation, so it keeps its declared type and matches only interface patterns (`n: Node`) or `else`. Narrow it with an inline fragment (`.{{... on Post}}`) instead
  also at pkg/dang/ast_expressions.go:1994, pkg/dang/ast_patterns.go:440, tests/test_graphql_abstract_case.dang:88
  votes: 3/3 confirmed · docs (design) · fingerprint 43aea095b43d

NIT:
- .agents/skills/dang-language/reference/graphql.md:64 — The skill reference this change edits still says no request is sent until a GraphQL value is forced, and it never mentions the null check on escape, loading by ID, or `case` querying an abstract value's concrete type. Add a short nullable-object-fields note mirroring interop.md.
  worth it: agents writing Dang read this copy and will misjudge round trips and null checks
  votes: 3/3 confirmed · docs (general) · fingerprint 289024962ded

Checked and found sound:
- Only the call being selected from skips the null check. `??`, `!`, rescue, dot-block and argument operands are still checked.
- A null leaf on a possibly-null chain matches its inferred nullable type, so a `String!` binding can't end up holding null.
- The union null check asks for `id` only on members that share one non-null ID type, so the query stays valid GraphQL.
- Checked and loaded handles keep reference identity, so `==` still tells separately built values apart.
- nodeCanReturn's new Node requirement doesn't break Dagger loading, since Dagger objects and interfaces implement Node.

Reviewed da1bed3..4e4300a (merge base..head): 12 commits, 42 files changed, at STANDARD depth (3 finders; 3 voters per finding, quorum 2).
Sub-agents composed from: dag://?llm=committer/readonly, dag://?llm=contributor/readonly, dag://?expertise=editor/agent, dag://?llm=reviewer/finder, dag://?llm=reviewer/voter, dag://?llm=reviewer/synthesizer
Failing tests or checks listed for this call under finder-*, voter-* or synthesizer agents are the reviewers' own reproductions, run in private sandboxes (often written to fail on purpose to demonstrate a finding); they are not this change's CI results.

Merged into an earlier finding quoting the same code (2):
  - .agents/skills/dang-language/reference/graphql.md:64 (behavior): The agent skill's GraphQL reference still says no request is sent until a value is forced. It should mention that an escaping nullable object field is checked (…
  - .agents/skills/dang-language/reference/graphql.md:64 (design): The agent skill references still say no request is sent until a value is forced, and that the only rescue execution points are `.sync`, `.stdout` and `.{{ }}`.…
Below quorum (2 of 3): pkg/dang/ast_patterns.go:375 (0/3 confirmed), pkg/dang/ast_patterns.go:374 (0/3 confirmed), pkg/dang/eval.go:960 (1/3 confirmed), pkg/dang/eval.go:1089 (0/3 confirmed)

Answer every finding: fix it (a re-review marks it FIXED), or resolve(fingerprint:, reason:). To post one on a pull request, pass its path and line to comment(path:, line:); one marked outside the hunks goes on the conversation instead.
