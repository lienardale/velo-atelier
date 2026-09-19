/**
 * `JsonLd` — the escaping, and the fact that the escaping is the only defence.
 *
 * React does NOT HTML-escape the children of a `<script>` (it is a raw-text
 * element; escaping would corrupt the JSON), so whatever string this component
 * produces is what an HTML parser sees. A `</script` anywhere inside it — in a
 * guide title, in a URL — would end the element early and drop the rest of the
 * document into the page as markup. That is the whole reason `serializeJsonLd`
 * exists, and why it is tested at the string level rather than through a DOM:
 * jsdom has already parsed the escape away by the time a test can read it.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { JsonLd, serializeJsonLd, techArticle } from "./JsonLd";

const BREAKOUTS = ["</script><script>alert(1)</script>", "<!--<script>", "</ScRiPt >"] as const;

describe("serializeJsonLd", () => {
  it("escapes every `<`, and only `<`", () => {
    const json = serializeJsonLd({
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: "a < b & c > d",
    });

    expect(json).not.toContain("<");
    expect(json).toContain("\\u003c");
    // `&` and `>` are untouched: neither can close a script element.
    expect(json).toContain("& c > d");
  });

  it("stays valid JSON that parses back to the same data", () => {
    const data = {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: BREAKOUTS[0],
    } as const;

    expect(JSON.parse(serializeJsonLd(data))).toEqual(data);
  });

  it.each(BREAKOUTS)("cannot close the element from inside a value (%s)", (payload) => {
    const markup = renderToStaticMarkup(
      <JsonLd
        data={{ "@context": "https://schema.org", "@type": "TechArticle", headline: payload }}
      />,
    );

    // Exactly one opening and one closing tag: the payload produced neither.
    expect(markup.match(/<script/gi)).toHaveLength(1);
    expect(markup.match(/<\/script/gi)).toHaveLength(1);
    expect(markup.startsWith('<script type="application/ld+json"')).toBe(true);
    expect(markup.endsWith("</script>")).toBe(true);
  });

  it("is rendered as a text child, so React hands the JSON through unaltered", () => {
    const markup = renderToStaticMarkup(
      <JsonLd
        data={{ "@context": "https://schema.org", "@type": "TechArticle", headline: "Ren & Co" }}
      />,
    );

    // An HTML-escaped `&` here would mean React was escaping the body — which
    // would also corrupt the JSON.
    expect(markup).toContain('"headline":"Ren & Co"');
    expect(markup).not.toContain("&amp;");
  });
});

describe("techArticle", () => {
  const input = {
    headline: "Nettoyer la chaîne",
    description: "Dégraisser puis lubrifier.",
    url: "https://velo-atelier.test/fr/guides/clean-chain",
    inLanguage: "fr",
    publisherName: "vélo-atelier",
    publisherUrl: "https://github.com/lienardale/velo-atelier",
  };

  it("is a schema.org TechArticle with the CC BY-SA licence of content/", () => {
    const node = techArticle(input);

    expect(node["@context"]).toBe("https://schema.org");
    expect(node["@type"]).toBe("TechArticle");
    expect(node.license).toBe("https://creativecommons.org/licenses/by-sa/4.0/");
    expect(node.isAccessibleForFree).toBe(true);
    expect(node.publisher).toEqual({
      "@type": "Organization",
      name: "vélo-atelier",
      url: input.publisherUrl,
    });
  });

  it("turns the frontmatter's minutes into an ISO 8601 duration", () => {
    expect(techArticle({ ...input, totalTimeMinutes: 20 }).totalTime).toBe("PT20M");
  });

  it("omits the optional fields rather than serialising nulls", () => {
    const node = techArticle(input);

    expect(Object.keys(node)).not.toContain("totalTime");
    expect(Object.keys(node)).not.toContain("proficiencyLevel");
  });
});
