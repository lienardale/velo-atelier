# Realistic, brand-accurate bikes — decision record

Status: **accepted 2026-11-02**, rolled out phase by phase (one pull request per
phase, table below). Until phase 9 lands, the Stack table's "parametric geometry
in code, no glTF assets" is still true; this document says where it is going.

## The problem

Every bike visual is drawn by code: the 3D viewer builds each part from
primitives with 12 flat materials (`lib/bike3d/`, `components/bike3d/`), the
first-paint SVG silhouette projects the same plan (`lib/bike3d/silhouette.ts`),
and the 68 guide and decision-tree drawings are hand-written line art
(`components/illustrations/`). A bike knows its generic spec only — discipline,
wheel size, drivetrain… — and nothing of its brand, model, year, size or colour.
Frame geometry is one size-M row per discipline × wheel size
(`lib/bike3d/geometry-table.ts`).

## Decisions (the maintainer's)

| Question | Decision                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------- |
| Accuracy | the visitor's exact model: brand, model, year, size, colourway                                                 |
| Logos    | shown; the trademark risk is accepted                                                                          |
| Scope    | the 3D viewer, the 2D silhouette, the guide and decision-tree drawings                                         |
| Sources  | free / open-licence assets and AI image-to-3D only — no paid stock, no commissioned artist                     |
| AI input | makers' product photos, as reference only: never committed, never served, never sent to a third-party service  |
| Depth    | full rollout                                                                                                   |
| Pilots   | Decathlon Van Rysel GRVL AF (2026, aluminium) and Kona Rove AL 700 (2025); the demo bike becomes the Van Rysel |

## Options weighed

- **Whole-bike models from free libraries — rejected.** Sketchfab and Fab hold a
  handful of CC-BY branded bikes and almost no CC-BY branded components, and a
  branded model is usually licensed for editorial use only, which excludes an
  application. Nothing there covers "every exact model".
- **A whole bike from AI image-to-3D — rejected as the main path.** The output is
  one fused mesh, and the application needs one clickable mesh per part (the
  checkup, the parts panel, status tints and `window.__va.bike.screenPositionOf`
  all rest on it); spokes, chain and cables come out poorly. Kept for single
  components, cleaned up by hand.
- **Which AI tool.** TRELLIS.2 (MIT, self-hosted) is the one that fits "photos
  never leave a machine we control"; it needs a 24 GB NVIDIA GPU on Linux, so a
  rented one. Meshy uploads the photo to its service (and its free tier's output
  is CC BY 4.0). Hunyuan3D's licence defines its territory as worldwide _excluding
  the European Union_, so it is not usable here.
- **Chosen: data-driven parametric bikes, realistic rendering, selective meshes.**
  Brand accuracy is mostly data the makers publish — a geometry chart per size, a
  spec, colourways — and the solver's inputs are exactly a geometry chart's
  columns. Realism comes from physically based materials, environment lighting,
  swept frame tubes with real cross-sections, a per-bike livery with logos, and
  glTF component meshes where an asset exists. Every existing contract stays:
  one clickable mesh per part, the quality tiers, the WebGL budgets, the SVG
  fallback, the CSP.

**What "exact" means, said plainly**: geometry matches the maker's numbers; a
frame's tube shapes are a parametric approximation of the real ones; a component
is exact only where a mesh of it exists.

## Design rules

1. **The model is not a decision-tree question.** `lib/bike/spec-codec.ts` packs
   one byte per `QUESTION_IDS` entry and refuses any other length, and
   `QUESTION_IDS` is a strict enum in the bike actions and in
   `lib/guest/schema.ts`: a seventeenth question would invalidate every `?spec=`
   link in the wild. A bike carries a separate catalogue reference,
   `{ model: "van-rysel/grvl-af/2026", size, colourway }`.
