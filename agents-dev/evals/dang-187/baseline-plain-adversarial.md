I reviewed vito/dang#187 at 4e4300a. The core fix is right: convertGraphQLResultToModule now returns null for a nil result, and the "check only when a value leaves the chain" approach holds up. The main claim also checks out: the Dagger Go SDK (object.go.tmpl, IsNullableObject) does fetch id eagerly for nullable object and interface fields and loads them through node(id:).

The weak spots are in the load-by-ID step and the new case behaviour. I confirmed the first two findings below with a throwaway test against the test server, then deleted it. Nothing was committed or posted to the PR.

## Behaviour changes worth questioning

1. Errors point at node, not the field path (confirmed).
   - user(id:"User:2").manager.alwaysFails rescue { e: GraphQLError => e.path } gives ["user","manager","alwaysFails"].
   - Writing let m = user(id:"User:2").manager first and then m!.alwaysFails gives ["node","alwaysFails"].
   - So whether a value went through a let decides what GraphQLError.path says, and error messages lose the user's own path. docs/lit/language/errors.md presents e.path as the way to inspect failures without parsing text, so this undercuts it. The behaviour should at least be documented, and ideally errors would be mapped back to the original path.
2. The handle bound by case no longer equals the value it matched (confirmed). With let f = favoriteNode, case (f) { p: Post => p == f } returns false. Equality compares QueryChain pointers, and resolveObject builds a new node(id:) chain. Before this PR, a type arm's binding was the operand itself. The docs say value patterns compare against the original handle, but they don't mention that the binding is a different object.
3. Loading through node(id:) relies on the server's claim that it can load every type in the schema.
   - nodeCanReturn only checks that the type implements node's return type. Some Relay servers only handle a subset of types in node. Others resolve it under different permission rules than the original path.
   - When node returns null, every later non-null leaf fails with null is not allowed for String. The error is far from the cause, and the code worked before the PR because the original chain was kept.
   - The test server was rewritten to use globally unique "User:1"-style IDs, so the tests are built around this assumption. Consider falling back to the original chain when the loaded handle comes back null, or making load-by-ID opt-in for schemas that aren't Dagger.
4. The "no error means the parent was null" rule has an exception. querybuilder.unpack steps over inline fragments, so a non-null leaf under a fragment that doesn't match comes back nil with no error. Today every fragment on a MaybeNull chain is preceded by a __typename check, so this is safe for now. But the soundness argument in GraphQLFunction.Call doesn't mention fragments, and a stale or wrong __typename would quietly become null.
5. Nullable lists still can't be null, depending on how you reach them. isNullableObjectType excludes lists, so a [User] field on an ordinary chain never compares == null. Yet user(id:"User:1").manager.posts.posts == null is true, because that list inherits MaybeNull. The PR closes this gap only for lists reached through a nullable object, so behaviour depends on the path.

## Smaller issues

6. Unneeded round trips.
   - In the "probes argument expressions" test, the second query is node(id:"User:1"){... on User{id}}: it asks for an id the handle already has in KnownID. SelectField("id") could return KnownID directly.
   - resolveObject re-fetches id for handles that already have KnownID, such as @expectedType loads like favoriteNodeID used in a case.
   - The list check selects __typename on every element just to find out whether the list is null.
7. Dead branch in needsConcreteType. A MaybeNull handle can only leave the chain unchecked on a mutation chain, and those return early on g.IsMutation. So g.MaybeNull || is never true, and the comment about it is misleading.
8. nodeCanReturn accepts any interface or union type unconditionally. When knowsType fails (the concrete type isn't in the type scope), resolveObject loads with the abstract g.TypeName. That can produce node(id:){... on SomeUnion}, which fails GraphQL validation if the union doesn't overlap node's return type.
9. selectedThrough is written onto AST nodes during Infer and never reset. It's harmless as long as nodes aren't shared between positions or inferred concurrently, but correctness at runtime now depends on inference having run on that exact node. A node synthesized at eval time that misses the flag gets an extra check (safe), and nothing enforces the opposite case.
10. The docs now contradict each other. The "Laziness" paragraph in interop.md still says no request is sent until a value is forced. The new "Nullable object fields" section right below it describes checks that send requests when a value is bound with let, passed as an argument, compared, and so on.
11. This goes further than the Go SDK. The Go SDK checks only nullable fields, fetches only id, and keeps the declared interface type. This PR also checks non-null fields selected off an unchecked nullable field, handles unions, and narrows to the concrete type, which costs an extra query in case on non-null abstract types. That's reasonable, but "this matches the Dagger SDKs" overstates the match.

## Checked and found sound

- Static rescue classification matches runtime behaviour, including (x ?? y).f and x!.f.
- Union checks use per-member ... on T { id } fragments that only select ids of one shared type, which avoids GraphQL's field-merge conflicts.
- No mutation is sent twice; the mutation test enforces this.
- An argument evaluated inside a chain that's being selected through is still checked.
- CI is green on this branch.
