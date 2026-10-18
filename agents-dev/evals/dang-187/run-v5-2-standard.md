3 important, 2 nits, 1 decision to record

Verdict: The change makes nullable GraphQL object fields compare equal to null and makes `case` match interface and union values by their concrete type, and it fits the loader design. Fix eval.go:962, ast_patterns.go:444 and ast_expressions.go:1998 first.

IMPORTANT:
- pkg/dang/eval.go:962 — A checked nullable interface field (or a `case` arm bound by an interface pattern) has a chain already narrowed with `... on User`, but it keeps its static type `Node`. A multi-fragment selection on it then sends `... on Post` inside `... on User`, and the server rejects that. Example: `let n = node(id: "User:1")` followed by `n.{{ ... on User {{name}} ... on Post {{title}} }}`.
  worth it: This breaks the fragment pattern the new docs recommend for reading fields, and it worked before.
      chain = chain.InlineFragment(typeName)
  fix: In evalGraphQLInlineFragments, when gqlVal.TypeName is a concrete object, leave out fragments it can't match (not the same type, not an interface it implements). Add this case to test_graphql_nullable_object.dang.
  also at pkg/dang/eval.go:1287, pkg/dang/ast_patterns.go:398, pkg/dang/ast_expressions.go:1958 · 2/2 votes · fingerprint 535a53690240
- pkg/dang/ast_patterns.go:444 — Take a `case` on a union returned by a mutation that lists every member and has no `else`. The type checker accepts it as exhaustive. At runtime the mutation handle is never resolved, so no arm matches and the case fails with "exhaustive case did not match the value", which the code labels a compiler bug.
  worth it: Union payloads on mutations are common, and users get a misleading internal-error message.
      if g.IsMutation || !g.isAbstract() {
  fix: In Case.Eval, when an unresolved abstract mutation handle reaches the exhaustive fallthrough, raise a user-facing error that suggests `.{{... on T}}`. Or reject concrete type patterns on mutation-rooted operands at infer time.
  also at pkg/dang/ast_patterns.go:420, docs/lit/types/interfaces-unions.md:81, docs/lit/types/interfaces-unions.md:106 · 2/2 votes · fingerprint d948853ca405
- pkg/dang/ast_expressions.go:1998 — When the receiver is null, the non-null lazy fragment `... on User!` now evaluates to null instead of raising. The expression is still typed `User!`, so `node(id: "nope").{{... on User!}}.name` gives null for a `String!`. The null is only caught later, at a typed boundary, with the vaguer message "null is not allowed for Test.User!".
  worth it: A non-null assertion now passes null through and breaks the type checker's `User!` guarantee.
      if typeName == nil {
      		return NullValue{}, nil
      	}
  fix: In evalGraphQLLazyInlineFragments, when typeName is nil and any fragment is NonNull, return the assertion error (as matchLazyInlineFragment does). Change the test `node(id: "nope").{{... on User!}} == null` to expect a raise.
  also at pkg/dang/ast_expressions.go:1635, tests/test_graphql_nullable_object.dang:109, docs/lit/graphql/interop.md:72 · 2/2 votes · fingerprint 3c6c01a88c7a

NIT:
- .agents/skills/dang-language/reference/graphql.md:64 — The agent skill reference still says GraphQL field access sends no request until the value is forced, and that mutations follow the same laziness rules as queries. This change edited that file but left those parts out of date. A nullable object handle that escapes now sends a query, `case` on an interface or union value sends one, and mutation chains are exempt. The interop page's "Laziness:" note likewise says nothing about these exceptions.
  fix: In graphql.md's "Laziness / forcing" and "Mutations" sections, add the nullable-escape check, the `case` resolution query and the mutation exemption. Point the interop.md Laziness note to #nullable-object-fields.
  also at docs/lit/graphql/interop.md:95, .agents/skills/dang-language/reference/graphql.md:61, .agents/skills/dang-language/reference/control-flow.md:137 · 1/1 votes · fingerprint 85a1a1f41eb4
- docs/lit/index.md:38 — The landing-page demo echoes every query it sends. `let u = user("User:1")` now first sends a `{id __typename}` check, and each scalar read then goes through `node(id:"User:1"){... on User{…}}`. The comment above the demo only says "fields that return scalars query on access", so readers see unexplained queries.
  fix: In docs/lit/index.md use the non-null `primaryUser`, which stays lazy, or reword the comment to mention the null check and the load by ID.
  also at docs/lit/index.md:40 · 1/1 votes · fingerprint 104e70af6a75

DECISIONS TO RECORD (defensible choices, not defects):
- pkg/dang/eval.go:960 — A checked handle (one bound with `let`, passed along, or bound by a `case` arm) now reports server errors with the loader's path, not the chain the user wrote. `let u = user(id: "User:1"); u.alwaysFails rescue { e: GraphQLError => e.path }` now gives `["node", "alwaysFails"]` instead of `["user", "alwaysFails"]`, and the manager chain loses `["user","manager"]`. Is this intended, given errors.md presents `path` as the way to inspect failures?
  record: Add a note to errors.md's GraphQLError section (and interop's nullable-fields section) that the `path` of a checked or case-bound handle starts at `node`/`load<T>FromID`, and pin it with a test next to the existing path assertions.
  also at pkg/dang/eval.go:1247, docs/lit/language/errors.md:356 · 2/2 votes · fingerprint 35ec3ffaab60

Checked and found sound: Probes load only by ID! or non-null custom-scalar ids; Rescue analysis matches runtime probes for escaping fields; Loaded handles stay distinct under equality.

Reviewed da1bed3..4e4300a (12 commits, 42 files changed) at STANDARD depth (votes needed: 2 of 2, or 2 of 3 on a split; nit 1 of 1): 4 finders, triage, 10 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: pkg/dang/eval.go:962 (general: "When a nullable interface or union handle is checked, it is narrowed t…") into pkg/dang/eval.go:962: A checked abstract handle's chain is already narrowed with `…; .agents/skills/dang-language/reference/graphql.md:64 (general, design, general-2: "The agent skill references still say no request is sent until a value…") into .agents/skills/dang-language/reference/graphql.md:64: Laziness docs still say no request is sent until a value is…
