# v5 variance batch

Reviewer v5 (6095040 triage neighbours, 35e2a3b parallel runs and
ballots), three live runs per case at STANDARD, one at a time, judge 3
samples. Model calls: `LLM HTTP POST /v1/messages` spans under the eval's
check span, the judge's included (reviewer + judge).

The table and notes below are as first scored. "Rescored" near the end
scores the same saved reviews again under the later scorer and cases, and
"v6" adds two runs after the fixes.

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
| dang-160-clean | v5-3 | +6 | 0 | 2 | - | (none vetted real) | 2/2 | 470 | 4.9 | 138 (134 + 4) |
| agents-tools-version | v5-1 | +3 | 0 | 1 | 1/1 | continuations-bind-version-zero | 1/1 | 285 | 4.1 | 106 (102 + 4) |
| agents-tools-version | v5-2 | +2 | 0 | 2 | 1/1 | continuations-bind-version-zero | 2/2 | 380 | 4.7 | 118 (114 + 4) |
| agents-tools-version | v5-3 | +3 | 0 | 1 | 1/1 | continuations-bind-version-zero | 1/1 | 294 | 4.1 | 106 (102 + 4) |

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
- dang-160-clean v5-3: the same two IMPORTANT findings as run 1, both
  guardrail 3/3 and unanimous: the `%f` six decimals (3.14159265 sent as
  3.141593; NaN/Inf to reject) and the inline-fragment leaves (`rating /
  2` gives 1). Both are labelled "confirmed bug", and the verdict says
  "two confirmed bugs need fixing before merge". The MapValue finding
  came back as unescaped map keys, a concern, and failed its vote 0/2.
- agents-tools-version v5-1: one finding, continuations-bind-version-zero,
  IMPORTANT 2/2, guardrail 3/3, naming all four call sites (388, 818,
  1453, 1477). All four finders reported it; the triage merged them.
  Nothing else raised; 2 voters.
- agents-tools-version v5-2: continuations-bind-version-zero again
  (IMPORTANT 2/2, guardrail 3/3, the four call sites, naming five tools:
  reset, rebase, rebaseContinue, rebaseSkip, rebaseAbort), plus a NIT:
  the new comment at committer/main.dang:83
  says to bump the version in `agent()` only. The judge matched the nit to
  the same issue 3/3 (quick-fix each time), so it scores a duplicate (-1,
  not noise); its fix is the same shared `stateVersion` the IMPORTANT
  item already asks for. 3 voters.
