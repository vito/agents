2 important

Verdict: Mostly does what it sets out to do: Int results stay exact, and Float values can now be passed as arguments. Fix the six-decimal truncation at pkg/dang/eval.go:863 and the Float-to-Int regression at pkg/dang/builtins.go:138 before merging.

IMPORTANT:
- pkg/dang/eval.go:863 — Float arguments are now sent through querybuilder's `fmt.Sprintf("%f", ...)`, which keeps only six decimal places. So `echoFloat(value: 1.23456789)` sends `1.234568`, and `0.0000001` sends `0.000000`. The new test only uses 4.5 and 2.5, which survive the rounding, so it passes.
  worth it: the new Float round-trip silently changes values that have more than six decimals
      case FloatValue:
      		return v.Val, nil
  fix: In marshal.go Float32/Float64 use `strconv.FormatFloat(v.Float(), 'g', -1, 64)`, reject NaN/Inf with an error, and add a test like `echoFloat(value: 1.23456789) == 1.23456789`.
  also at tests/test_graphql_float_result_as_float_argument.dang:7, pkg/dang/eval.go:864, pkg/querybuilder/marshal.go:69 · 2/2 votes · fingerprint 7179e89b7900
- pkg/dang/builtins.go:138 — Leaf fields of nested selections inside inline fragments still go through untyped ToValue. gqlgen writes Float 4.0 as `4` (`%g`), so the new json.Number case turns it into IntValue under a Float-typed field. Before, it came back as FloatValue. Then `score / 8` does integer division (0 instead of 0.5).
  worth it: Float fields with integral values now give wrong arithmetic results
      if i, err := val.Int64(); err == nil && int64(int(i)) == i {
      			return IntValue{Val: int(i)}, nil
  fix: In convertNestedSelectionResult, look up the leaf's schema field (as convertInlineFragmentResult does) and call graphQLResultToValue with its TypeRef instead of ToValue. Add an inline-fragment nested Float test.
  also at pkg/dang/builtins.go:136, pkg/dang/eval.go:820, pkg/dang/ast_expressions.go:2026, pkg/dang/ast_operators.go:308 · 2/2 votes · fingerprint 3b1d04a04657

Checked and found sound: UseNumber only changes interface{} binds; typed binds unaffected; null or empty data payload still decodes to nil; codec and typed Int converters share decodedNumberToInt.

Reviewed 6e8ca56..338e5fd (2 commits, 7 files changed) at STANDARD depth (votes needed: 2 of 2, or 2 of 3 on a split; nit 1 of 1): 4 finders, triage, 6 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: pkg/dang/eval.go:863 (general, general-2: "Float arguments now reach MarshalGQL, which formats floats with `%f` (…"), pkg/dang/eval.go:864 (design: "Float arguments are now serialized by querybuilder's `%f` formatter, w…") into pkg/dang/eval.go:863: querybuilder's %f formatting cuts Float arguments to six dec…; pkg/dang/builtins.go:136 (behavior, design, general-2: "Leaf fields of a nested selection inside an inline fragment still go t…") into pkg/dang/builtins.go:138: inline-fragment nested leaves go through untyped ToValue, so…; pkg/dang/eval.go:869 (design: "The new MapValue branch has no test, and I found no GraphQL input type…") into pkg/dang/eval.go:869: untested, possibly unreachable MapValue branch; marshaller w…
Below quorum: pkg/dang/eval.go:869 (0/2, needed 2)
