2 important

Verdict: Typed number decoding and the new Float/Map arguments work and fit the existing codec path, but Float values don't round-trip cleanly yet. Fix eval.go:863 first, then builtins.go:136.

IMPORTANT:
- pkg/dang/eval.go:863 — Float arguments, which now get through dangValueToGo, are written into the query with `%f`, so they are rounded to six decimal places. `echoFloat(value: 0.1234567)` sends `0.123457`, and `1e-7` is sent as `0.000000`. NaN or Inf becomes `NaN`/`+Inf`, which is not a valid GraphQL literal. The new test uses only 4.5 and 2.5, which survive the rounding.
  worth it: the server gets a different number than the script passed, with no error.
      case FloatValue:
      		return v.Val, nil
  fix: In marshal.go, format floats with `strconv.FormatFloat(v.Float(), 'g', -1, 64)` and return an error for NaN/Inf. Add a test with a value such as 0.1234567 or 1e-7.
  also at tests/test_graphql_float_result_as_float_argument.dang:7, pkg/querybuilder/marshal.go:69 · 2/2 votes · fingerprint 7433e81093b7
- pkg/dang/builtins.go:136 — A Float field that sits under an object nested in an inline fragment is converted with the untyped ToValue. Servers send an integral float such as 4.0 as `4`, so json.Number("4") now becomes an IntValue where the base produced a FloatValue. Dividing it by 3 then gives 1 instead of 1.33. The new ToValue comment says typed GraphQL leaves never reach this code, but this path does.
  worth it: a schema-declared Float can change behavior depending on its runtime value and on how it was selected.
      // Float. Typed GraphQL/codec leaves never reach here; they convert
  fix: In convertNestedSelectionResult, look up each leaf's schema field from the parent type (the unused parentTypeName/fieldName parameters) and call graphQLResultToValue instead of ToValue. Then correct the ToValue comment.
  also at pkg/dang/builtins.go:138, pkg/dang/ast_expressions.go:2026, pkg/dang/ast_operators.go:308 · 2/2 votes · fingerprint e0f18da7efd7

Checked and found sound: Execute/UseNumber decoding handles null or missing data; Int results still accept '1.0' and '1e2'; Map argument keys sorted, so query text is stable.

Reviewed 6e8ca56..338e5fd (2 commits, 7 files changed) at STANDARD depth (votes needed: 2 of 2, or 2 of 3 on a split; nit 1 of 1): 4 finders, triage, 7 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: pkg/dang/eval.go:863 (general, design, general-2: "Float arguments now reach querybuilder's marshaller, which formats flo…") into pkg/dang/eval.go:863: Float arguments are formatted with %f, which rounds them to…; pkg/dang/builtins.go:138 (design: "Some typed GraphQL leaves still go through the untyped ToValue fallbac…"), pkg/dang/builtins.go:136 (general-2: "Typed GraphQL leaves still reach the untyped ToValue fallback.") into pkg/dang/builtins.go:136: Integral Float under a nested inline-fragment selection beco…
Below quorum: pkg/dang/eval.go:869 (1/3, needed 2)
