# Content — guides

Everything the site teaches lives here, as MDX in both locales. Licensed
**CC BY-SA 4.0** (`content/LICENSE`); the code around it is MIT.

```
content/
  guides/<slug>/fr.mdx   French — written first
  guides/<slug>/en.mdx   English — mandatory, same structure
  glossary.json          FR/EN terminology (use these words)
  README.md              this file
  LICENSE                CC BY-SA 4.0
```

## Commands

```bash
npm run content:new -- replace-chainring   # scaffold both locales as a stub (a slug that does not exist yet)
npx tsx scripts/content-check.ts           # structural rules only (default mode)
npm run content:check                      # --strict: + the corpus rules, as CI runs it
npm run content:build                      # compile MDX + regenerate lib/content/generated/*
```

Every problem is printed as `file:line: message`. The rules live in
`lib/content/check.ts`; the frontmatter contract in `lib/content/schema.ts`
(`ProcedureMeta` from `lib/domain/schema/procedure.ts` plus the document
fields). MDX is compiled at build time and rendered only on the server — there
is no JavaScript in a guide.

## Slugs and kinds

The folder name is the slug, English in both locales, and starts with the kind:
`check-`, `replace-`, `clean-`, `adjust-`, `measure-`
(`/fr/guides/check-brakes-disc`, `/en/guides/check-brakes-disc`). The 47 slugs
of the MVP are fixed in `tests/fixtures/content-manifest.ts`.

`check` and `measure` guides are always **full**, and so is every guide a
geometry measure points at (`lib/domain/data/geometry-measures.ts`). Other
guides may ship as a **stub**: complete frontmatter, exactly one `<Step>` body
of at least 40 words per locale. Stubs show a banner, are not indexed and are
never suggested as related guides.

## Template

```mdx
---
slug: clean-chain
kind: clean # check | replace | clean | adjust | measure — never `type`
title: Nettoyer et lubrifier la chaîne
summary: One or two sentences, shown on the card and as the meta description.
status: full # full | stub
order: 10 # sort key within the kind on /guides
difficulty: 1 # 1 easy · 2 intermediate · 3 advanced
minutes: 20
partIds: [chain] # lib/domain/data/parts — every id must exist
appliesTo: # optional: which bikes (a SpecCondition, see below)
  path: drivetrain.transmission
  in: [chain]
tools: # lib/domain/data/tools — ids and stand-ins
  - toolId: degreaser
    alternatives: [isopropyl-alcohol]
related: [replace-chain, check-drivetrain]
safety: # optional; required (strict) for battery, motor, hose or rotor guides
  - "Quote any line that contains a colon followed by a space: like this."
steps:
  - id: degrease # kebab-case, unique, identical in fr and en
    title: Dégraisser la chaîne
    illustration: chain-wear-checker # optional, from lib/content/illustrations.ts
    partIds: [chain] # optional, a subset of the guide's partIds
    appliesTo: { path: brakes.isDisc, in: [true] } # optional
---

<Step id="degrease">

Markdown text. Components, with literal string attributes only:

<Tool id="degreaser" alt="isopropyl-alcohol" />.

<Warning level="caution">

info · caution · danger

</Warning>

<Illustration id="barrel-adjuster" caption="Optional caption" />

<Measure id="saddle-height" unit="mm" target="0.883 × inseam" />

</Step>
```

Rules the check enforces on the body: `<Step id>` in the same order as
`steps[]`; no `import`/`export`, no `{expressions}`, no other component, no
`http://` link; an `<Illustration>` must not repeat the step's own
`illustration`. Avoid a bare `<` or `{` in prose (MDX reads them as code):
write "moins de 1 mm", not "< 1 mm".

## Check steps and the to-fix list

A `check` step may ask a question. Each "ça ne marche pas" answer becomes one
line of the visitor's to-fix list:

```yaml
checkQuestion:
  prompt: Reste-t-il au moins 1 mm de garniture sur chaque plaquette ?
  skippable: false
  ko:
    - action: replace # replace | fix | clean | adjust | inspect-shop
      partId: brake-pads-rear
      reasonKey: pad-worn # messages/<locale>/guides.json → guides.reasons.*
      guideSlug: replace-brake-pads-disc # required unless inspect-shop
```

`fix` points at an **adjust** guide; every other action at a guide of the same
kind; `inspect-shop` (bleeding, truing, bearings, motor service…) has no guide.
Strict mode requires ≥ 40 words in each checked step.

The reason keys available are listed under `reasons` in
`messages/fr/guides.json` (and `lib/content/generated/reason-keys.ts` after
`npm run content:build`). If you need a new one, add it to **both**
`messages/fr/guides.json` and `messages/en/guides.json`.

## `appliesTo`

A condition over the bike spec: `{ path, in }`, `{ path, notIn }`,
`{ all: [...] }`, `{ any: [...] }`, `{ not: ... }`. Paths and their possible
values are listed in `lib/content/applies-to.ts` (`SPEC_VOCABULARY`); a typo is
a check error, and every label shown in the "Pour quels vélos ?" banner already
exists in `guides.appliesTo.*`.

## Illustrations

Guide drawings are React SVG components in `components/illustrations/`
registered in `lib/content/illustrations.ts`; alt text and numbered callouts are
in `messages/{fr,en}/illustrations.json`. See `docs/illustrations.md`.

## Words

Use `glossary.json`: _plaquettes_ (disc) vs _patins_ (rim), _jeu de direction_,
_boîtier de pédalier_, _roue libre_ vs _cassette_, British _tyre_ in English.
