# v5 variance batch

Reviewer v5 (6095040 triage neighbours, 35e2a3b parallel runs and
ballots), three live runs per case at STANDARD, one at a time, judge 3
samples. Model calls: `LLM HTTP POST /v1/messages` spans under the eval's
check span, the judge's included (reviewer + judge).

| case | run | value | noise | findings | vetted-real | vetted-real hit | fix given | words | review min | model calls |
|---|---|---|---|---|---|---|---|---|---|---|
| dang-187 | v5-1 | -4 | 4 | 6 | 2/12 | redundant-round-trips, docs-skill-graphql-laziness | 4/6 | 737 | 9.1 | 176 (172 + 4) |
| dang-187 | v5-2 | +9 | 0 | 6 | 2/12 | fragment-nesting, docs-skill-graphql-laziness | 6/6 | 896 | 12.8 | 232 (228 + 4) |
| dang-187 | v5-3 | +12 | 1 | 9 | 4/12 | fragment-nesting, redundant-round-trips, docs-skill-graphql-laziness, qualified-root-rescue | 9/9 | 1194 | 12.8 | 226 (222 + 4) |
| dang-59 | v5-1 | +15 | 0 | 7 | 2/3 | imports-shared-at-runtime, focused-inference-skips-sibling-variables | 7/7 | 1166 | 9.0 | 293 (289 + 4) |
| dang-59 | v5-2 | +13 | 1 | 6 | 2/3 | imports-shared-at-runtime, focused-inference-skips-sibling-variables | 6/6 | 986 | 10.1 | 280 (276 + 4) |
| dang-59 | v5-3 | +15 | 0 | 7 | 2/3 | imports-shared-at-runtime, focused-inference-skips-sibling-variables | 7/7 | 1180 | 8.5 | 344 (340 + 4) |
| dang-55-shadowing | v5-1 | +9 | 0 | 5 | 3/3 | fragment-resolves-local-type, constant-annotation-before-hoist, indistinguishable-type-errors | 5/5 | 935 | 8.5 | 239 |
| dang-55-shadowing | v5-2 | +6 | 1 | 5 | 3/3 | fragment-resolves-local-type, constant-annotation-before-hoist, indistinguishable-type-errors | 4/5 | 857 | 10.4 | 276 (272 + 4) |
| dang-55-shadowing | v5-3 | +10 | 0 | 4 | 2/3 | constant-annotation-before-hoist, indistinguishable-type-errors | 4/4 | 724 | 6.8 | 180 (176 + 4) |
| dang-160-clean | v5-1 | +6 | 0 | 2 | - | (none vetted real) | 2/2 | 439 | 4.9 | 122 (118 + 4) |
| dang-160-clean | v5-2 | +7 | 0 | 3 | - | (none vetted real) | 3/3 | 544 | 4.9 | 103 (99 + 4) |

No run failed for infrastructure reasons; none was retried.

## Run notes

- dang-187 v5-1: noise is two speed bumps (case-binding-equality and
  error-path-node, both vetted dismiss, raised as concerns, the second as a
  question) and two false findings: the two "Also raised, past the 3
  strongest concerns" one-liners (exhaustive match on a mutation's union,
  the mutation narrowing advice), which carry no fix or evidence. 3/7
  confirmed recall. fragment-nesting missed.
