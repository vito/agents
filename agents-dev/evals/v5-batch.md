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
