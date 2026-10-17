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
vetted:
bug · important · confirmed (reproduced). A probed nullable interface/union
handle ends in an inline fragment on the concrete type but keeps the interface
static type, so multi-type inline fragments on it nest and fail GraphQL
validation; a single non-matching fragment now errors instead of returning
null. eval.go:962, :1287.

### error-path-node
vetted:
bug · important · confirmed. After a probe and reload through node(id:),
GraphQLError.path is ["node", ...] instead of the field path: binding the value
with `let` first changes what e.path says.

### case-binding-equality
vetted:
bug · minor · confirmed. The handle a `case` type arm binds no longer equals the
value it matched (`case (f) { p: Post => p == f }` is false): resolveObject
builds a new node(id:) chain.

### node-load-assumption
vetted:
concern · important · claimed. Loading through node(id:) assumes the server can
load every type implementing node's return type; Relay servers that load a
subset or apply other permissions return null, and later non-null leaves fail
far from the cause. Suggests a fallback or opt-in.

### fragment-null-soundness
vetted:
concern · minor · claimed. "No error means the parent was null" has an exception
(querybuilder.unpack steps over inline fragments). Safe today because every such
fragment follows a __typename check; the soundness argument doesn't mention it.

### nullable-list-inconsistency
vetted:
concern · minor · claimed. A nullable [User] field on an ordinary chain never
compares == null, but one reached through a nullable object can: whether a list
can be null depends on the path.

### node-can-return-abstract
vetted:
bug · minor · claimed. nodeCanReturn accepts any interface or union; when
knowsType fails, resolveObject loads with the abstract type name, which can fail
validation if the union doesn't overlap node's return type.

### selected-through-ast-state
vetted:
concern · minor · claimed. selectedThrough is written onto AST nodes during
Infer and never reset; harmless unless nodes are shared or inferred
concurrently.

### sdk-parity-overstated
vetted:
concern · minor · claimed. The PR goes further than the Dagger Go SDK (probes
more, handles unions, narrows types), so "matches the Dagger SDKs" overstates
it.

### redundant-round-trips
vetted:
cleanup · minor · claimed. Unneeded queries: re-fetching an id already in
KnownID (SelectField("id"), resolveObject), and selecting __typename on every
list element just to learn whether the list is null.

### dead-branch-needs-concrete-type
vetted:
cleanup · minor · claimed. In needsConcreteType, `g.MaybeNull ||` is never true
(mutation chains return early); the comment is misleading.

### docs-interop-laziness
vetted:
docs · minor · confirmed. interop.md's "Laziness" paragraph still says no
request is sent until a value is forced, contradicting the new "Nullable object
fields" section below it.

### docs-skill-graphql-laziness
vetted:
docs · minor · confirmed. The skill's graphql.md:64 still says no request is
sent until a GraphQL value is forced.

### docs-skill-mutation-laziness
vetted:
docs · minor · confirmed. The skill's graphql.md:61 still says mutations follow
the same laziness rules as queries.

### docs-skill-execution-points
vetted:
docs · minor · confirmed. The skill's control-flow.md:135 lists only leaf
fields and .{{ }} as execution points; escaping possibly-null handles are now a
third.
