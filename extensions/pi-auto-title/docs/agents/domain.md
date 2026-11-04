# Domain docs

## Before exploring

Read `GLOSSARY.md` at the repo root and relevant decisions in `docs/adr/`.

If the files do not exist, proceed silently. The domain-modeling skill
creates them when terms or decisions are resolved.

## Layout

Use a single-context layout:

- `GLOSSARY.md` contains the repo's domain vocabulary.
- `docs/adr/` contains architectural decision records.

## Vocabulary

Use glossary terms in issue titles, proposals, hypotheses, and test names.
If a needed concept is missing, reconsider the term or note the gap for
domain-modeling.

## Decision conflicts

Explicitly flag proposals that contradict an existing ADR, and explain
why the decision should be reconsidered.
