/**
 * Structured data (§6.6) — one `<script type="application/ld+json">` per page.
 *
 * ## Why this is a text child, and not React's raw-HTML escape hatch
 *
 * The obvious spelling of this component hands the serialised JSON to that
 * escape hatch, and that is what most codebases ship. This repository uses it
 * nowhere outside `components/mdx/`, and `tests/security/xss-form-inputs.test.ts`
 * greps every file under `app/`, `lib/` and `components/` — comments included,
 * which is why the prop is not named here — to keep it that way. One
 * "harmless" exception is how a codebase stops having a rule.
 *
 * A text child works, and is strictly safer. A `<script>` is a raw-text element,
 * so React's server renderer does not HTML-escape its children — escaping would
 * corrupt the JSON. Measured on the installed react-dom 19.2.8: `&`, `>` and a
 * bare `<` all reach the document verbatim; only the exact sequences `<script`
 * and `</script` are rewritten, with their `s` escaped as `\u0073`. React's
 * rewrite is a backstop for that one sequence. The escaping below is what this
 * component promises, and it is wider.
 *
 * ## The escape
 *
 * An HTML parser ends a `<script>` at the first `</script` — inside a string
 * literal, inside a comment, anywhere. So every `<` in the serialised data is
 * written as `\u003c`, which is the same character to `JSON.parse` and an inert
 * backslash-u sequence to the HTML tokenizer. `</script>`, `<!--` and `<script`
 * in a title, a summary or a URL are therefore all incapable of closing the
 * element or opening a new one — and so is any `<` a future payload reaches for
 * that React has no special case of its own for.
 *
 * Every field this component receives is authored in-repo (guide frontmatter,
 * message catalogues, `routing.pathnames`), never typed by a visitor. The
 * escape is defence in depth, and it is what makes the component safe to point
 * at content that is one day less trusted.
 */

/** A JSON-LD node: whatever `JSON.stringify` can serialise, with an `@type`. */
export type JsonLdValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonLdValue[]
  | { readonly [key: string]: JsonLdValue | undefined };

export interface JsonLdDocument {
  readonly "@context": "https://schema.org";
  readonly "@type": string;
  readonly [key: string]: JsonLdValue | undefined;
}

/** `<` → `\u003c`, so no value can close the `<script>` element. See above. */
export function serializeJsonLd(data: JsonLdDocument): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function JsonLd({ data }: { data: JsonLdDocument }): React.JSX.Element {
  return (
    <script type="application/ld+json" data-testid="json-ld">
      {serializeJsonLd(data)}
    </script>
  );
}

export interface TechArticleInput {
  headline: string;
  description: string;
  /** Absolute or root-relative URL of the page itself. */
  url: string;
  /** BCP 47 language of the document (`fr`, `en`). */
  inLanguage: string;
  /** The repository, credited as the author of the guides (CC BY-SA 4.0). */
  publisherName: string;
  publisherUrl: string;
  /** Minutes, as the frontmatter declares them → ISO 8601 duration. */
  totalTimeMinutes?: number;
  /** `1 | 2 | 3` → a word search engines understand. */
  proficiencyLevel?: string;
}

/**
 * The `TechArticle` node of a guide page (§6.8 AC10).
 *
 * `TechArticle` rather than `HowTo`: `HowTo` requires `step[]` with its own
 * prose duplicated out of the MDX, and Google retired its rich result in 2023.
 * `TechArticle` describes what a guide is — a technical document — without
 * restating the body in a second, drift-prone place.
 */
export function techArticle(input: TechArticleInput): JsonLdDocument {
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: input.headline,
    description: input.description,
    url: input.url,
    inLanguage: input.inLanguage,
    isAccessibleForFree: true,
    license: "https://creativecommons.org/licenses/by-sa/4.0/",
    publisher: { "@type": "Organization", name: input.publisherName, url: input.publisherUrl },
    ...(input.totalTimeMinutes === undefined ? {} : { totalTime: `PT${input.totalTimeMinutes}M` }),
    ...(input.proficiencyLevel === undefined ? {} : { proficiencyLevel: input.proficiencyLevel }),
  };
}
