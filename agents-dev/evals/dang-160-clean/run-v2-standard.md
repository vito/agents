3 important, 1 concern

Verdict: The change does what it sets out to do: typed Int and Float results now decode according to their declared type, and Float values can be passed back as arguments. Fix the `%f` float formatting in querybuilder's marshal.go first. Right now any Float argument with more than six decimal places is sent as a different number, and nothing reports it.

IMPORTANT:
- pkg/dang/eval.go:863 — Float values now reach querybuilder's argument marshaller, which formats float64 with "%f". That keeps only 6 decimal places, so `echoFloat(value: 0.1234567)` sends `0.123457` and `echoFloat(value: 0.0000001)` sends `0.000000`. Before this change these calls failed with "unsupported value type". Now they succeed and quietly send a different number. The new test only uses 4.5 and 2.5, so it can't catch this. I traced it in the code and confirmed Go's %f default precision; I had no shell to run it.
  worth it: the change claims Float results round-trip as arguments, but any value with more than 6 decimals, or a very small one, comes back altered with no error.
  evidence:
      case FloatValue:
      		return v.Val, nil
  also at pkg/querybuilder/marshal.go:69
  votes: 3/3 confirmed · correctness (general) · fingerprint e3cf765454b1
- pkg/dang/builtins.go:138 — Leaf fields inside a nested sub-selection of an inline fragment still go through the untyped ToValue. With UseNumber, a whole-number Float there (gqlgen writes 4.0 as `4` via %g, and JS servers do the same) now becomes IntValue. At the merge base it was FloatValue. The static type stays Float, so `x / 3` does integer division at runtime and gives 1. The new ToValue comment says typed GraphQL leaves never reach this case, but this caller passes them through.
  worth it: it is a regression from the merge base for Float fields on union/interface sub-selections, and the comment hides that the path exists.
  evidence:
      if i, err := val.Int64(); err == nil && int64(int(i)) == i {
  also at pkg/dang/ast_expressions.go:2026, pkg/dang/builtins.go:136, pkg/dang/ast_operators.go:308
  votes: 3/3 confirmed · correctness (general) · fingerprint aa50bce18360
- pkg/dang/eval.go:863 — Every Float argument is now sent through MarshalGQL, which prints floats with `%f`, i.e. always six decimal places. A Float result like 37.7749295 goes back to the server as 37.774930, and 1e-7 goes back as 0.000000. The new test only passes because 4.5 and 2.5 fit in six decimals. I read this from the code; there was no Go runner in the sandbox.
  worth it: the commit says Float results now round-trip as arguments, but any value finer than 1e-6 changes silently on the way back.
  evidence:
      case FloatValue:
  also at pkg/querybuilder/marshal.go:69, tests/test_graphql_float_result_as_float_argument.dang:6
  votes: 3/3 confirmed · correctness (design) · fingerprint 5bf6c06c5b28

CONCERN:
- pkg/dang/builtins.go:136 — The new json.Number case in ToValue says typed GraphQL leaves never reach it, but leaf fields inside a nested selection under an inline fragment (convertNestedSelectionResult) still convert through ToValue with no declared type. There a Float field whose value is whole (JSON `6`) now becomes IntValue instead of FloatValue, and `x / 4` then does integer division (1 instead of 1.5). Did you mean to make the Int/Float choice depend on the value's shape on this path, or should it look up the field's declared type like convertInlineFragmentResult does?
  worth it: Float fields read through nested fragments can now give integer results depending on the value, and the code comment says this can't happen.
  evidence:
      // Float. Typed GraphQL/codec leaves never reach here; they convert
  also at pkg/dang/ast_expressions.go:2026, pkg/dang/builtins.go:138, pkg/dang/ast_operators.go:308
  votes: 3/3 confirmed · behavior (behavior) · fingerprint 7114a8eb98e1

Checked and found sound:
- Typed Int/Float leaves handle json.Number, including whole-number Floats and exponent forms, through decodedNumberToInt.
- Execute behaves as before for a `null` data payload and for request errors once data is decoded into json.RawMessage.
- UseNumber only affects interface{} targets, so typed binds like string ids and structs decode as before.
- No package outside Dang imports querybuilder, so the switch to json.Number stays internal.
- decodedNumberToInt still rejects fractional and out-of-range values on the Int path.

Reviewed 6e8ca56..338e5fd (merge base..head): 2 commits, 7 files changed, at STANDARD depth (3 finders; 3 voters per finding, quorum 2).
Sub-agents composed from: dag://?llm=committer/readonly, dag://?llm=contributor/readonly, dag://?expertise=editor/agent, dag://?llm=reviewer/finder, dag://?llm=reviewer/voter, dag://?llm=reviewer/synthesizer
Failing tests or checks listed for this call under finder-*, voter-* or synthesizer agents are the reviewers' own reproductions, run in private sandboxes (often written to fail on purpose to demonstrate a finding); they are not this change's CI results.

Merged into an earlier finding quoting the same code (3):
  - pkg/dang/eval.go:863 (behavior): Float arguments now reach the query builder, but marshalValue formats every float with "%f", which always prints six decimal places. A Float result like 3.14159…
  - pkg/dang/builtins.go:138 (design): Scalar fields nested inside an inline fragment's sub-selection are still converted with untyped ToValue, not by their declared type. The new json.Number case tu…
  - pkg/dang/eval.go:870 (design): The commit says the MapValue case lets a map feed an input object or map-shaped scalar. As far as I can see, the type checker never allows that. MapType has no…
Below quorum (2 of 3): pkg/dang/eval.go:870 (0/3 confirmed), pkg/dang/eval.go:869 (0/3 confirmed)

Answer every finding: fix it (a re-review marks it FIXED), or resolve(fingerprint:, reason:). To post one on a pull request, pass its path and line to comment(path:, line:); one marked outside the hunks goes on the conversation instead.
