2 important, 2 concerns, 3 nits, 1 decision to record

Verdict: The change mostly does what it sets out to: null checks run when a handle escapes, and `case` matches the concrete type. Fix the multi-branch fragment regression at eval.go:1287 and the exhaustive-case runtime failure at ast_patterns.go:444 first.

IMPORTANT:
- pkg/dang/ast_patterns.go:444 — This change documents that mutation-returned abstract handles keep their declared type. For a non-null union, a `case` that covers every member without `else` type-checks as exhaustive, then fails at runtime with the internal `exhaustive case did not match the value: gql:Value:U.make` error. union docs promise exhaustive cases need no else.
  worth it: users get a 'compiler bug' error for code the docs say is valid.
      if g.IsMutation || !g.isAbstract() {
  fix: In Case.Eval, when an exhaustive case falls through on an unresolved IsMutation abstract handle, raise a user-facing error that points to inline fragments. Also note the union consequence in the mutation bullet of interfaces-unions.md.
  also at docs/lit/types/interfaces-unions.md:81, docs/lit/types/interfaces-unions.md:106, pkg/dang/ast_patterns.go:420 · 2/2 votes · fingerprint 2b00957e55e9
- pkg/dang/eval.go:1287 — An inline-fragment selection with several branches now fails on any interface value that was probed or resolved by `case`. Example: `let n = node(id: "User:1"); n.{{ ... on User {{name}} ... on Post {{title}} }}`. The handle's chain already ends in `... on User`, so the server receives `node(id:"User:1"){... on User{__typename ... on User{name} ... on Post{title}}}` and rejects it. At the merge base this worked.
  worth it: The documented way to discriminate GraphQL values breaks once the value is bound with `let` or passed to a function.
      g.QueryChain = g.QueryChain.InlineFragment(typeName)
  fix: In evalGraphQLInlineFragments, when gqlVal.TypeName is already concrete, leave out fragments whose type cannot hold that type. Add a test that runs `let n = node(...)` and then a selection with two fragments.
  also at pkg/dang/eval.go:962, pkg/dang/ast_expressions.go:1962 · 2/2 votes · fingerprint b150091bbba0

CONCERN:
- pkg/dang/eval.go:863 — A nullable list-of-objects field (`things: [Thing!]`) that the server returns as null still compares unequal to null. `isNullableObjectType` excludes lists, so the list is only checked when it inherits MaybeNull, even though resolveNull already has a list branch. Should a directly nullable list be checked when it escapes too?
  worth it: This is the same #186 null-check failure, left in place for nullable lists.
      if typeRef.Kind == introspection.TypeKindNonNull || typeRef.Kind == introspection.TypeKindList {
  fix: Set MaybeNull in GraphQLFunction.Call when the field is a nullable list whose element type is an object (not only an inherited null). resolveNull's list branch already handles the check; add a nullable-list field to gqlserver to cover it.
  2/2 votes · fingerprint c01b163d5bd1
- docs/lit/types/interfaces-unions.md:81 — The docs say `case` skips resolving mutation handles because asking would re-send the mutation, then recommend `.{{... on Post}}` instead. That lazy fragment runs its own `__typename` query on the mutation chain, so it re-sends the mutation exactly as resolving would. `touched.{{... on Post!}}.title` sends the mutation twice.
  worth it: users following the advice re-run side effects the docs say are avoided
      - the exception is a value reached through a **mutation**: asking would re-send the mutation, so it keeps its declared type and matches only interface patterns (`n: Node`) or `else`. Narrow it with an inline fragment (`.{{... on Post}}`) instead
  fix: In interfaces-unions.md, recommend a fragment with fields (`.{{... on Post {{ title }}}}`, one request), or say plainly that the lazy fragment also re-sends the mutation.
  also at pkg/dang/ast_expressions.go:1994, tests/test_graphql_abstract_case.dang:88 · 2/2 votes · fingerprint 2113972acd96

NIT:
- .agents/skills/dang-language/reference/graphql.md:64 — The agent skill reference still says GraphQL field access is lazy with no request until forced, and that mutations follow the same rules. The change edited this file but did not mention that nullable object fields are probed when they escape, or that `case` on interfaces and unions sends a query.
  fix: Add short bullets to the Laziness/forcing and Mutations sections of .agents/skills/dang-language/reference/graphql.md, mirroring interop.md's nullable-object-fields section and the interfaces-unions `case` note.
  also at .agents/skills/dang-language/reference/graphql.md:61, .agents/skills/dang-language/reference/control-flow.md:137 · 1/1 votes · fingerprint ba4128537fb7
- pkg/dang/eval.go:338 — Reading `.id` off a probed handle sends a second query, even though the probe already fetched the id and stored it in KnownID. `let m = user(id: "User:2").manager; m!.id` costs two round trips, where the merge base sent one (`{user{manager{id}}}`). The interop page's own example, `let parent = me.parent … parent.id`, hits this.
  fix: In GraphQLFunction.Call (or SelectField), when the receiver has KnownID and the field is its loadable `id` field, return the KnownID as the value instead of executing. Then update the `probes argument expressions` expectation.
  also at tests/nullable_object_test.go:170, docs/lit/graphql/interop.md:104 · 1/1 votes · fingerprint 488daf15cd13
- .agents/skills/dang-language/reference/graphql.md:64 — Several laziness descriptions are now incomplete. The skill reference, which the change edits, still says no request is sent until a value is forced, and that mutations follow the same rules as queries. It never mentions null checks on escape or `case` resolving abstract handles. errors.md's list of execution points also leaves out `case` with type patterns, which now runs the chain.
  fix: Add the escape check, load-by-ID and `case` resolution to the skill graphql.md 'Laziness / forcing' and 'Mutations' sections. Add `case` type patterns on an interface/union handle to the execution points listed in errors.md.
  also at .agents/skills/dang-language/reference/graphql.md:61, docs/lit/language/errors.md:440 · 1/1 votes · fingerprint 4eee3121e62d

DECISIONS TO RECORD (defensible choices, not defects):
- pkg/dang/eval.go:960 — A `GraphQLError.path` now depends on whether the handle was bound first. `user(id: "User:1").alwaysFails` reports `["user","alwaysFails"]`. `let u = user(id: "User:1"); u.alwaysFails` reports `["node","alwaysFails"]`, because the probed handle is reloaded through `node(id:)` and its chain starts at the loader. At the merge base both reported `["user", …]`.
  record: In errors.md, next to the GraphQLError path example, and in the interop.md section on loading by ID (around line 111), state that once a nullable or abstract handle has been checked, bound, or matched by `case`, its errors report `path` from the loader (for example ["node", …]) and not from the original chain. Rewritin…
  also at pkg/dang/eval.go:1247, docs/lit/language/errors.md:356, pkg/dang/eval.go:965, docs/lit/language/errors.md:353 · 2/3 votes · fingerprint b0b809d08b3d

Checked and found sound: Equality still compares QueryChain pointers after loading; `!`, `??` and grouped receivers still run the null check; Selections through nullable receivers type as nullable.

Reviewed da1bed3..4e4300a (12 commits, 42 files changed) at STANDARD depth (votes needed: 2 of 2, or 2 of 3 on a split; nit 1 of 1): 4 finders, triage, 15 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: pkg/dang/ast_patterns.go:444 (general: "If an exhaustive `case` covers every member of a union value that came…") into pkg/dang/ast_patterns.go:444: exhaustive case on a mutation union fails at runtime; pkg/dang/eval.go:960 (general: "When a handle is checked and loaded by ID, later failing selections re…"), pkg/dang/eval.go:1247 (design: "After a nullable field's handle escapes and is loaded by ID, server er…") into pkg/dang/eval.go:960: GraphQLError.path starts at the node loader after an ID relo…; .agents/skills/dang-language/reference/graphql.md:64 (general, general-2: "The agent skill references still describe GraphQL access as purely laz…") into .agents/skills/dang-language/reference/graphql.md:64: skill reference still describes GraphQL access as purely laz…; docs/lit/types/interfaces-unions.md:81 (general-2: "For values reached through a mutation, the interfaces page recommends…") into docs/lit/types/interfaces-unions.md:81: recommended inline fragment also re-sends the mutation
Below quorum: pkg/dang/ast_patterns.go:374 (0/1, needed 1)
