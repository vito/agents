1 important, 1 concern, 1 nit

Verdict: Mostly does what it sets out to, and nullable and abstract handles fit the existing selection model. Fix the exhaustive mutation-union case at pkg/dang/ast_patterns.go:444 and correct the advice in docs/lit/types/interfaces-unions.md:81 first.

IMPORTANT:
- pkg/dang/ast_patterns.go:444 — A `case` on a union reached through a mutation can cover every member with no `else`, so it type-checks as exhaustive. Because such handles are never resolved, no arm matches and it fails at runtime with "exhaustive case did not match the value". I ran a probe with `create: CreateResult!` (User|Problem) and got that error; the same case on a Query field worked.
  worth it: The new docs promise mutation values still match interface patterns or `else`, but a union has neither, so it hits a 'compiler bug' error.
      if g.IsMutation || !g.isAbstract() {
      		return false
      	}
  also at docs/lit/types/interfaces-unions.md:81, docs/lit/types/interfaces-unions.md:106, pkg/dang/ast_patterns.go:420 · 3/3 votes · fingerprint 626a67ba0bfe

CONCERN:
- docs/lit/types/interfaces-unions.md:81 — The interfaces doc says to narrow a mutation-returned value with a lazy inline fragment because `case` would re-send the mutation. The lazy fragment re-sends it too. I ran `let t = Mutation.touchNode(id:"Post:1"); print(t.{{... on Post!}}.title)` and it sent two `mutation Mutation {touchNode…}` requests, one for `__typename` and one for `title`.
  worth it: Following the docs runs real side-effecting mutations twice.
      Narrow it with an inline fragment (`.{{... on Post}}`) instead
  also at pkg/dang/ast_expressions.go:1994, tests/test_graphql_abstract_case.dang:88 · 3/3 votes · fingerprint 81ca078a0c84

NIT:
- .agents/skills/dang-language/reference/graphql.md:64 — The agent skill reference still says no request is sent until a value is forced, and that mutations follow the same laziness rules. Add the null check on nullable object fields, the extra query `case` sends for interface and union values, and the mutation exception, as interop.md now does.
  also at .agents/skills/dang-language/reference/graphql.md:61, .agents/skills/dang-language/reference/control-flow.md:137 · 1/1 votes · fingerprint 2631b7a4f79c

Checked and found sound:
- markSelectedThrough flags only the direct receiver, so `??`, `!` and argument operands are still null-checked.
- Value clauses compare against the original handle, and a resolved null replaces both, so `null` patterns match.
- Union probes select `id` only from members with matching ID types, which avoids field-merge conflicts.

Reviewed da1bed3..4e4300a (12 commits, 42 files changed) at STANDARD depth (votes needed: important 2 of 3, concern 2 of 2 or 2 of 3 on a split, nit 1 of 1): 3 finders, triage, 12 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: pkg/dang/ast_patterns.go:444 (behavior) into pkg/dang/ast_patterns.go:444: exhaustive case on mutation-reached union fails at runtime; .agents/skills/dang-language/reference/graphql.md:64 (general, behavior) into .agents/skills/dang-language/reference/graphql.md:64: agent skill graphql.md laziness text is stale; pkg/dang/eval.go:1247 (design) into pkg/dang/eval.go:960: node(id:) loading changes GraphQLError.path
Below quorum: pkg/dang/eval.go:960 (0/2, needed 2), pkg/dang/ast_expressions.go:1998 (1/3, needed 2)
