# This document was split

`spellbook-features.md` was doing four jobs at once — reference, changelog,
architecture decision records and roadmap — in one 508-line file where later
entries contradicted earlier ones and reading top to bottom was the only way to
learn what the app does today.

Nothing was rewritten. The paragraphs moved into files whose names say what
they are:

| Was | Is now |
|---|---|
| *Principles* and *The vocabulary* | [`docs/design.md`](docs/design.md) |
| *Shipped* — 40 chronological entries | [`CHANGELOG.md`](CHANGELOG.md) |
| *Queue*, and the specs not yet built | [`docs/roadmap.md`](docs/roadmap.md) |
| The specs for things already built | [`docs/decisions/`](docs/decisions/) |
| *Bugs* | fixed — see the refactor pass in the changelog |
| — | [`docs/architecture.md`](docs/architecture.md), new |
| — | [`docs/bridge.md`](docs/bridge.md), new: the full contract between the two halves |
| — | [`docs/data-format.md`](docs/data-format.md), new |
| — | [`CLAUDE.md`](CLAUDE.md), new: the invariants, and how to verify a change |

The seven decisions in `docs/decisions/` lift almost verbatim from the matching
spec sections. Each has a *Status* line, so a superseded decision is visible as
one — the thing a flat *Shipped* list couldn't express.

This file can be deleted. It's kept for one commit as a signpost.
