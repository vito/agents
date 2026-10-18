# v5 variance batch

Reviewer v5 (6095040 triage neighbours, 35e2a3b parallel runs and
ballots), three live runs per case at STANDARD, one at a time, judge 3
samples. Model calls: `LLM HTTP POST /v1/messages` spans under the eval's
check span, the judge's included (reviewer + judge).

| case | run | value | noise | findings | vetted-real | vetted-real hit | fix given | words | review min | model calls |
|---|---|---|---|---|---|---|---|---|---|---|
| dang-187 | v5-1 | -4 | 4 | 6 | 2/12 | redundant-round-trips, docs-skill-graphql-laziness | 4/6 | 737 | 9.1 | 176 (172 + 4) |

## Run notes

- dang-187 v5-1: noise is two speed bumps (case-binding-equality and
  error-path-node, both vetted dismiss, raised as concerns, the second as a
  question) and two false findings: the two "Also raised, past the 3
  strongest concerns" one-liners (exhaustive match on a mutation's union,
  the mutation narrowing advice), which carry no fix or evidence. 3/7
  confirmed recall. fragment-nesting missed.
