1 important, 3 concerns, 3 nits

Verdict: The change does what it sets out to do: null checks work and `case` matches GraphQL handles by concrete type, and it fits the lazy selection model. Fix ast_expressions.go:1998 first, then ast_patterns.go:444.

IMPORTANT:
- pkg/dang/ast_expressions.go:1998 — On a null receiver, the non-null lazy fragment `node(id: "nope").{{... on User!}}` now evaluates to null even though its type is `User!`. At the merge base it raised the documented assertion error. The null then fails somewhere unrelated, for example `"hi " + u.name` gives "addition not supported for types dang.StringValue and dang.NullValue".
  worth it: brings back the #186 symptom (a null surfacing as an unrelated error) for `!` assertions
      if typeName == nil {
      		return NullValue{}, nil
      	}
  fix: In evalGraphQLLazyInlineFragments, when typeName is nil and any fragment is NonNull, return the type-assertion error ('expected one of User, got null'). Otherwise return null. Update the test at test_graphql_nullable_object.dang:109.
  also at pkg/dang/ast_expressions.go:1635, docs/lit/graphql/interop.md:72, tests/test_graphql_nullable_object.dang:109 · 2/2 votes · fingerprint fcc69bdaac15

CONCERN:
- pkg/dang/ast_patterns.go:444 — A `case` on a non-null union returned by a mutation that names every member type, with no `else`, passes type checking as exhaustive. At runtime the handle is never resolved, so no arm matches. It then fails with the internal error `exhaustive case did not match the value: gql:Value:Result.create`. The new docs say such values fall through to interface patterns or `else`, but an exhaustive union case needs no `else`.
  worth it: Mutations that return a union of result types are a common GraphQL pattern.
      if g.IsMutation || !g.isAbstract() {
      		return false
  fix: In Case.Eval, when the operand is an unresolved IsMutation abstract handle and c.exhaustive is set, raise a clear error pointing to `.{{... on T}}`. Mention this case in interfaces-unions.md.
  also at pkg/dang/ast_patterns.go:420, docs/lit/types/interfaces-unions.md:81 · 2/2 votes · fingerprint f210ed1fdec9
- pkg/dang/eval.go:965 — Once a nullable handle escapes and is loaded by ID, server errors carry the loader's path, not the user's. `let u = user(id: "User:1"); u.alwaysFails rescue {e: GraphQLError => e.path}` now gives `["node","alwaysFails"]`, while the inline form still gives `["user","alwaysFails"]`. At the merge base both gave the `user` path.
  worth it: errors.md presents `path` as the way to inspect failures; it now depends on `let`
      Name:     loader.Name,
  fix: Document in errors.md and #nullable-object-fields that errors on loaded handles report the loader's path (`node`/`load<T>FromID`). Or prepend the original field path when wrapping GraphQLError for loaded handles.
  also at pkg/dang/eval.go:1247, docs/lit/language/errors.md:352 · 2/2 votes · fingerprint 2a3d0433e216
- docs/lit/types/interfaces-unions.md:81 — For mutation handles, the docs say to narrow with `.{{... on Post}}` instead of `case`, since asking would re-send the mutation. The lazy fragment also asks: it queries `__typename` off the mutation chain, then re-sends the mutation for each field. `touched.{{... on Post!}}.title` sent `touchNode` twice.
  worth it: the recommended workaround costs more mutation sends than the thing it replaces
      Narrow it with an inline fragment (`.{{... on Post}}`) instead
  fix: In interfaces-unions.md, recommend a fragment with a field block (`.{{... on Post {{ title }} }}`, one request), or state that the lazy form re-sends the mutation too.
  also at pkg/dang/ast_expressions.go:1994, tests/test_graphql_abstract_case.dang:75 · 2/2 votes · fingerprint 4acbf837fb4e

NIT:
- tests/nullable_object_test.go:170 — Selecting `.id` on a handle that was just loaded by ID sends another query, `node(id:"User:1"){... on User{id}}`, even though `KnownID` already holds the value. The new test locks this extra round trip in. Every checked handle now has a known ID, so this happens far more often than before.
  fix: In GraphQLValue.SelectField/GraphQLFunction.Call, when the field is the type's loadable `id` (loadableIDField) and KnownID is set, return it without querying. Update nullable_object_test.go:170.
  also at pkg/dang/eval.go:402 · 1/1 votes · fingerprint b8cc4a108d5d
- .agents/skills/dang-language/reference/graphql.md:64 — The agent skill reference was edited (only to rename IDs) but still says no request is sent until a value is forced, and that mutations follow the same laziness rules as queries. It never mentions the null probe on escape, load-by-ID, or `case` sending a query. The interop page's Laziness blockquote, right above the new section, still makes the same unqualified claim.
  fix: Add short bullets to .agents/skills/dang-language/reference/graphql.md (Mutations, Laziness) and to the interop.md blockquote covering the nullable-field probe, load-by-ID, `case` resolution and the mutation exception.
  also at docs/lit/graphql/interop.md:95, .agents/skills/dang-language/reference/graphql.md:61 · 1/1 votes · fingerprint 6d345e3205e4
- pkg/dang/rescue_analysis.go:294 — chainMayBeNull treats any bare Symbol receiver as a call to the root Query field of the same name. A function parameter `user: User!` therefore counts as a nullable `user(...)` root call, and `user.posts rescue null` loses its "this rescue can never fire" warning. The same code with the parameter named `someone` still warns.
  fix: In chainMayBeNull and rootFieldMayBeNull, only apply root-field nullability when the Symbol resolved to the import's root function (record that at Infer), not to a local of the same name. Then update the classifyGQLSymbol comment.
  also at pkg/dang/rescue_analysis.go:268 · 1/1 votes · fingerprint 40f104fa10a3

Checked and found sound: selected-through flag doesn't leak into argument expressions; ID loads refuse String ids and mismatched ID types; equality stays chain-based after probe and load.

Reviewed da1bed3..4e4300a (12 commits, 42 files changed) at STANDARD depth (votes needed: 2 of 2, or 2 of 3 on a split; nit 1 of 1): 4 finders, triage, 16 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: pkg/dang/eval.go:1247 (general: "`GraphQLError.path` now depends on how the handle was reached. `user(i…") into pkg/dang/eval.go:965: GraphQLError.path becomes node path after handle is reloaded…; .agents/skills/dang-language/reference/graphql.md:64 (general, behavior, general-2: "The agent skill's GraphQL reference still says no request is sent unti…") into .agents/skills/dang-language/reference/graphql.md:64: agent skill GraphQL reference still claims full laziness and…; docs/lit/types/interfaces-unions.md:81 (general-2: "The docs say `case` won't resolve a handle reached through a mutation…") into docs/lit/types/interfaces-unions.md:81: documented lazy-fragment workaround for mutation handles als…
Below quorum: pkg/dang/ast_patterns.go:444 (0/2, needed 2), pkg/dang/ast_patterns.go:398 (0/2, needed 2), pkg/dang/ast_patterns.go:374 (0/1, needed 1)
