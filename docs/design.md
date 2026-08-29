# Design

The settled part. What a spell is, how the book is indexed, and the five
principles the rest of the app is downstream of.

## Principles

1. **Retrieval is by situation, not subject.** You open the book in a state, not in a topic. The index has to match the way you arrive.
2. **Derived properties are not tags.** Anything computable from the spell — its length, whether it's a question, its language — is computed when needed, never stored. Stored derivations go stale on the first edit. This is about properties *of a spell*. The list of tags the book knows is authored content and is stored, because a tag with no members is real and the derived version had no way to say so — `decisions/0008`.
3. **A spell earns its place by being used, not by being written.** Curation happens through the draw and the graveyard, not through a big upfront sort.
4. **Nothing leaves the device unless you ask.** The djinn is the single exception and it's opt-in.
5. **The file is the truth.** One JSON file, readable by a widget, portable to a rewrite, exportable as backup.

## The vocabulary

**Situations — 15, the primary index.** Phrased as states. A spell takes one or two; overlap is expected.

`spiralling` · `stuck` · `avoiding` · `defending` · `disconnected` · `overwhelmed` · `afraid` · `self-attacking` · `in-my-head` · `flat` · `rushing` · `wanting` · `with-her` · `among-people` · `arriving`

**Form — secondary.** `practice` (a procedure, not a line) · `prompt` (wants twenty minutes) · `flagged` (reconsider this — imported wrong, or tried and it didn't help; locked, can't be renamed or removed as a tag) · `inbox` (new, unproven — a `useful` mark strips it; burying just removes the spell from the draw, tag and all, until it's exhumed)

**Computed, never stored.** `question` · `untagged` · `useful`

**Deleted in the retag:** `care`, `body`, `sacred`, `shadow`, `agency`, `attention`, `connection`, `desire`, `expression`, `fear`, `pace`, `relationship`, `de`, `whisper`, plus the wikilink singletons.

A spell matching no situation keeps no tags and shows as `untagged`. That pile is a finding, not a gap.

**Two kinds of filter, matched to two kinds of tag.** Situations (plus `untagged`, the unsituated state) describe where you are — tap any that apply in the filter sheet and they OR together: a spell needs to match at least one. Everything else — form and computed tags alike — describes what the spell *is*, and gets its own **Require** / **Never** per tag: Require tags AND together (a spell must have all of them), Never tags rule a spell out if it has any of them. The two groups always combine with AND. ("Only" was the first name for Require — dropped because it reads as exclusive when several are on at once, and it's really "all of these," not "just this one.") The same filters narrow both the draw and the library.

**Orange marks what you asked for, not what a spell is.** A tag lights up on a card only when it's part of your current filter selection — the situations you picked, the tags you set to Require. A situation or type tag just sitting on the spell, unselected, stays plain. This keeps the color meaning one thing: this is why you're looking at this spell right now.

---

## Open questions

- **What is a spell, exactly?** Working definition: it completes on contact. `watch your feet` lands instantly; `what's the vulnerable thing?` also lands instantly despite being a question; `what would it look like to develop my taste?` wants a notebook and is a prompt. Questions aren't the dividing line — homework is.
- **Where do new spells come from?** Currently noticed in daily notes, marked, exported. The bar for entry might tighten once the book has proven a core.
- **Is `unreal` the sixteenth situation?** Eleven spells match no situation and most are cosmological — statements about how reality works rather than moves you make. Either a missing state, or a second kind of object closer to creed than spell.
- **Does the blind draw survive the djinn?** They're different rituals. The blind one can surprise you with a state you hadn't named.
- **Is 148 the right size?** Unknowable yet. Ask again once fifty have been drawn at least once.
- ~~**The seed drifts.**~~ *Answered.* The copy baked into the APK was frozen at the retag, and a book that couldn't be read was silently replaced with that stale snapshot — a working app with recent work missing. The seed is now synthetic, so there is nothing real in it to go stale, and a book that won't open is never overwritten: see the recovery screen in `docs/architecture.md`.