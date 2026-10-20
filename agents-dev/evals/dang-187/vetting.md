# Vetting dang-187's known issues

The issues in case.json were compiled from two unvetted reviews. Mark each one
after its `vetted:`:

- `real`: worth raising on this PR (a guardrail, design guidance, or a quick
  fix you would take);
- `dismiss`: not worth the time (speculative, already safe, no payoff).

Leave it blank if unsure. The scorer reads this file: vetted-real issues get
their own recall line, and a review finding that matches a dismissed issue
counts as a speed bump. A non-blank value here overrides a null `vetted` in
case.json (and must agree with a non-null one).

### fragment-nesting
vetted: real
bug · important · confirmed (reproduced). A probed nullable interface/union
handle ends in an inline fragment on the concrete type but keeps the interface
static type, so multi-type inline fragments on it nest and fail GraphQL
validation; a single non-matching fragment now errors instead of returning
null. eval.go:962, :1287.

### error-path-node
vetted: dismiss
bug · important · confirmed. After a probe and reload through node(id:),
GraphQLError.path is ["node", ...] instead of the field path: binding the value
with `let` first changes what e.path says. Author: users aren't expected to
inspect error paths programmatically; not worth bending over backwards for. A
product decision a reviewer couldn't deduce unless it were recorded.

### case-binding-equality
vetted: dismiss
bug · minor · confirmed. The handle a `case` type arm binds no longer equals the
value it matched (`case (f) { p: Post => p == f }` is false): resolveObject
builds a new node(id:) chain. Author: equality isn't really defined for GraphQL
objects.

### node-load-assumption
vetted: dismiss
concern · important · claimed. Loading through node(id:) assumes the server can
load every type implementing node's return type; Relay servers that load a
subset or apply other permissions return null, and later non-null leaves fail
far from the cause. Suggests a fallback or opt-in. Author: start simple and
handle such servers when they come, unless it's provably a one-way door.

### fragment-null-soundness
vetted: real
concern · minor · claimed. "No error means the parent was null" has an exception
(querybuilder.unpack steps over inline fragments). Safe today because every such
fragment follows a __typename check; the soundness argument doesn't mention it.
Author: real, maybe; it would need a suggested fix to judge whether it's a
design issue or an easy gap to cover.

### nullable-list-inconsistency
vetted: real
concern · minor · claimed. A nullable [User] field on an ordinary chain never
compares == null, but one reached through a nullable object can: whether a list
can be null depends on the path. Author: likely fix is recursing into a trivial
(__typename and/or id) sub-selection so the probe can be queried; a suggested
fix would have made this easier to judge.

### node-can-return-abstract
vetted: real
bug · minor · claimed. nodeCanReturn accepts any interface or union; when
knowsType fails, resolveObject loads with the abstract type name, which can fail
validation if the union doesn't overlap node's return type. Author: real, I
guess; is the fix to check it's a possible type during type checking?

### selected-through-ast-state
vetted: dismiss
concern · minor · claimed. selectedThrough is written onto AST nodes during
Infer and never reset; harmless unless nodes are shared or inferred
concurrently. Author: dismiss, not entirely sure; there's likely precedent for
inference state on AST nodes.

### sdk-parity-overstated
vetted: real
concern · minor · claimed. The PR goes further than the Dagger Go SDK (probes
more, handles unions, narrows types), so "matches the Dagger SDKs" overstates
it. Author: real but minor; just don't claim parity.

### redundant-round-trips
vetted: real
cleanup · minor · claimed. Unneeded queries: re-fetching an id already in
KnownID (SelectField("id"), resolveObject), and selecting __typename on every
list element just to learn whether the list is null.

### dead-branch-needs-concrete-type
vetted: real
cleanup · minor · claimed. In needsConcreteType, `g.MaybeNull ||` is never true
(mutation chains return early); the comment is misleading.

### docs-interop-laziness
vetted: real
docs · minor · confirmed. interop.md's "Laziness" paragraph still says no
request is sent until a value is forced, contradicting the new "Nullable object
fields" section below it.

### docs-skill-graphql-laziness
vetted: real
docs · minor · confirmed. The skill's graphql.md:64 still says no request is
sent until a GraphQL value is forced.

### docs-skill-mutation-laziness
vetted: real
docs · minor · confirmed. The skill's graphql.md:61 still says mutations follow
the same laziness rules as queries.

### docs-skill-execution-points
vetted: real
docs · minor · confirmed. The skill's control-flow.md:135 lists only leaf
fields and .{{ }} as execution points; escaping possibly-null handles are now a
third.

### qualified-root-rescue
vetted: real
bug · minor · claimed. The rescue analysis misses nullable root fields reached
through the schema's module name: `Test.maybeUser(...) rescue null` still warns
that the rescue guards nothing, though it is probed inside it; the unqualified
form doesn't warn. rescue_analysis.go:564, :303. Author: real, a consistency
gap the PR left in the rescue analysis update.

### mutation-union-case-fails
vetted:
bug · important · claimed. A `case` over a mutation-returned union with one
arm per member and no `else` type-checks as exhaustive, but mutation handles
are never resolved (that would re-send the mutation), so no arm matches and it
fails at runtime with the internal "exhaustive case did not match the value".
ast_patterns.go:444, :420; interfaces-unions.md:81. Found by every v5 run.

### nonnull-fragment-on-null
vetted:
bug · important · claimed. `node(id: "nope").{{... on User!}}` now gives null
typed `User!` instead of raising the assertion error it raised at the merge
base; the change's test at test_graphql_nullable_object.dang:109 asserts the
null. ast_expressions.go:1998. Found by v5 runs 2 and 3.

## Sound items

Things the same two reviews checked and found correct. Mark each one after its
`vetted:`:

- `sound`: it holds, so a finding that says it is broken counts as false;
- `dismiss`: it does not hold (or is no trap), so such a finding is judged on
  its own value.

Left blank, a finding that contradicts it is reported as a sound
contradiction and keeps the judge's value, unless the judge rated it false or a
speed bump.

### null-result-fix
vetted: sound
convertGraphQLResultToModule returning null for a nil result is correct, and
probing only when a value leaves the chain holds up.

### rescue-classification
vetted: sound
Static rescue classification matches runtime behaviour, including (x ?? y).f
and x!.f. (The qualified `Module.field` form is a separate, real gap:
qualified-root-rescue.)

### union-id-fragments
vetted: sound
Union probes use per-member `... on T { id }` fragments selecting ids of one
shared type, avoiding field-merge conflicts.

### mutation-sent-once
vetted:
No mutation is sent twice; the mutation test enforces it. (Two live reviewer
runs recorded `touched.{{... on Post!}}.title` on a mutation result sending the
mutation twice: first `{touchNode{__typename}}`, then the fragment.)

### args-in-selected-chain
vetted: sound
An argument evaluated inside a chain that is being selected through is still
probed.
