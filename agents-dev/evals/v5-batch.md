# v5 variance batch

Reviewer v5 (6095040 triage neighbours, 35e2a3b parallel runs and
ballots), three live runs per case at STANDARD, one at a time, judge 3
samples. Model calls: `LLM HTTP POST /v1/messages` spans under the eval's
check span, the judge's included (reviewer + judge).

| case | run | value | noise | findings | vetted-real | vetted-real hit | fix given | words | review min | model calls |
|---|---|---|---|---|---|---|---|---|---|---|
| dang-187 | v5-1 | -4 | 4 | 6 | 2/12 | redundant-round-trips, docs-skill-graphql-laziness | 4/6 | 737 | 9.1 | 176 (172 + 4) |
| dang-187 | v5-2 | +9 | 0 | 6 | 2/12 | fragment-nesting, docs-skill-graphql-laziness | 6/6 | 896 | 12.8 | 232 (228 + 4) |

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
