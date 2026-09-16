/**
 * The frontmatter splitter shared by the content check, the tests and the
 * `/guides` filter index (§5.1). None of them depends on the build output of
 * content-collections, so a broken MDX body can never hide a frontmatter error
 * (or the reverse).
 *
 * A guide file is:
 *
 *   ---            ← line 1, exactly three dashes
 *   kind: check    ← YAML
 *   ---
 *   <Step id="…">  ← MDX body
 *
 * `yaml` (not gray-matter) parses the block, keeping source ranges so every
 * problem can be reported as `file:line`.
 *
 * Plain Node, no `server-only` (`tests/unit/no-server-only-in-scripts.test.ts`).
 */
import { isMap, isScalar, isSeq, parseDocument, type Document } from "yaml";

export interface SplitFrontmatter {
  /** The raw YAML between the fences (no fences). */
  yaml: string;
  /** Everything after the closing fence. */
  body: string;
  /** 1-based line of the first YAML line in the file. */
  yamlStartLine: number;
  /** 1-based line of the first body line in the file. */
  bodyStartLine: number;
}

const FENCE = /^---[ \t]*$/;

/** Split a file into its YAML block and its body, or `null` when there is no well-formed block. */
export function splitFrontmatter(source: string): SplitFrontmatter | null {
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.length === 0 || !FENCE.test(lines[0])) return null;
  const close = lines.findIndex((line, index) => index > 0 && FENCE.test(line));
  if (close === -1) return null;
  return {
    yaml: lines.slice(1, close).join("\n"),
    body: lines.slice(close + 1).join("\n"),
    yamlStartLine: 2,
    bodyStartLine: close + 2,
  };
}

export interface ParsedFrontmatter extends SplitFrontmatter {
  /** The YAML as plain data (`undefined` when the YAML itself failed to parse). */
  data: unknown;
  /** YAML syntax errors, already located in the file. */
  errors: Array<{ line: number; message: string }>;
  /** 1-based file line of the node at `path` — the closest existing ancestor otherwise. */
  lineOf: (path: ReadonlyArray<PropertyKey>) => number;
}

/** Split and parse. Returns `null` only when the file has no frontmatter fences. */
export function parseFrontmatter(source: string): ParsedFrontmatter | null {
  const split = splitFrontmatter(source);
  if (!split) return null;

  const document = parseDocument(split.yaml, { prettyErrors: false, uniqueKeys: true });
  const lineStarts = lineStartOffsets(split.yaml);
  const toFileLine = (offset: number) => split.yamlStartLine + lineIndexAt(lineStarts, offset);

  const errors = document.errors.map((error) => ({
    line: toFileLine(error.pos[0]),
    message: `invalid YAML: ${error.message.split("\n")[0]}`,
  }));

  return {
    ...split,
    data: errors.length > 0 ? undefined : document.toJS(),
    errors,
    lineOf: (path) => toFileLine(offsetOf(document, path)),
  };
}

/** The start offset of the deepest node of `path` that exists (0 for the document). */
function offsetOf(document: Document, path: ReadonlyArray<PropertyKey>): number {
  let offset = document.contents?.range?.[0] ?? 0;
  let node: unknown = document.contents;

  for (const segment of path) {
    if (isMap(node)) {
      const pair = node.items.find((item) => isScalar(item.key) && item.key.value === segment);
      if (!pair) break;
      const key = pair.key as { range?: [number, number, number] };
      offset = key.range?.[0] ?? offset;
      node = pair.value;
    } else if (isSeq(node) && typeof segment === "number") {
      const item = node.items.at(segment) as { range?: [number, number, number] } | undefined;
      if (!item) break;
      offset = item.range?.[0] ?? offset;
      node = item;
    } else {
      break;
    }
  }
  return offset;
}

function lineStartOffsets(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

/** 0-based line index containing `offset` (binary search over line starts). */
function lineIndexAt(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    // eslint-disable-next-line security/detect-object-injection -- numeric index within bounds
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** 1-based line of `offset` inside `text`, offset by `firstLine - 1`. */
export function lineAt(text: string, offset: number, firstLine = 1): number {
  return firstLine + lineIndexAt(lineStartOffsets(text), offset);
}