2. **No storage version is bumped.** `LOCAL_BIKE_VERSION` is `z.literal(1)` and a
   guest bike that fails to parse is unreadable; `GUEST_STATE_VERSION` stays 2,
   whose own comment reserves a bump for a payload an older reader cannot read.
   The reference is an optional field validated on its own: a bad reference costs
   the reference, never the bike. The reader ships one release before any writer.
3. **`answers` stay the source of `spec` and `parts`.** `BikeSpec`,
   `validateBuild` and `BIKE_SPEC_VERSION` do not change. The catalogue drives the
   visuals and the frame geometry. Picking a model sets `answers` from the model
   and calls `deriveBike(answers, merge(ownerParts, catalogueParts))`.
4. **The material count is at its cap.** `MATERIAL_KEYS` has 12 entries and the
   perf spec asserts ≤ 12. The livery is the `paint` singleton's map, repainted
   per bike, and a glTF part's materials are replaced by the singletons when it
   loads. A map is always bound (a 4 × 4 solid one for a generic bike) and
   clearcoat is never switched on or off, so no shader compiles after `ReadyGate`.
5. **The CSP does not change.** `three/addons/loaders/GLTFLoader.js` is imported
   directly — not drei's `useGLTF`, which goes through `three-stdlib` with Draco
   and meshopt preconfigured — and the environment is
   `three/addons/environments/RoomEnvironment.js` through core `PMREMGenerator`,
   not drei's `<Environment>`, whose presets download from a CDN. A shipped glTF
   has no embedded image (GLTFLoader turns one into a `blob:` URL, which
   `img-src` refuses), no Draco, meshopt or Basis compression (their decoders need
   WebAssembly or `blob:` workers), `KHR_mesh_quantization` at most, no vertex
   colours, and at most three materials per part (the selection outline's
   +4 draw-call budget).
6. **A logo is one sanitised path-data source**, drawn with `Path2D` into the
   livery canvas and as `<path d>` in the silhouette: no raster step and no raw
   markup.
7. **The silhouette changes in the same pull request as the 3D shapes it
   projects**, because both are drawn from the same recipes.
8. **The seven presets stay test fixtures**; the demo becomes a catalogue
   reference. Rewriting `gravel-1x11` would move seven visual baselines, the perf
   presets and the e2e strings that name its 11 speeds.
9. **The catalogue is delivered like the tree's drawings**: committed
   `public/catalogue/*.json` kept fresh by a `--check` in `scripts/ci/content.sh`,
   a gitignored `lib/content/generated/catalog.ts` for the server, and a seed that
   reads the YAML itself.
10. **Stack is exact by construction and reach is the check.** The fork's
    axle-to-crown is solved from the published stack,
    `AC = (stack − bbDrop + rake·cos HA) / sin HA − 0.012 − HTL`, and the solver
    must then reproduce the published reach and effective top tube within ±5 mm.

## Where each kind of material lives, and under which licence

| What                                       | Where                                       | Licence                                                     |
| ------------------------------------------ | ------------------------------------------- | ----------------------------------------------------------- |
| Geometry and spec facts per model          | `content/bikes/**`                          | CC BY-SA 4.0, like the rest of `content/`                   |
| Brand wordmarks                            | `assets/brand-marks/<brand>/` + `SOURCE.md` | the owners' trademarks — outside MIT and CC BY-SA           |
| Component meshes                           | `public/models/` + a provenance manifest    | per asset (CC0, CC BY with credit, or generated: ruling R2) |
| Makers' reference photos and raw AI output | never in the repository                     | —                                                           |

`THIRD_PARTY_NOTICES.md` gets a "Brand marks" section, in the form its retailer
trademark entry already uses, and every CC BY asset is credited there and on a
credits page.

## Phases

