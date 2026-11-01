# Recipe domain

This package owns recipe schemas, normalization, serialization, and quantity
conversion.

## Property tests

Run the bounded property suite with:

```sh
mise //packages/recipe-domain:test:property
```

Each property runs 100 generated cases with the fixed seed `20261029` unless a
replay seed is supplied. Fast-check prints the seed and shrink path when an
assertion fails. Replay that exact counterexample with:

```sh
FC_SEED=1234 FC_PATH='2:1:0' \
  mise //packages/recipe-domain:test:property -- -t 'property name'
```

Add new properties under `tests/property/`. Import `propertyParameters` from
`tests/property/support.ts`, keep every arbitrary finite and size-bounded, and
prefer existing schemas or fixtures over a second model of the same data. Add a
focused `fc.check` test when a plausible broken implementation can demonstrate
that the property finds and shrinks the intended counterexample.

The CI budget for this property task is 5 seconds after dependency installation.
The parser and domain property tasks together must stay under 10 seconds. Raise
the number of generated cases only after timing both tasks through mise.
