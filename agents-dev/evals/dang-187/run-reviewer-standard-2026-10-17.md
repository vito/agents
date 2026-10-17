1 important, 1 nit, 1 pre-existing

Reviewed da1bed3..4e4300a (merge base..head): 12 commits, 42 files changed, at STANDARD depth (3 finders; 3 voters per finding, quorum 2).
Sub-agents composed from: dag://?llm=committer/readonly, dag://?llm=contributor/readonly, dag://?expertise=editor/agent, dag://?llm=reviewer/finder, dag://?llm=reviewer/voter

IMPORTANT:
- pkg/dang/ast_expressions.go:1998 — A lazy non-null inline fragment (`... on User!`) on a receiver that comes back null now returns null. Inference types the result as non-null `User!` whatever the receiver's nullability (inferInlineFragments: `if frag.NonNull { resultType = hm.NonNullType{Type: resultType} }`), and the docs say `... on User!` "asserts and unwraps; a mismatch is a runtime error". This early return skips the `frag.NonNull` check in matchLazyInlineFragment, so the assertion never fires. A null gets past a `User!` type: for example, `u: User! = node(id: "nope").{{... on User!}}` binds null to a non-null slot. Before this change, the null __typename bound to "", matched no fragment and raised the assertion error. The new test even pins the unsound result: `assert { node(id: "nope").{{... on User!}} == null }`. The null shortcut should only apply when no fragment is NonNull; otherwise it should raise as before. The list variant (line 2016) has the same problem.
  evidence:
      if typeName == nil {
      		return NullValue{}, nil
      	}
  votes: 3/3 confirmed · correctness (correctness) · fingerprint 9a96cf757b38

NIT:
- .agents/skills/dang-language/reference/graphql.md:64 — This skill reference is now out of date. It still says no GraphQL request is sent until a value is forced. With this change, a nullable object, interface or union field (or anything selected off one) that escapes the chain is checked for null with its own query, e.g. `let m = user(id: "User:2").manager`. `case` on an interface or union handle now also sends a `{ id __typename }` query. The change edits this same file (only the example IDs) and documents the new behaviour in docs/lit/graphql/interop.md and docs/lit/types/interfaces-unions.md. The skill still describes the old behaviour, has no nullable-object-fields section, and still says mutations follow the 'same laziness rules as queries' (line 61). The interop doc now calls mutations an explicit exception. Agents reading the skill will expect `== null`/`??` on such handles to cost nothing and will misjudge how many requests a script sends.
  evidence:
      GraphQL field access is **lazy**. A GraphQL value accumulates a query chain (`.field`, `.{{...}}`, args); no request is sent until the value is **forced** — materialized at an expected-type boundary (assertion, `print`, assignment to a typed field, indexing into a result, etc.).
  votes: 3/3 confirmed · docs (fit) · fingerprint 610f7f4e9ab9

PRE-EXISTING (outside the change's hunks: not this change's doing; GitHub cannot anchor a line comment there):
- .agents/skills/dang-language/reference/control-flow.md:135 — The skill's laziness-warnings section still lists only leaf fields and `.{{ }}` as execution points. The change updates the rescue analysis (classifyField returns gqlLeafField for an escaping nullable object field, or a field on a chain through one) and docs/lit/language/errors.md, but not this skill. So the skill now wrongly tells agents that `user(id: "User:2").manager rescue null` only builds a chain and cannot fire. In fact it executes and is exempt from the warning (see the new 'no warning' cases in tests/warnings/rescue_lazy_result.dang). Line 137's list of exempt tails (`.sync`, `.stdout`, `.{{ }}`) is incomplete in the same way.
  evidence:
      GraphQL failures happen at **execution points** — a leaf field call (scalar/enum underneath, incl. `@expectedType`-mapped fields like Dagger's `sync`) or a `.{{ }}` selection — not where an object-typed chain is built.
  votes: 3/3 confirmed · docs (fit) · fingerprint cc3548cb2d39

Answer every finding: fix it (a re-review marks it FIXED), or resolve(fingerprint:, reason:). To post one on a pull request, pass its path and line to comment(path:, line:).