- dang-187 v5-2: 2 guardrails (fragment-nesting; the mutation union's
  exhaustive `case` failing at runtime, unmatched), 1 guidance (`... on
  User!` on a null receiver gives null, unmatched), 2 quick fixes (skill
  laziness docs; the landing-page demo's extra queries, unmatched), and
  error-path-node filed as a decision to record (neutral). The mutation
  union finding is run 1's fixless "also raised" one-liner that scored
  false; with evidence and a fix it is a guardrail 3/3. 10 voters (13 in
  run 1); 3/7 confirmed.
- dang-187 v5-3: 3 guardrails (the `User!` null fragment, the mutation
  union `case`, fragment-nesting), 3 quick fixes (mutation narrowing docs,
  qualified-root-rescue, skill laziness docs), redundant-round-trips as a
  nit (guidance by its real label; the judge said speed bump 2/3),
  error-path-node as a decision (neutral), and one speed bump: a lazy
  fragment on an already concrete handle stacking a second fragment. The
  mutation narrowing nit contradicts the unvetted sound item
  mutation-sent-once (judged on its value, quick-fix); it is run 1's
  second "also raised" one-liner, false there. 14 voters; one nit over
  the cap of 5 not reported. 3/7 confirmed.
- dang-59 v5-1 (dang-59-file-local-imports): 4 guardrails (per-file
  variable ordering, the LSP's sibling variables, imports shared at
  runtime, one schema module per file breaking type identity across
  files) and 3 guidance concerns asked as questions (shared mutable
  cached blocks in the LSP, the schema env rebuilt per file, RunFile and
  RunDir disagreeing on alias conflicts). The per-file variable ordering
  contradicts the unvetted sound item lockstep-phases, judged on its
  value (guardrail 3/3); v4 reported it twice, here the triage merged
  the two copies and the LSP one stays apart. 7/7 unanimous; 2/2
  confirmed. phase-groups-by-index missed; one concern cites a path in
  the finder's mount (mnt/jrpc2), noted "not found at head".
- dang-59 v5-2: the review has 5 items, all IMPORTANT, and the judge
  rates all 5 guardrails: the same four as run 1 (variable ordering again
  against lockstep-phases, LSP siblings, runtime imports, per-file
  schema modules) plus the shared mutable parse cache, a concern asked
  as a question in run 1 and IMPORTANT here. The judge's extraction made
  a 6th finding of one sentence inside the runtime-imports item (the
  stale RunDir comment), scored a duplicate and alarmist 3/3: -2 value
  and the 1 noise come from that split, not from the review. 10 voters;
  2/2 confirmed; phase-groups-by-index missed.
- dang-59 v5-3: 4 guardrails (the same four as run 1), 2 guidance (the
  shared parse cache, as a concern again; the RunFile/RunDir alias rule,
  filed as a decision this time), and a quick fix: TestRunDirImportsAreFileLocal
  cannot tell file-local imports from leaking ones. Variable ordering
  matched lockstep-phases again. 7/7 unanimous, 14 voters, 2/2
  confirmed; phase-groups-by-index missed.
- dang-55-shadowing v5-1 (b3930ee, before this batch): 2 guardrails and 3
  guidance; constant-annotation-before-hoist (IMPORTANT 2/2, guardrail
  3/3) and fragment-resolves-local-type lead as IMPORTANT, then three
  concerns: the REPL's untracked imports, the bare-name type errors and
  interface/union pass 0 reusing a local type of another kind. Its model
  calls were counted without recording the judge's share.
- dang-55-shadowing v5-2: constant-annotation-before-hoist leads as
  IMPORTANT (2/3 votes, a tie-break), then three concerns: the REPL's
  untracked imports (unmatched, guidance), the bare-name type errors
  (guidance) and fragment-resolves-local-type (guardrail, a concern this
  time). The noise is run 1's fifth finding, interface/union pass 0
  reusing a local type, demoted to a fixless "Also raised, past the 3
  strongest concerns" one-liner and judged false 3/3, as on dang-187 v5-1.
  11 voters; 3/3 confirmed.
- dang-55-shadowing v5-3: 3 guardrails and 1 guidance, all unanimous.
  The REPL's untracked imports lead as IMPORTANT (unmatched, guardrail
  3/3; it now also carries the interface/union regression, three finders'
  copies merged into it), then interface/union pass 0 reusing stale REPL
  definitions (unmatched, guardrail, in full this time), the bare-name
  type errors (guidance) and constant-annotation-before-hoist, a concern
  asked as a question (guardrail). fragment-resolves-local-type is missed:
  it is not in the review, the merges or the evidence drops. 8 voters, no
  split; the fastest run (6.8 min, 180 calls).
- dang-160-clean v5-1: two IMPORTANT findings, both guardrail 3/3. (1)
  float-arg-six-decimals (claimed, unvetted): Float arguments reach
  querybuilder's `%f`, so 1.23456789 is sent as 1.234568. (2) Unmatched:
  leaves of a nested selection inside an inline fragment still go through
  the untyped ToValue, whose new json.Number case makes a Float field's
  integral value (gqlgen writes 4.0 as `4`) an Int, so `score / 8` divides
  as integers. It holds by inspection at head: convertNestedSelectionResult
  (ast_expressions.go:2026) calls ToValue on leaves, where
  convertInlineFragmentResult looks up the schema field. A third finding
  (the untested MapValue branch) failed its vote 0/2. Nothing contradicts
  a sound item; a reader would call none of it noise, though the verdict's
  "before merging" is stronger than a known-clean case wants.
