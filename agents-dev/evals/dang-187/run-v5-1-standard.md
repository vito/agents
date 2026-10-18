3 concerns, 1 nit

Verdict: The change does what it sets out to: nullable fields now compare to null, and `case` matches concrete types, consistent with the existing laziness model. Fix pkg/dang/ast_patterns.go:398 first, and decide whether the error-path change at eval.go:1247 is intended.

CONCERN:
- pkg/dang/ast_patterns.go:398 — When `case` has to resolve an abstract handle, every type arm binds the newly loaded handle. That includes an interface arm that already matched the original handle. So `case (f) { u: User => …; n: Node => n == f }` now gives false. With `n: Node` as the first arm it gives true, and at the merge base it was true either way.
  worth it: Handle identity in an arm now depends on which arms come earlier.
      childScope.Bind(clause.Binding, typedVal, PrivateVisibility)
  fix: In Case.Eval, bind `exprVal` when `matchesType(exprVal, pattern)` already holds, and bind `typedVal` only for arms that need the concrete type. Add a test for `n == f` with a concrete arm first.
  also at pkg/dang/ast_patterns.go:374 · 2/2 votes · fingerprint 8c06c4330ae7
- pkg/dang/eval.go:1247 — Binding a nullable object to a variable now changes what errors report. With `let u = user(id: "User:1")`, a failure in `u.alwaysFails` gives `GraphQLError.path` `["node","alwaysFails"]`. Written inline, `user(id: "User:1").alwaysFails` still gives `["user","alwaysFails"]`. Before this change both gave the `user` path. Is that intended?
  worth it: errors.md says `path` lets code inspect failures, and that no longer holds for bound handles
      loaded, err := loadObjectFromTypedID(id, idType, typeName, g.Schema, g.TypeScope, g.Client)
  fix: In interop.md#nullable-object-fields and next to the GraphQLError path example in errors.md, document that errors from a checked handle report the loader's path (`node`/`load<T>FromID`). Or keep the original chain for error paths.
  also at pkg/dang/eval.go:965, docs/lit/language/errors.md:352 · 2/2 votes · fingerprint 938a4c001b25
- docs/lit/graphql/interop.md:121 — A checked handle remembers its `id` (KnownID), but selecting `.id` on it still sends a query through the loader. The docs' own idiom `a.id == b.id` on two checked handles sends 4 requests: two checks that already fetched `id`, then two `node(id:){... on User{id}}` queries for values the client already has.
  worth it: `a.id == b.id` is the documented idiom and now costs twice the requests it needs
      - to ask whether two objects are the *same server entity*, compare an identifying field explicitly — `a.id == b.id` — which forces the necessary fetch where you can see it, instead of hiding I/O inside `==`
  fix: Carry KnownID from GraphQLValue.SelectField into GraphQLFunction. In Call, when the field is the type's loadable `id` and KnownID is set, return it without executing. Update the pinned query in nullable_object_test.go.
  also at pkg/dang/eval.go:247 · 2/2 votes · fingerprint 249114c90cc6
Also raised, past the 3 strongest concerns:
- pkg/dang/ast_patterns.go:444 — A non-null union returned by a mutation, matched with one pattern per member and no `else`, still type-checks as exhaustive. (2/2 votes)
- docs/lit/types/interfaces-unions.md:81 — For a value reached through a mutation, the new docs say to narrow with a lazy inline fragment because `case` asking would re-send the mutation. (2/2 votes)

NIT:
- .agents/skills/dang-language/reference/graphql.md:64 — The agent skill reference, which this change edits, still says no GraphQL request is sent until a value is forced, and that mutations follow the same laziness rules. It says nothing about the null check on escape, loading by ID, or the query `case` now sends. The Laziness note in interop.md just above the new section makes the same unqualified claim.
  fix: In graphql.md, add a short "Nullable object fields" bullet list: escape check, ID load, `case` query, mutation exception. Qualify the Laziness paragraphs there and at interop.md:95 with a link to #nullable-object-fields.
  also at docs/lit/graphql/interop.md:95, .agents/skills/dang-language/reference/graphql.md:61 · 1/1 votes · fingerprint ef47240a5bb5

Checked and found sound: Selected-through flag never reaches argument or receiver expressions; `!`, `??` and argument operands still get the null check; Lists through a null field return null cleanly.

Reviewed da1bed3..4e4300a (12 commits, 42 files changed) at STANDARD depth (votes needed: 2 of 2, or 2 of 3 on a split; nit 1 of 1): 4 finders, triage, 13 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: .agents/skills/dang-language/reference/graphql.md:64 (behavior, general-2: "The agent skill's GraphQL reference still says no request is sent unti…"), docs/lit/graphql/interop.md:95 (design: "Two laziness statements were left unchanged and now contradict the new…") into .agents/skills/dang-language/reference/graphql.md:64: laziness docs (skill reference and interop.md) still say no…
Below quorum: pkg/dang/ast_expressions.go:1998 (0/2, needed 2)
