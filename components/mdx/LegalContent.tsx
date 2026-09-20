import { MDXContent } from "@content-collections/mdx/react";

import type { LegalDocument } from "@/lib/content/legal";

/**
 * A legal page, rendered whole (§6.6): the `<h1>` and the revision date from
 * the frontmatter, then the compiled MDX body.
 *
 * It lives here, beside `GuideContent`, because this folder is the MDX
 * rendering boundary (§5.2) — compiled document code is evaluated in React
 * Server Components and nowhere else.
 *
 * **The pages import it by path, never through `./index.ts`.** The barrel also
 * exports `Step`, `StepScope` and `Measure`, which are client components that
 * read `guides` and `parts`; pulling the barrel into a legal route would put
 * those two namespaces into its browser payload for a page that renders
 * neither (`.debug/008` — `tests/unit/i18n/client-namespaces.test.ts` says so
 * by name). Like `GuideContent` it therefore carries no `server-only` import of
 * its own either: that specifier does not resolve in the jsdom test tier, and
 * the barrel is what states the boundary for the files that go through it.
 *
 * Both legal routes render this, so the two pages differ in nothing but which
 * document they look up and what their `generateMetadata` says.
 *
 * ## The element map
 *
 * `styles/globals.css` styles the document, not prose: outside a component,
 * Tailwind's preflight leaves `<h2>`, `<ul>` and `<a>` unstyled. Guides get
 * their rhythm from `<Step>`; a legal page is bare markdown, so the elements it
 * actually uses are mapped here. The map is closed on purpose — an element a
 * legal document starts using appears unstyled, which is visible, rather than
 * being silently approximated.
 */
const legalComponents = {
  h2: (props: React.ComponentPropsWithoutRef<"h2">) => (
    <h2 {...props} className="mt-10 text-2xl font-semibold first:mt-0" />
  ),
  h3: (props: React.ComponentPropsWithoutRef<"h3">) => (
    <h3 {...props} className="mt-6 text-lg font-semibold" />
  ),
  p: (props: React.ComponentPropsWithoutRef<"p">) => <p {...props} className="mt-4" />,
  ul: (props: React.ComponentPropsWithoutRef<"ul">) => (
    <ul {...props} className="mt-4 flex list-disc flex-col gap-2 pl-5" />
  ),
  ol: (props: React.ComponentPropsWithoutRef<"ol">) => (
    <ol {...props} className="mt-4 flex list-decimal flex-col gap-2 pl-5" />
  ),
  a: (props: React.ComponentPropsWithoutRef<"a">) => (
    <a {...props} className="text-accent underline underline-offset-4 hover:no-underline" />
  ),
  code: (props: React.ComponentPropsWithoutRef<"code">) => (
    <code {...props} className="bg-paper-2 rounded px-1 py-0.5 text-[0.9em]" />
  ),
  hr: (props: React.ComponentPropsWithoutRef<"hr">) => (
    <hr {...props} className="border-rule my-8" />
  ),
};

export interface LegalContentProps {
  document: LegalDocument;
  /** `seo.legal.updated` already rendered with its date — the page formats it. */
  updatedLabel: string;
  /** `<h1>`'s id, so the `<article>` can be labelled by it. */
  headingId: string;
}

export function LegalContent({
  document,
  updatedLabel,
  headingId,
}: LegalContentProps): React.JSX.Element {
  return (
    <article
      aria-labelledby={headingId}
      data-testid="legal-page"
      data-legal-id={document.id}
      className="mx-auto flex w-full max-w-3xl flex-col px-4 py-8 sm:py-12"
    >
      <h1 id={headingId} className="text-3xl font-semibold sm:text-4xl">
        {document.title}
      </h1>
      <p className="text-ink-muted mt-2 text-sm">
        <time dateTime={document.updatedAt} data-testid="legal-updated">
          {updatedLabel}
        </time>
      </p>
      <div className="mt-8 leading-relaxed">
        <MDXContent code={document.mdx} components={legalComponents} />
      </div>
    </article>
  );
}
