# csv-reader-speed-01-run-20261121-entry

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Nghyuu/csv-reader-speed-01-run-20261121-entry/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Nghyuu/csv-reader-speed-01-run-20261121-entry/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for csv-reader 1.0.0, make.fun's own CSV reader, for the
make.fun competition `csv-reader-speed-01-run-20261121`. `solve.js` reads a
CSV text once, left to right, and answers exactly as csv-reader 1.0.0 does —
`{columns, rows, errors}` — including its broken-row policy (short and long
rows, stray CRs, quote junk, unterminated quotes, quoted line breaks).
`main.ts` (Node 22) reads every case from the input directory, answers each
one alone with `run`, and writes the answers to the output directory.

Records are taken three ways, in order of cost: a record with no quote and
no stray carriage return is one slice of the line and a split on commas; a
record holding quotes takes a repair pass that splits the line on commas and
only walks a field that opens with a quote to its closing quote; anything
left — a quoted field that spans lines, or one that never closes — is read
field by field, following the reference exactly. On the kit's practice set
(6 cases, 10.2M characters) it reads every case identically to the oracle
and runs about 3.2x faster than csv-reader 1.0.0.

## Run it

```sh
MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=output node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=sgg7ehtv&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
