# Recipe parsing

This package turns Cooklang, structured text, and Schema.org input into recipe
domain models.

## Property tests

Run the bounded property suite with:

```sh
mise //packages/recipe-parsing:test:property
```

Each property runs 100 generated cases with the fixed seed `20261029`. Parser
input is capped at 512 characters. Fast-check prints the seed and shrink path
when an assertion fails. Replay that exact counterexample with:

```sh
FC_SEED=1234 FC_PATH='2:1:0' \
  mise //packages/recipe-parsing:test:property -- -t 'property name'
```

Add new properties under `tests/property/`. Import `propertyParameters` from
`tests/property/support.ts`, bound collection and string sizes, and start with
the package's existing schemas, fixtures, and canonical data. Add a focused
`fc.check` test when a plausible parser or serializer defect can show that the
property finds the expected counterexample.

The CI budget for this property task is 5 seconds after dependency installation.
The parser and domain property tasks together must stay under 10 seconds. Raise
the number of generated cases only after timing both tasks through mise.