- agents-tools-version v5-3: as run 1, the one IMPORTANT finding
  (guardrail 3/3, the four call sites, all four finders' copies merged).
  A second finding citing staff/main.dang:67, Staff's own versioned
  binding, failed its vote 0/2; 4 voters.

## Summary

| case | runs | value mean (range) | noise mean (range) | vetted-real mean (range) | findings | words | review min | model calls |
|---|---|---|---|---|---|---|---|---|
| dang-187 | v5 ×3 | +5.7 (-4 to +12) | 1.7 (0 to 4) | 2.7/12, 22% (2 to 4) | 7.0 (6 to 9) | 942 (737 to 1194) | 11.6 (9.1 to 12.8) | 211 (176 to 232) |
| dang-187 | v4 ×2 | +6.0 (+4, +8) | 1.5 (1, 2) | 3.5/11 (3, 4) | 7.5 (7, 8) | 1128 (1062, 1194) | 10.3 (10.0, 10.5) | 226 (220, 231) |
| dang-59 | v5 ×3 | +14.3 (+13 to +15) | 0.3 (0 to 1) | 2/3, 67% (2 to 2) | 6.7 (6 to 7) | 1111 (986 to 1180) | 9.2 (8.5 to 10.1) | 306 (280 to 344) |
| dang-59 | v4 ×1 | +12 | 0 | 2/3 | 6 | 991 | 9.4 | 354 |
| dang-55-shadowing | v5 ×3 | +8.3 (+6 to +10) | 0.3 (0 to 1) | 2.7/3, 89% (2 to 3) | 4.7 (4 to 5) | 839 (724 to 935) | 8.6 (6.8 to 10.4) | 232 (180 to 276) |
| dang-55-shadowing | v4 ×2 | +10 (+10, +10) | 0 (0, 0) | 2/3 (2, 2) | 4 (4, 4) | 824 (820, 828) | 8.2 (7.8, 8.5) | 247 (227, 267) |
| dang-160-clean | v5 ×3 | +6.3 (+6 to +7) | 0 (0 to 0) | - (none vetted real) | 2.3 (2 to 3) | 484 (439 to 544) | 4.9 (4.9 to 4.9) | 121 (103 to 138) |
| dang-160-clean | v3 ×1 | +6 | 0 | - | 2 | 368 | 3.8 | 116 |
| dang-160-clean | v2 ×1 | +6 | 0 | - | 2 | 876 | 12.0 | - |
| agents-tools-version | v5 ×3 | +2.7 (+2 to +3) | 0 (0 to 0) | 1/1, 100% (1 to 1) | 1.3 (1 to 2) | 320 (285 to 380) | 4.3 (4.1 to 4.7) | 110 (106 to 118) |
| agents-tools-version | v2 ×1 | +2 | 0 | 1/1 | 2 | 607 | 7.3 | - |

Fix given: dang-187 19/21 (the two misses are run 1's fixless one-liners),
dang-59 20/20, dang-55-shadowing 13/14 (run 2's fixless one-liner),
dang-160-clean 7/7, agents-tools-version 4/4.

The v4 numbers are from the commit messages (526a269, 9cd18a5, 0063344),
scored under the labels of the time and not rescored: dang-187 had 11
vetted-real issues then, a dismissed issue raised as a decision scored a
speed bump (a53c6eb made it neutral), and qualified-root-rescue did not
exist (e372f5f added it from v4-2's finding, which scored false against
rescue-classification). By arithmetic, v4-1 would be +9 with noise 0 now;
v4-2 would be 4/12, about +7 with noise 1 (that finding false -2 to at
least guidance +1, the judge's rating then). Model calls for v5 include
the judge's 4; how v4's were counted is not recorded.

The earlier rows for dang-55-shadowing, dang-160-clean and
agents-tools-version are from commit messages too: dang-55 v4 from 9fa177c
and 95c0aa9 (calls "in the eval"), dang-160 v3 from 9045d49 (the triage
run; 116 calls in the eval), dang-160 v2 and agents-tools-version v2 from
3dd5bac (calls not recorded). dang-55 v5-1's 239 calls are from b3930ee,
which does not say whether the judge's 4 are in it.

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

### dang-55-shadowing: which vetted-real issues are found

- 3/3: constant-annotation-before-hoist (IMPORTANT in runs 1 and 2, a
  concern asked as a question in run 3; guardrail 3/3 each time), which
  v4 never got through (found by no finder in v4-1, voted down in v4-2);
  indistinguishable-type-errors (a concern every run; guidance in runs 2
  and 3).
- 2/3: fragment-resolves-local-type (IMPORTANT in run 1, a concern in run
  2, guardrail 3/3 there). Run 3 missed it: no finding about it reached
  the review, the merges or the evidence drops.

Findings outside the case, recurring (worth vetting):
- the REPL's BuildEnvFromImports never records unqualified imports, so a
  local `type Container` in the REPL still reuses and mutates the
  imported one: 3/3 (a concern in runs 1 and 2, guidance in run 2;
  IMPORTANT and guardrail 3/3 in run 3);
- interface and union pass 0 now reuse an existing local module, so a REPL
  redeclaration merges with the stale one (union members A, B, A, C): 3/3
  (a concern in run 1; run 2's fixless one-liner, false; a concern and
  guardrail 3/3 in run 3, where the IMPORTANT REPL item also names it).

Speed bumps and false findings: only run 2's "Also raised, past the 3
strongest concerns" one-liner (the interface/union reuse, -2), the same
overflow line that cost dang-187 v5-1; that run had four concerns, so
the fourth lost its evidence and fix. The other two runs have no noise.
v5 is 1.7 lower than v4's +10 on average but finds more: 2.7/3 against 2/3,
since the constant bug now survives the vote. Run 3 was the cheapest (6.8
min, 180 calls; 8 voters against 10 and 11).

### dang-160-clean: what each run raised

A case where nothing was fixed in history; the one listed issue,
float-arg-six-decimals, is claimed and unvetted, so vetted-real recall
does not apply.

- float-arg-six-decimals: 3/3, IMPORTANT, guardrail 3/3 every run (`%f`
  in querybuilder's marshaller; examples 1.23456789, 3.14159265, 1e-7).
  Runs 2 and 3 add that NaN/Inf render as invalid GraphQL.
- inline-fragment nested leaves turning whole Floats into Ints (unmatched,
  not in the case): 3/3, IMPORTANT in runs 1 and 3, a concern in run 2;
  guardrail 3/3, 2/3 and 3/3. convertNestedSelectionResult
  (ast_expressions.go:2026) converts leaf fields with the untyped ToValue,
  whose new json.Number case makes `4` an IntValue under a Float field.
  At the base, querybuilder did not decode with UseNumber and ToValue had
  no json.Number case, so the same leaf was a float64 and a FloatValue.
  It holds by inspection at both ends, and ToValue's new comment ("typed
  GraphQL/codec leaves never reach here") says otherwise. v2 raised it
  twice (an IMPORTANT and a concern, 3/3 votes each) and v3 once,
  IMPORTANT: every recorded run since v2 has, 5/5. It is worth adding to
  the case as a claimed issue, like float-arg-six-decimals.
- the new MapValue case in dangValueToGo: a finder raised it in all three
  runs (unreachable, since no GraphQL argument type unifies with a Map;
  or its keys written unquoted). Voted down as a concern in runs 1 and 3
  (0/2); in run 2 it passed as a NIT (1/1) and scored a quick-fix (one of
  three samples: speed bump). v2 and v3 voted it down too (0/3 twice,
  0/2).

Would a reader call any of it noise? Neither IMPORTANT item: both are
silent wrong values introduced by the change, with a concrete fix and
test. Run 2's MapValue nit is the only borderline item (it argues against
the commit message's claim rather than showing a failure), but it is
short and actionable. What a reader might push back on is tone: every
verdict says to fix before merging, and run 3 calls both "confirmed
bugs", for a change that has gone 3.5 months without a follow-up fix.
Nothing contradicted a sound item in any run. The scores match the
earlier runs (+6 in v2 and v3); the length sits between them (484 words
against 876 and 368), at about 5 min and 121 calls.

### agents-tools-version

- 3/3: continuations-bind-version-zero, IMPORTANT, guardrail 3/3, naming
  all four call sites (388, 818, 1453, 1477) each time. All four finders
  reported it in every run; the triage merged the copies.
- run 2's NIT (the new comment says to bump the version in `agent()`
  only) is matched to the same issue 3/3 and scores a duplicate (-1); v2
  raised the same nit and scored +2 with 2 findings too.
- a finding on staff/main.dang:67 (Staff's own versioned binding) was
  voted down 0/2 in run 3, as in v2 (0/3).

No speed bumps or false findings. With one issue the ceiling is +3,
reached in runs 1 and 3; the review is about half v2's length (320 words
against 607) and faster (4.3 min against 7.3).

## Rescored

The same 15 saved reviews (run-v5-*-standard.md), judged again with no
new review: judge only, 3 samples, 4 model calls each. Two things changed
since the first scoring, and both are in these numbers:

- the scorer (790225e): a finding can cover several issue keys ("also"),
  each with the part of the finding that covers it, which must be in the
  finding's text, on a strict majority of samples; recall counts every key
  covered, value counts the finding once;
- the cases (412c756): eight recurring findings are now claimed, unvetted
  issues (mutation-union-case-fails, nonnull-fragment-on-null;
  schema-module-per-file, variables-ordered-per-file,
  shared-mutable-parse-cache; repl-imports-untracked,
  interface-union-redeclare-merges; fragment-leaf-float-as-int).

"claimed hit" counts those new issues found. Judge variance also moves a
few findings by itself (noted where it does).

| case | run | value (first → rescored) | noise | vetted-real | vetted-real hit, rescored | claimed hit | fix given |
|---|---|---|---|---|---|---|---|
| dang-187 | v5-1 | -4 → +2 | 4 → 2 | 2/12 → 4/12 | redundant-round-trips, docs-interop-laziness, docs-skill-graphql-laziness, docs-skill-mutation-laziness | 1/2 | 4/6 |
| dang-187 | v5-2 | +9 → +11 | 0 → 0 | 2/12 → 5/12 | fragment-nesting, docs-interop-laziness, docs-skill-graphql-laziness, docs-skill-mutation-laziness, docs-skill-execution-points | 2/2 | 6/6 |
| dang-187 | v5-3 | +12 → +12 | 1 → 1 | 4/12 → 5/12 | fragment-nesting, redundant-round-trips, docs-skill-graphql-laziness, docs-skill-execution-points, qualified-root-rescue | 2/2 | 9/9 |
| dang-59 | v5-1 | +15 → +13 | 0 → 0 | 2/3 → 2/3 | imports-shared-at-runtime, focused-inference-skips-sibling-variables | 3/3 | 7/7 |
| dang-59 | v5-2 | +13 → +15 | 1 → 1 | 2/3 → 2/3 | (same) | 3/3 | 6/6 |
| dang-59 | v5-3 | +15 → +15 | 0 → 0 | 2/3 → 2/3 | (same) | 3/3 | 7/7 |
| dang-55-shadowing | v5-1 | +9 → +13 | 0 → 0 | 3/3 → 3/3 | (all three) | 2/2 | 5/5 |
| dang-55-shadowing | v5-2 | +6 → +8 | 1 → 1 | 3/3 → 3/3 | (all three) | 2/2 | 4/5 |
| dang-55-shadowing | v5-3 | +10 → +10 | 0 → 0 | 2/3 → 2/3 | constant-annotation-before-hoist, indistinguishable-type-errors | 2/2 | 4/4 |
| dang-160-clean | v5-1 | +6 → +6 | 0 → 0 | - | (none vetted real) | 2/2 | 2/2 |
| dang-160-clean | v5-2 | +7 → +7 | 0 → 0 | - | (none vetted real) | 2/2 | 3/3 |
| dang-160-clean | v5-3 | +6 → +6 | 0 → 0 | - | (none vetted real) | 2/2 | 2/2 |
| agents-tools-version | v5-1 | +3 → +3 | 0 → 0 | 1/1 → 1/1 | continuations-bind-version-zero | - | 1/1 |
| agents-tools-version | v5-2 | +2 → +4 | 0 → 0 | 1/1 → 1/1 | continuations-bind-version-zero | - | 2/2 |
| agents-tools-version | v5-3 | +3 → +3 | 0 → 0 | 1/1 → 1/1 | continuations-bind-version-zero | - | 1/1 |

| case | value mean, first → rescored | noise mean | vetted-real mean |
|---|---|---|---|
| dang-187 | +5.7 → +8.3 | 1.7 → 1.0 | 2.7/12 → 4.7/12 (22% → 39%) |
| dang-59 | +14.3 → +14.3 | 0.3 → 0.3 | 2/3 → 2/3 |
| dang-55-shadowing | +8.3 → +10.3 | 0.3 → 0.3 | 2.7/3 → 2.7/3 |
| dang-160-clean | +6.3 → +6.3 | 0 → 0 | - |
| agents-tools-version | +2.7 → +3.3 | 0 → 0 | 1/1 → 1/1 |

What moved:

- dang-187 recall: the skill-docs nit now also covers
  docs-interop-laziness and docs-skill-mutation-laziness (runs 1 and 2)
  and docs-skill-execution-points (runs 2 and 3), as the first scoring's
  notes said it did. No finding got an "also" key it does not name.
- dang-187 v5-1 (-4 → +2): its two fixless "Also raised" one-liners scored
  false (-4) as unmatched findings; now the first matches
  mutation-union-case-fails and scores a guardrail even fixless, and the
  second (the mutation narrowing advice) a duplicate of it (-1). The
  rendering is still what costs: in full, the second scored a quick fix
  in run 3.
- dang-187 v5-2: the `User!` null fragment is a guardrail now
  (nonnull-fragment-on-null; guidance unmatched before).
- dang-59 v5-1 (+15 → +13): the concern that the schema env is rebuilt per
  file now matches schema-module-per-file, whose summary names that cost,
  so it is a duplicate of the IMPORTANT item (-2). Same mechanism, same
  fix; the case summary is the cause, not the review.
- dang-59 v5-2 (+13 → +15): judge variance: the extraction split the
  runtime-imports item again, but the split-off sentence (the stale RunDir
  comment) scored a quick fix, alarmist (0) instead of a duplicate (-2).
- dang-55 v5-1 (+9 → +13): the REPL and interface/union concerns match
  their new issues and score guardrails (guidance before).
- dang-55 v5-2 (+6 → +8): the REPL concern a guardrail now; the fixless
  interface/union one-liner still scores false (matched, fix missing).
- agents-tools-version v5-2 (+2 → +4): judge variance: the comment nit is
  no longer matched to the issue (a duplicate before), so it is a quick
  fix.
- variables-ordered-per-file now takes the matches that went to the sound
  item lockstep-phases: no dang-59 run has a sound contradiction now.

## v6: dang-187 after the fixes

Two live STANDARD runs, one at a time, judge 3 samples, scored under the
rescoring's scorer and cases. Run 1 is bf98c01 (overflow concerns keep
their claim and fix; a reproduced concern outranks an argued one at equal
votes); run 2 adds 0a0e226 (probes outside suite runners, see Speed).
Model calls: reviewer + judge, the judge's 4 counted from its own span.

| case | run | value | noise | findings | vetted-real | vetted-real hit | claimed hit | fix given | words | review min | model calls |
|---|---|---|---|---|---|---|---|---|---|---|---|
| dang-187 | v6-1 | +9 | 1 | 7 | 4/12 | redundant-round-trips, docs-interop-laziness, docs-skill-graphql-laziness, docs-skill-mutation-laziness | 2/2 | 7/7 | 975 | 21.0 | 201 (197 + 4) |
| dang-187 | v6-2 | +10 | 0 | 6 | 6/12 | fragment-nesting, nullable-list-inconsistency, docs-interop-laziness, docs-skill-graphql-laziness, docs-skill-execution-points, qualified-root-rescue | 1/2 | 6/6 | 917 | 11.4 | 257 (253 + 4) |

(v6-1's commit message, 4e76be3, says 197 (193 + 4); the 197 are the
reviewer's alone.)

- v6-1: 2 guardrails (nonnull-fragment-on-null IMPORTANT,
  mutation-union-case-fails as a concern), 3 guidance
  (redundant-round-trips, by its real label; the mutation narrowing
  advice, matched to the unvetted sound item mutation-sent-once and judged
  on its value; a rescue-analysis warning lost when a parameter is named
  like a root field, unmatched), 1 quick fix (the skill-docs nit, covering
  three docs keys), and one speed bump: error-path-node raised as a
  concern (vetted dismiss). fragment-nesting is missed: nothing at
  eval.go:962/1287 reached the review, the merges or the drops. Exactly
  three concerns, so no overflow. 16 voters.
- v6-2: no noise. 2 guardrails (nonnull-fragment-on-null, fragment-nesting),
  3 guidance (qualified-root-rescue, as a false rescue warning on
  `maybeUser(id:)` and the qualified form; nullable-list-inconsistency, the
  first run of any version to raise it; the mutation trade-off, unmatched),
  1 quick fix (the docs nit, covering three docs keys). The mutation
  concern cites ast_patterns.go:444 but argues the docs' trade-off, so
  mutation-union-case-fails is not credited. error-path-node was voted
  down 1/3. Two concerns, no overflow. 16 voters.

Against the rescored v5 runs: +9 and +10 against +2, +11, +12 (mean +9.5
against +8.3), noise 0.5 against 1.0, vetted-real 5/12 against 4.7/12,
fix given 13/13 against 19/21. Neither run had more than three concerns,
so the overflow rendering was not exercised live; reviewerConcerns and
reviewerTriage cover it on canned replies.

### Speed

v5's two 12.8-minute runs (ReadTrace timings on v5-2 and v5-3's eval
spans): the review waits for the slowest finder, then the slowest voter.

- v5-1 (9.1 min): slowest finder 7m14 (behavior), voters about 1m15.
- v5-2 (12.8 min): slowest finder 9m45 (behavior, 52 model calls), the
  others 3m15 to 7m36; voters 10m06 to 12m31 (slowest 2m22).
- v5-3 (12.8 min): slowest finder 8m45 (general-2), the others 4m47 to
  6m20; the slowest voter took 3m21 over 27 turns, a TestDang run to
  reproduce its finding and two 30-second FindSpans calls among them.

v6-1 (21.0 min) showed the cause plainly: finder-behavior took 18m15. It
wrote its probes as `func (DangSuite) TestReproProbes`, a suite method
that runs under TestDang, so each of its five check runs selected
`go-test=TestDang` and ran all ~775 cases: 1.5 to 6.5 minutes a run, about
11 minutes in all. In v5-2 the same finder wrote a top-level
`TestReproProbe`, and each run took 6 seconds. The prompts said to run the
narrowest test, but not that a case inside a suite runner is never
narrow. 0a0e226 says so in the finder and voter prompts. In v6-2 every
finder probe was a top-level `TestRepro…` (voters still ran TestDang 3
times), the slowest finder took 8m24 (design) and the review 11.4 min.
One run is not a trend: the rest of the tail is model time, which varies
run to run, and v6-2 made more model calls than any v5 dang-187 run (253).
