[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/kanzaa28/hidden-spec-cli-01/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/kanzaa28/hidden-spec-cli-01/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

# mend — hidden-spec-cli-01-run-20261122

`mend` is the command-line tool SPEC.md specifies: it applies an edit an AI model wrote
to a tree of text files, in four formats — unified diff, SEARCH/REPLACE blocks, V4A
patches, and JSON edits — finding the lines each edit names at the first of three
matching tiers, and writing every change or none. Run it as
`node main.ts [options] [PATCH]`, Node 22 and its standard library alone.

Built by an AI agent for make.fun's "Build mend, one patch tool for every AI edit
format" bounty, $100 in USDC (10 places x $10). Practice-only: NOT submitted
(`handed_over_places` is "none"; a real submission needs the user's GitHub repo
created after 2026-11-22T14:00Z + recorded session transcripts + go-ahead).
Closes 24 Nov 2026 22:00 WITA.

## Measured results

- Official local trials (kit env server + scorer), all 3 practice instances:
  **score 1,000/1,000 — 100/100 checks passed** (unified 30/30, search_replace 20/20,
  v4a 20/20, json 15/15, cli 15/15), working 1.
- Kit `makefun check`: 6 passed (competition_open, snapshot, license_osi,
  entrypoint, entry_size, committed_provider_key), 1 failed (`transcripts_present`,
  expected — no recorded session in this harness), 5 at-submission (need a public
  GitHub repo). Kit files verified 34/34 against kit.json.
- Re-run the practice set yourself: `node check.ts <kit>/program/generator/practice.json`
  (also accepts a family or key prefix, e.g. `u-offset s-basic`).

## The files

- `main.ts`: the CLI. Implements all of SPEC.md: invocation and usage errors,
  output and exit codes, safe paths, format detection, 3-tier line matching with
  tier-2 re-indentation, unified diffs (sections, hunks, nearest-position match,
  `\ No newline at end of file`, create/delete/move), SEARCH/REPLACE blocks
  (path line, `ambiguous` on repeated matches, create on empty old lines), V4A
  patches (anchors, cursor, end-of-file chunks, move), JSON edits (create,
  str_replace, insert), and all-or-nothing writes with `A`/`D`/`M`/`R` output lines.
- `runner.ts`: the kit's runner, unchanged. In a trial it reads the checks from the
  env, runs `node main.ts` on each one in a fresh directory, and posts the results.
- `check.ts`: the practice set on your own machine, unchanged from the kit.
- `SPEC.md`: the specification.
- `LICENSE`: MIT.

## What's missing for a real submission

1. A public GitHub repo created after 2026-11-22T14:00Z, with this work pushed
   (commit SHA on a branch) — this VM has no GitHub account connected.
2. A transcript bundle of the sessions that built the entry, made by the kit's CLI
   (`node cli/makefun.mjs bundle`, from a recorded session — Claude Code / Codex /
   Superbot); a handed-over session is ranked but takes no paid place here.
3. The user's go-ahead, then submit before 24 Nov 2026 22:00 WITA.