- dang-160-clean v5-2: the same two problems, plus a nit. (1)
  float-arg-six-decimals, IMPORTANT, guardrail 3/3; it adds that NaN and
  Inf render as invalid GraphQL literals. (2) The inline-fragment
  Float-to-Int leaves, a concern this time (guardrail 2/3, guidance 1/3),
  which also points out that the ToValue comment ("typed leaves never
  reach here") is wrong. (3) NIT: the new MapValue case in dangValueToGo
  looks unreachable (no GraphQL argument type unifies with a Map), and
  marshalValue would write its keys unquoted; judged quick-fix (samples:
  quick-fix twice, one of them matched to the sound item
  float-and-map-arguments, and a speed bump once). It disputes the commit
  message's claim rather than calling the serialization broken, so it
  does not contradict the sound item; a reader may find it a borderline
  speed bump. Run 1's version of it failed its vote 0/2; here as a nit it
  needed 1/1.

## Summary

| case | runs | value mean (range) | noise mean (range) | vetted-real mean (range) | findings | words | review min | model calls |
|---|---|---|---|---|---|---|---|---|
| dang-187 | v5 ×3 | +5.7 (-4 to +12) | 1.7 (0 to 4) | 2.7/12, 22% (2 to 4) | 7.0 (6 to 9) | 942 (737 to 1194) | 11.6 (9.1 to 12.8) | 211 (176 to 232) |
| dang-187 | v4 ×2 | +6.0 (+4, +8) | 1.5 (1, 2) | 3.5/11 (3, 4) | 7.5 (7, 8) | 1128 (1062, 1194) | 10.3 (10.0, 10.5) | 226 (220, 231) |
| dang-59 | v5 ×3 | +14.3 (+13 to +15) | 0.3 (0 to 1) | 2/3, 67% (2 to 2) | 6.7 (6 to 7) | 1111 (986 to 1180) | 9.2 (8.5 to 10.1) | 306 (280 to 344) |
| dang-59 | v4 ×1 | +12 | 0 | 2/3 | 6 | 991 | 9.4 | 354 |

Fix given: dang-187 19/21 (the two misses are run 1's fixless one-liners),
dang-59 20/20.

The v4 numbers are from the commit messages (526a269, 9cd18a5, 0063344),
scored under the labels of the time and not rescored: dang-187 had 11
vetted-real issues then, a dismissed issue raised as a decision scored a
speed bump (a53c6eb made it neutral), and qualified-root-rescue did not
exist (e372f5f added it from v4-2's finding, which scored false against
rescue-classification). By arithmetic, v4-1 would be +9 with noise 0 now;
v4-2 would be 4/12, about +7 with noise 1 (that finding false -2 to at
least guidance +1, the judge's rating then). Model calls for v5 include
the judge's 4; how v4's were counted is not recorded.

### dang-187: which vetted-real issues are found

- 3/3: docs-skill-graphql-laziness (the skill-reference nit on graphql.md:64,
  every run).
- 2/3: fragment-nesting (runs 2, 3, IMPORTANT both times),
  redundant-round-trips (runs 1, 3: the known `id` re-fetched).
- 1/3: qualified-root-rescue (run 3, as a nit).
- never credited: fragment-null-soundness, nullable-list-inconsistency,
  node-can-return-abstract, sdk-parity-overstated,
  dead-branch-needs-concrete-type, docs-interop-laziness,
  docs-skill-mutation-laziness, docs-skill-execution-points. The last
  three are partly in the text, but never credited: the skill-laziness
  nit also names interop.md's Laziness note (runs 1, 2), the mutation
  laziness rule (runs 1, 2) and control-flow.md:137's execution points
  (runs 2, 3). A finding matches one key, so these are folded into
  docs-skill-graphql-laziness.

Dismissed issues: error-path-node 3/3 (a concern asked as a question in
run 1, a speed bump; a decision to record in runs 2 and 3, neutral);
case-binding-equality 1/3 (run 1, a speed bump, listed as the one to fix
first).

Findings outside the case, recurring (worth vetting):
- a mutation-returned union's exhaustive `case` fails at runtime with the
  internal "exhaustive case did not match" error: 3/3 (guardrail 3/3 in
  runs 2 and 3; false in run 1, where it was a fixless one-liner);
- `... on User!` on a null receiver evaluates to null: 2/3 (guidance,
  guardrail);
- the mutation narrowing advice in interfaces-unions.md:81 (the lazy
  fragment re-sends the mutation): 2/3 (false as run 1's one-liner, a
  quick fix in run 3, matched against the unvetted sound item
  mutation-sent-once).

Speed bumps and false findings: run 1's two "Also raised, past the 3
strongest concerns" one-liners, which lose their evidence and fix and
score false (-4, the main reason run 1 scored -4) though the same
findings score guardrail and quick-fix in full in other runs; dismissed
issues raised as concerns (run 1); one speed bump in run 3 (a lazy
fragment on a concrete handle stacking a second fragment). The variance is
mostly in what the synthesis does with what the finders found (overflow
lines, ranking dismissed issues first, concern vs decision), not in what
they found.

### dang-59: which vetted-real issues are found

- 3/3: imports-shared-at-runtime, focused-inference-skips-sibling-variables
  (IMPORTANT every run, guardrail 3/3).
- never: phase-groups-by-index (run 2's LSP finding quotes
  `inferencePhases[:6]` but about the skipped variables phase).

Findings outside the case, recurring (worth vetting):
- one schema module per file's import, so `Container` from a sibling
  fails "cannot use Container! as Container!": 3/3, IMPORTANT, guardrail
  3/3 every run;
- per-file variable ordering (a.dang's `x = y + 1` before b.dang's `y`):
  3/3, IMPORTANT, guardrail 3/3, matched each time as contradicting the
  unvetted sound item lockstep-phases (judged on its value). v4 found it
  too (twice in one run). lockstep-phases probably wants `dismiss` and
  this an issue of its own;
- the LSP parse cache sharing mutable ASTs across open files: 3/3
  (guidance, guardrail, guidance);
- RunFile and RunDir disagreeing on an import alias shadowed by a local
  type: 2/3 (guidance; a concern once, a decision once).

Speed bumps and false findings: none from the reviews. The only noise
(run 2) is the judge's extraction splitting one sentence of an item into
its own finding, scored a duplicate and alarmist. v4's duplicate (the
variable ordering twice) did not recur: the triage merged the copies in
all three runs.
