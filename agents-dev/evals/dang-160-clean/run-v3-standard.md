2 important

Verdict: The change gets Int results decoded as Int and Float/Map values passed as arguments, and it fits the existing codec path. Before merging, fix the 6-decimal Float formatting behind eval.go:863 and the untyped nested-fragment leaves at builtins.go:136.

IMPORTANT:
- pkg/dang/eval.go:863 — Float arguments go through querybuilder's `%f` formatting, which keeps only 6 decimal places. So `echoFloat(value: 0.1234567)` sends `0.123457`, and `1e-7` is sent as `0.000000`. The Float round trip this change enables only holds for values with at most 6 decimals. Not run; this follows from Go's default `%f` precision.
  worth it: Float arguments silently lose precision; the new test values hide it.
      case FloatValue:
      		return v.Val, nil
  also at tests/test_graphql_float_result_as_float_argument.dang:7, pkg/querybuilder/marshal.go:69 · 3/3 votes · fingerprint 70e4b72886b4
- pkg/dang/builtins.go:136 — Leaf fields under a nested selection inside an inline fragment still go through untyped ToValue. A Float field whose value is whole (gqlgen and json send `4`) used to become FloatValue and now becomes IntValue, so `x / 2` does integer division. This contradicts ToValue's new comment that typed GraphQL leaves never reach it. Not run.
  worth it: Float-typed fields can now hold Int values and give wrong arithmetic results
      // Float. Typed GraphQL/codec leaves never reach here; they convert
  also at pkg/dang/builtins.go:138, pkg/dang/ast_expressions.go:2026, pkg/dang/ast_operators.go:308 · 3/3 votes · fingerprint e0f469184d60

Checked and found sound:
- Every graphQLResultToValue caller gets json.Number from Execute/unpack, so no float64 branch was still needed.
- A null or empty `data` payload still unpacks to a nil response.
- Int results written as 5.0 or 1e3 still convert exactly through decodedNumberToInt.

Reviewed 6e8ca56..338e5fd (2 commits, 7 files changed) at STANDARD depth (votes needed: important 2 of 3, concern 2 of 2 or 2 of 3 on a split, nit 1 of 1): 3 finders, triage, 8 voters, synthesizer; composed from committer/readonly, contributor/readonly, editor/agent, reviewer/finder, reviewer/triage, reviewer/voter, reviewer/synthesizer. Failing tests or checks under these sub-agents are the reviewers' own reproductions, not this change's CI.
Merged as duplicates: pkg/dang/eval.go:863 (behavior, design) into pkg/dang/eval.go:863: Float args lose precision via %f formatting; pkg/dang/eval.go:870 (general) into pkg/dang/eval.go:870: MapValue marshalled with unquoted keys gives invalid GraphQL; pkg/dang/builtins.go:136 (behavior) into pkg/dang/builtins.go:136: inline fragment nested leaves untyped ToValue turn whole flo…
Below quorum: pkg/dang/eval.go:870 (0/2, needed 2)
