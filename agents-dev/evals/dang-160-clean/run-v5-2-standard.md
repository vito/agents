1 important, 1 concern, 1 nit

Verdict: The change does what it says: Int results stay exact and Float values can now be passed as arguments. Fix the float formatting behind pkg/dang/eval.go:863 before merging, since Float arguments now hit it.

IMPORTANT:
- pkg/dang/eval.go:863 — Float arguments now reach querybuilder's marshalValue, which formats every float with `%f` (6 decimal places). Precision is silently lost: `echoFloat(value: 0.0000001)` sends `0.000000` and returns 0, and `3.14159265` arrives as `3.141593`. NaN and Inf render as `NaN`/`+Inf`, which are not valid GraphQL literals. The new test only uses 4.5 and 2.5, which survive `%f`.
  worth it: The first Float-argument support quietly sends different numbers than the user wrote.
      case FloatValue:
      		return v.Val, nil
  fix: In marshal.go format floats with `strconv.FormatFloat(f, 'g', -1, 64)` (adding `.0` when integral if wanted), reject NaN/Inf with an error, and add a test like `echoFloat(value: 0.0000001) == 0.0000001`.
  also at tests/test_graphql_float_result_as_float_argument.dang:7, tests/test_graphql_float_result_as_float_argument.dang:6, pkg/querybuilder/marshal.go:69 · 2/2 votes · fingerprint bb03c534fdfb

CONCERN:
- pkg/dang/builtins.go:136 — Untyped result paths still exist and now pick Int vs Float from the number's shape. Scalar fields under a nested selection inside an inline fragment go through convertNestedSelectionResult → ToValue. A schema-Float field whose value is integral (servers send `4`) used to be a FloatValue there and is now an IntValue, so `x / 3` does integer division. The ToValue comment says typed leaves never reach this path; that is not true.
  worth it: Float fields can change runtime type depending on their value.
      // Float. Typed GraphQL/codec leaves never reach here; they convert
  fix: In convertNestedSelectionResult, look up the field's TypeRef on the parent schema type and call graphQLResultToValue as convertInlineFragmentResult does. Correct the ToValue comment.
  also at pkg/dang/builtins.go:138, pkg/dang/ast_expressions.go:2026, pkg/dang/ast_operators.go:308 · 2/2 votes · fingerprint 089223202a15

NIT:
- pkg/dang/eval.go:869 — The new `MapValue` case in `dangValueToGo` looks unreachable. `MapType` only unifies with another `MapType`, and no GraphQL argument type maps to one, so a Map cannot type-check against an input-object or scalar argument as the commit message claims. If it were reached, `marshalValue` writes map keys unquoted, so a key like "a-b" would produce invalid GraphQL.
  fix: Drop the `MapValue` case, or add a .dang test that passes a map to an argument and make `marshalValue` reject keys that are not GraphQL names.
  also at pkg/dang/types.go:224, pkg/querybuilder/marshal.go:147 · 1/1 votes · fingerprint 641b2a69d640

Checked and found sound: Raw data is captured and decoded with UseNumber; Typed binds like string ids aren't affected by UseNumber; Null or empty data still gives a nil response.

Reviewed 6e8ca56..338e5fd (2 commits, 7 files changed) at STANDARD depth (votes needed: 2 of 2, or 2 of 3 on a split; nit 1 of 1): 4 finders, triage, 6 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: pkg/dang/eval.go:863 (behavior, design, general-2: "Float arguments now reach `marshalValue`, which formats them with `%f`…") into pkg/dang/eval.go:863: %f float formatting in marshalValue loses precision; pkg/dang/builtins.go:136 (general-2: "Leaf fields under a nested selection inside an inline fragment still g…"), pkg/dang/builtins.go:138 (behavior: "Leaves of a nested selection inside an inline fragment still go throug…") into pkg/dang/builtins.go:136: inline-fragment nested leaves use untyped ToValue, so integr…
Below quorum: pkg/dang/eval.go:825 (0/1, needed 1)
