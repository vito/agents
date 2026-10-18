2 important

Verdict: The change mostly does what it sets out to do and fits the existing codec path. Two confirmed bugs need fixing before merge: start with eval.go:863, then builtins.go:138.

IMPORTANT:
- pkg/dang/eval.go:863 — A FloatValue argument is now sent through querybuilder's `%f` formatting, which keeps only 6 decimal places. So `echoFloat(value: 3.14159265)` sends `3.141593`, and `1e-7` is sent as `0.000000`. A Float result passed back as an argument only round-trips when it has 6 or fewer decimals. The test's 4.5 and 2.5 hide this.
  worth it: The promised Float round-trip quietly changes values like coordinates and probabilities.
      case FloatValue:
      		return v.Val, nil
  fix: In marshal.go, format floats with strconv.FormatFloat(f, 'g', -1, 64) and return an error for NaN/Inf. Add a high-precision case such as 3.14159265 to the new .dang test.
  also at tests/test_graphql_float_result_as_float_argument.dang:7, pkg/querybuilder/marshal.go:69 · 2/2 votes · fingerprint b4998452ec43
- pkg/dang/builtins.go:138 — Inside an inline fragment, scalar fields of a nested selection are still converted with untyped ToValue. Servers write a whole-valued Float like 3.0 as `3` (gqlgen uses `%g`). That now becomes an IntValue even though the type checker says Float!, so `rating / 2` does integer division and returns 1 instead of 1.5. Before this change it was float64, which gave FloatValue and the correct result.
  worth it: The comment says typed leaves never reach the fallback. This path does, and Float math gives wrong answers there.
      if i, err := val.Int64(); err == nil && int64(int(i)) == i {
  fix: In convertNestedSelectionResult, look up the schema field and call graphQLResultToValue with its typeRef instead of ToValue. Add a whole-valued Float field under a fragment's nested selection to the test server.
  also at pkg/dang/builtins.go:136, pkg/dang/ast_expressions.go:2026, pkg/dang/ast_operators.go:308 · 2/2 votes · fingerprint 48f7c8ae94d7

Checked and found sound: Raw `data` capture handles null and empty data; Typed binds keep json.Number through unpack's re-marshal; No float64 assertions on GraphQL results remain.

Reviewed 6e8ca56..338e5fd (2 commits, 7 files changed) at STANDARD depth (votes needed: 2 of 2, or 2 of 3 on a split; nit 1 of 1): 4 finders, triage, 6 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: pkg/dang/eval.go:863 (general, design, general-2: "Float arguments are now accepted, but the querybuilder writes them wit…") into pkg/dang/eval.go:863: querybuilder %f float formatting truncates to six decimals; pkg/dang/builtins.go:138 (general: "Leaf fields under a nested selection inside an inline fragment still c…"), pkg/dang/builtins.go:136 (behavior, general-2: "Leaf fields inside a nested selection in an inline fragment still go t…") into pkg/dang/builtins.go:138: inline-fragment nested leaves via untyped ToValue turn whole…; pkg/dang/eval.go:869 (general: "The briefing says the new `MapValue` case lets a map feed an input obj…") into pkg/dang/eval.go:870: MapValue keys written unescaped as GraphQL field names
Below quorum: pkg/dang/eval.go:870 (0/2, needed 2)