| Phase | Pull request                                                                                          | Depends on |
| ----- | ----------------------------------------------------------------------------------------------------- | ---------- |
| P0    | this record                                                                                           | —          |
| P1    | the mirror fix: the 3D bike and the silhouette are drawn with the drive side where a real bike has it | —          |
| P2    | physically based materials and environment lighting for every bike; a texture counter in perf         | P1         |
| P3    | the catalogue: two pilot models, per-size geometry, validation, the generated index                   | P1         |
| P4    | frame shapes: swept tubes with real cross-sections, projected into the silhouette                     | P3         |
| P5    | liveries and colourways                                                                               | P4         |
| P6    | logos                                                                                                 | P5         |
| P7a   | lenient readers: `Bike.catalog`, guest storage, the import contract — deployed before P7b             | P3         |
| P7b   | writers: the model picker, "set my model", the actions                                                | P7a        |
| P8    | the demo bike becomes the Van Rysel                                                                   | P7b        |
| P9    | glTF infrastructure: the offline pipeline, the loader, the budgets                                    | P2         |
| P10   | the pilot components (TRELLIS.2 runbook in `docs/assets.md`)                                          | P9         |
| P11   | rendered drawings, tier A (from the parametric engine)                                                | P2         |
| P12   | rendered drawings, tier B (from library components)                                                   | P10, P11   |
| P13   | close-out: budgets re-pinned, docs index, backlog                                                     | all        |

About 21 of the 68 drawings stay line art, because their subject is a person, a
hand, a tool or a cutaway, or because they can show before the first input on the
home page, whose LCP must stay the `<h1>`: `saddle-height-heel-method`,
`cleat-ball-of-foot`, `tire-lever-technique`, `chain-wear-checker`,
`sag-measure-oring`, `pad-wear-disc`, `headset-threaded-vs-threadless`,
`presta-valve-core`, `ebike-battery-connector`, `ill-drive`, `ill-tire-system`,
and `ill-wheel-size` with its eight thumbnails.

## Rulings still owed (each asked at the phase that needs it)

- **R1 (P4–P6)** — rights beyond trademark: copyright in livery artwork, EU
  design rights in frame shapes, makers' photo copyright and their
  text-and-data-mining opt-outs.
- **R2 (P9)** — the licence statement for generated meshes in a public repository.
- **R3 (P10)** — where raw AI output is kept (photos are never in the repository).
- **R4 (P2, P8, P9)** — if realism costs the bike pages TBT or score, the
  measurements are reported and the maintainer rules: no gate is loosened to pass.
- **R5 (P6)** — a Van Rysel or Kona wordmark may be missing from Wikimedia Commons.
- **R6 (P7b)** — whether the page says a frame's shape is approximate.
- **R7 (P12)** — the wheel-size drawings stay line art.
- **R8 (P3)** — the exact Van Rysel and Kona SKUs (groupset, brakes, sizes).

## Sources read for this record

- Sketchfab's licences, including the editorial-only one: <https://sketchfab.com/licenses>
- TRELLIS.2: <https://github.com/Microsoft/TRELLIS.2>
- Hunyuan3D 2 community licence (territory): <https://huggingface.co/tencent/Hunyuan3D-2/blob/main/LICENSE>
- Meshy plans and output licence: <https://docs.meshy.ai/en/webapp/pricing>
- 99 Spokes' data offer (quote only): <https://99spokes.com/data>
- Kona Rove AL 700 geometry (aggregated): <https://bikeinsights.com/bike-geometries/687991e3d978a9001a016d26-2025-kona-bicycle-company-rove-al-700-base-52>
- Van Rysel GRVL AF: <https://www.vanrysel.com/en-GB/product/grvl-af_348802--c388m8817970>
- Referential use of a mark, _Audi v GQ_ (CJEU): <https://cms.law/en/gbr/legal-updates/pre-branded-spare-parts-cjeu-has-its-say-in-audi-trade-mark-case>
- Model cars and trademarks, _Adam Opel_: <https://ipkitten.blogspot.com/2023/05/small-models-big-trouble-can-model-cars.html?hl=en>
