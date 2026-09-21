/**
 * Recording, in-memory stand-in for the Prisma client (§4.4).
 *
 * `tests/setup.fake-db.ts` mocks `@/lib/db/prisma` with `fakeDb.client` for the
 * unit, ui and security tiers, so server actions run against it with no
 * database. Two things make it more than a stub:
 *
 * 1. **It records every call** as `{ model, op, args }` in `fakeDb.calls`.
 *    Security tests assert on the *shape* of what the code asked for —
 *    `expectScopedToUser(calls, userId)` fails unless every read and write of
 *    user-owned data carries the ownership predicate (`userId`, or the nested
 *    `bike: { userId }`), which is the IDOR control (§4.7). The N+1 guard in
 *    `tests/unit/bike/load-bike.test.ts` counts the same entries
 *    (`countQueries()` in tests/_fakes/db.ts).
 *
 * 2. **It behaves like Postgres where behaviour is the point**: it is driven by
 *    `prisma/schema.prisma` itself (parsed at import — no hand-copied model
 *    list to drift), so defaults (`uuid`, `now()`, enum defaults,
 *    `@updatedAt`), unique constraints (P2002, compound keys included, `citext`
 *    compared case-insensitively), foreign keys (P2003), missing rows (P2025),
 *    `onDelete: Cascade | SetNull`, relation filters (`is`/`some`/`every`/`none`),
 *    `select`/`include`, and transactions with rollback all match the real
 *    thing. The integration tier is where the real thing is checked.
 *
 * Anything it does not model throws `FakePrismaUnsupportedError` naming the
 * feature, rather than returning a plausible wrong answer. Extend it here.
 *
 * Usage:
 *
 *   import { fakeDb, expectScopedToUser } from "@/tests/_fakes/prisma";
 *   const user = await fakeDb.seed("user", { email: "a@velo-atelier.test" });
 *   fakeDb.calls.length = 0;                 // or fakeDb.resetCalls()
 *   await someAction(...);
 *   expectScopedToUser(fakeDb.calls, user.id);
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import type { PrismaClient } from "@/lib/generated/prisma/client";

// ─────────────────────────────────────────────────────────────── schema model ──

type ScalarDefault =
  | { kind: "uuid" }
  | { kind: "now" }
  | { kind: "autoincrement" }
  | { kind: "value"; value: unknown };

interface RelationSpec {
  fields: string[];
  references: string[];
  onDelete?: string;
  name?: string;
}

export interface FieldMeta {
  name: string;
  type: string;
  kind: "scalar" | "enum" | "object";
  list: boolean;
  optional: boolean;
  citext: boolean;
  updatedAt: boolean;
  default?: ScalarDefault;
  relation?: RelationSpec;
}

export interface ModelMeta {
  name: string;
  /** Client delegate name: `BikePartState` → `bikePartState`. */
  delegate: string;
  fields: Map<string, FieldMeta>;
  /** Primary key fields (single `@id` or `@@id([...])`). */
  idFields: string[];
  /** Every unique constraint, primary key first. */
  uniques: string[][];
}

const SCHEMA_PATH = join(process.cwd(), "prisma", "schema.prisma");

function stripComments(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      let inString = false;
      for (let i = 0; i < line.length - 1; i++) {
        if (line[i] === '"' && line[i - 1] !== "\\") inString = !inString;
        if (!inString && line[i] === "/" && line[i + 1] === "/") return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

/** Contents of the balanced parentheses following `attr` (e.g. `@default(`) in `text`. */
function attributeArgs(text: string, attr: string): string | undefined {
  const start = text.indexOf(`${attr}(`);
  if (start === -1) return undefined;
  let depth = 0;
  for (let i = start + attr.length; i < text.length; i++) {
    if (text[i] === "(") depth++;
    if (text[i] === ")") depth--;
    if (depth === 0) return text.slice(start + attr.length + 1, i);
  }
  return undefined;
}

function listArg(args: string, name: string): string[] | undefined {
  const match = new RegExp(`${name}\\s*:\\s*\\[([^\\]]*)\\]`).exec(args);
  return match?.[1]
    .split(",")
    .map((s) => s.trim().replace(/\(.*\)$/, ""))
    .filter(Boolean);
}

function parseDefault(args: string, enumValues: ReadonlySet<string>): ScalarDefault {
  const value = args.trim();
  if (/^(dbgenerated\("gen_random_uuid\(\)"\)|uuid\(.*\)|cuid\(.*\))$/.test(value)) {
    return { kind: "uuid" };
  }
  if (value === "now()") return { kind: "now" };
  if (value === "autoincrement()") return { kind: "autoincrement" };
  if (value === "true" || value === "false") return { kind: "value", value: value === "true" };
  if (/^-?\d+(\.\d+)?$/.test(value)) return { kind: "value", value: Number(value) };
  if (/^".*"$/.test(value)) return { kind: "value", value: value.slice(1, -1) };
  if (enumValues.has(value)) return { kind: "value", value };
  // A scalar list's `@default([])` (`CheckupItem.reasonKeys`). Postgres fills
  // the column with an empty array; `insert` clones it per row.
  if (value === "[]") return { kind: "value", value: [] };
  throw new FakePrismaUnsupportedError(`@default(${value}) in prisma/schema.prisma`);
}

function parseSchema(source: string): Map<string, ModelMeta> {
  const clean = stripComments(source);
  const blocks = [...clean.matchAll(/\b(model|enum)\s+(\w+)\s*\{([^}]*)\}/g)];

  const enums = new Map<string, Set<string>>();
  for (const [, keyword, name, body] of blocks) {
    if (keyword !== "enum") continue;
    enums.set(name, new Set(body.split(/\s+/).filter((token) => /^\w+$/.test(token))));
  }
  const allEnumValues = new Set([...enums.values()].flatMap((values) => [...values]));
  const modelNames = new Set(blocks.filter(([, kw]) => kw === "model").map(([, , name]) => name));

  const models = new Map<string, ModelMeta>();
  for (const [, keyword, name, body] of blocks) {
    if (keyword !== "model") continue;
    const fields = new Map<string, FieldMeta>();
    let idFields: string[] = [];
    const compoundUniques: string[][] = [];

    for (const raw of body.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("@@")) {
        const args = attributeArgs(line, line.startsWith("@@id") ? "@@id" : "@@unique");
        const list = args ? /^\s*\[([^\]]*)\]/.exec(args)?.[1] : undefined;
        const names = list?.split(",").map((s) => s.trim().replace(/\(.*\)$/, "")) ?? [];
        if (line.startsWith("@@id")) idFields = names;
        else if (line.startsWith("@@unique")) compoundUniques.push(names);
        continue;
      }
      const match = /^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/.exec(line);
      if (!match) continue;
      const [, fieldName, type, list, optional, attrs] = match;
      const kind = enums.has(type) ? "enum" : modelNames.has(type) ? "object" : "scalar";
      const field: FieldMeta = {
        name: fieldName,
        type,
        kind,
        list: Boolean(list),
        optional: Boolean(optional),
        citext: /@db\.Citext\b/.test(attrs),
        updatedAt: /@updatedAt\b/.test(attrs),
      };
      const defaultArgs = attributeArgs(attrs, "@default");
      if (defaultArgs !== undefined) field.default = parseDefault(defaultArgs, allEnumValues);
      const relationArgs = attributeArgs(attrs, "@relation");
      if (relationArgs !== undefined) {
        field.relation = {
          fields: listArg(relationArgs, "fields") ?? [],
          references: listArg(relationArgs, "references") ?? [],
          onDelete: /onDelete\s*:\s*(\w+)/.exec(relationArgs)?.[1],
          name: /^\s*"([^"]+)"/.exec(relationArgs)?.[1],
        };
      }
      if (/@id\b/.test(attrs)) idFields = [fieldName];
      if (/@unique\b/.test(attrs)) compoundUniques.push([fieldName]);
      fields.set(fieldName, field);
    }

    models.set(name, {
      name,
      delegate: name.charAt(0).toLowerCase() + name.slice(1),
      fields,
      idFields,
      uniques: [idFields, ...compoundUniques].filter((key) => key.length > 0),
    });
  }
  return models;
}

// ───────────────────────────────────────────────────────────────────── errors ──

/** Mirrors `PrismaClientKnownRequestError`'s wire contract (`code`, `meta`). */
export class FakePrismaKnownRequestError extends Error {
  readonly code: string;
  readonly meta: Record<string, unknown>;
  readonly clientVersion = "fake";

  constructor(code: string, message: string, meta: Record<string, unknown> = {}) {
    super(message);
    this.name = "PrismaClientKnownRequestError";
    this.code = code;
    this.meta = meta;
  }
}

/** The fake was asked for something it does not model. Extend this file. */
export class FakePrismaUnsupportedError extends Error {
  constructor(feature: string) {
    super(`tests/_fakes/prisma.ts does not support ${feature} — extend the fake.`);
    this.name = "FakePrismaUnsupportedError";
  }
}

// ──────────────────────────────────────────────────────────────── the client ──

type Row = Record<string, unknown>;
type Args = Record<string, unknown>;

export interface FakeCall {
  /** Delegate name (`bike`, `bikePartState`) or `$client` for raw / transaction calls. */
  model: string;
  op: string;
  args: unknown;
}

type RawHandler = (sql: string, values: unknown[]) => unknown;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !(value instanceof Date) && !Array.isArray(value);

const clone = <T>(value: T): T => structuredClone(value);

/**
 * A Prisma-style lazy promise: the operation runs when first awaited, which is
 * what lets `$transaction([a, b])` snapshot the store before `a` runs.
 */
class LazyPrismaPromise<T> implements PromiseLike<T> {
  private promise: Promise<T> | undefined;
  readonly [Symbol.toStringTag] = "PrismaPromise";

  constructor(private readonly run: () => Promise<T>) {}

  private start(): Promise<T> {
    this.promise ??= this.run();
    return this.promise;
  }

  then<A = T, B = never>(
    onfulfilled?: ((value: T) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this.start().then(onfulfilled, onrejected);
  }

  catch<B = never>(onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null) {
    return this.start().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null) {
    return this.start().finally(onfinally);
  }
}

export interface FakeDb {
  /** Drop-in for the `prisma` export of `@/lib/db/prisma`. */
  client: PrismaClient;
  /** Every call, in order. Mutable: `calls.length = 0` is fine. */
  calls: FakeCall[];
  /** Parsed `prisma/schema.prisma`, keyed by model name. */
  models: ReadonlyMap<string, ModelMeta>;
  /** Current rows of a model (deep copies). */
  rows(model: string): Row[];
  /** Insert rows without recording calls; defaults and constraints still apply. */
  seed(model: string, data: Args): Promise<Row>;
  seed(model: string, data: Args[]): Promise<Row[]>;
  /** Answer `$queryRaw` / `$executeRaw` (default: `[]` / `0`). */
  onRaw(handler: RawHandler): void;
  resetCalls(): void;
  /** Empty every table, forget calls and raw handlers. */
  reset(): void;
}

export function createFakeDb(schemaSource = readFileSync(SCHEMA_PATH, "utf8")): FakeDb {
  const models = parseSchema(schemaSource);
  const byDelegate = new Map([...models.values()].map((meta) => [meta.delegate, meta]));
  let tables: Record<string, Row[]> = Object.fromEntries([...models.keys()].map((m) => [m, []]));
  let sequence = 0;
  const calls: FakeCall[] = [];
  let rawHandler: RawHandler | undefined;

  const modelOf = (nameOrDelegate: string): ModelMeta => {
    const meta = models.get(nameOrDelegate) ?? byDelegate.get(nameOrDelegate);
    if (!meta) throw new Error(`fake prisma: unknown model "${nameOrDelegate}"`);
    return meta;
  };

  // ── relations ─────────────────────────────────────────────────────────────

  /** For an object field, the owning side's fk/reference pairs and which side holds the fk. */
  function relationLink(model: ModelMeta, field: FieldMeta) {
    const target = modelOf(field.type);
    if (field.relation?.fields.length) {
      return { target, local: field.relation.fields, remote: field.relation.references };
    }
    const owning = [...target.fields.values()].find(
      (candidate) =>
        candidate.kind === "object" &&
        candidate.type === model.name &&
        candidate.relation?.fields.length &&
        (field.relation?.name === undefined || candidate.relation.name === field.relation.name),
    );
    if (!owning?.relation) {
      throw new FakePrismaUnsupportedError(`the relation ${model.name}.${field.name}`);
    }
    return { target, local: owning.relation.references, remote: owning.relation.fields };
  }

  function related(model: ModelMeta, row: Row, field: FieldMeta): Row[] {
    const { target, local, remote } = relationLink(model, field);
    if (local.some((key) => row[key] === null || row[key] === undefined)) return [];
    return tables[target.name].filter((candidate) =>
      remote.every((key, i) => equalValues(candidate[key], row[local[i]], false)),
    );
  }

  // ── filtering ─────────────────────────────────────────────────────────────

  function equalValues(a: unknown, b: unknown, citext: boolean): boolean {
    if (a === undefined) a = null;
    if (b === undefined) b = null;
    if (a instanceof Date || b instanceof Date) {
      return new Date(a as Date).getTime() === new Date(b as Date).getTime();
    }
    if (citext && typeof a === "string" && typeof b === "string") {
      return a.toLowerCase() === b.toLowerCase();
    }
    return isDeepStrictEqual(a, b);
  }

  /** Orders like Postgres under the C collation the Docker image is initialised with. */
  function compare(a: unknown, b: unknown): number {
    const normalise = (value: unknown, other: unknown) =>
      value instanceof Date
        ? value.getTime()
        : typeof value === "string" && other instanceof Date
          ? new Date(value).getTime()
          : value;
    const left = normalise(a, b);
    const right = normalise(b, a);
    if (typeof left === "string" && typeof right === "string") {
      return left < right ? -1 : left > right ? 1 : 0;
    }
    return (left as number) - (right as number);
  }

  function matchScalar(field: FieldMeta, value: unknown, condition: unknown): boolean {
    const citext = field.citext;
    if (!isObject(condition)) return equalValues(value, condition, citext);
    const insensitive = condition.mode === "insensitive" || citext;
    const text = (v: unknown) => (insensitive ? String(v).toLowerCase() : String(v));
    return Object.entries(condition).every(([op, operand]) => {
      switch (op) {
        case "mode":
          return true;
        case "equals":
          return equalValues(value, operand, citext);
        case "not":
          return isObject(operand)
            ? !matchScalar(field, value, operand)
            : !equalValues(value, operand, citext);
        case "in":
          return (operand as unknown[]).some((v) => equalValues(value, v, citext));
        case "notIn":
          return !(operand as unknown[]).some((v) => equalValues(value, v, citext));
        case "lt":
          return value !== null && compare(value, operand) < 0;
        case "lte":
          return value !== null && compare(value, operand) <= 0;
        case "gt":
          return value !== null && compare(value, operand) > 0;
        case "gte":
          return value !== null && compare(value, operand) >= 0;
        case "contains":
          return value !== null && text(value).includes(text(operand));
        case "startsWith":
          return value !== null && text(value).startsWith(text(operand));
        case "endsWith":
          return value !== null && text(value).endsWith(text(operand));
        default:
          throw new FakePrismaUnsupportedError(`the "${op}" filter on ${field.name}`);
      }
    });
  }

  function matches(model: ModelMeta, row: Row, where: unknown): boolean {
    if (where === undefined || where === null) return true;
    if (!isObject(where)) throw new Error(`fake prisma: invalid where on ${model.name}`);
    return Object.entries(where).every(([key, condition]) => {
      if (condition === undefined) return true;
      if (key === "AND") {
        const list = Array.isArray(condition) ? condition : [condition];
        return list.every((w) => matches(model, row, w));
      }
      if (key === "OR") return (condition as unknown[]).some((w) => matches(model, row, w));
      if (key === "NOT") {
        const list = Array.isArray(condition) ? condition : [condition];
        return list.every((w) => !matches(model, row, w));
      }
      const field = model.fields.get(key);
      if (!field) {
        const compound = model.uniques.find((u) => u.length > 1 && u.join("_") === key);
        if (compound && isObject(condition)) {
          return compound.every((name) =>
            equalValues(row[name], condition[name], Boolean(model.fields.get(name)?.citext)),
          );
        }
        throw new Error(`fake prisma: unknown field "${key}" in where on ${model.name}`);
      }
      if (field.kind !== "object") return matchScalar(field, row[key], condition);

      const rows = related(model, row, field);
      if (field.list) {
        if (!isObject(condition)) throw new Error(`fake prisma: invalid filter on ${key}`);
        const target = modelOf(field.type);
        return Object.entries(condition).every(([op, inner]) => {
          if (op === "some") return rows.some((r) => matches(target, r, inner));
          if (op === "every") return rows.every((r) => matches(target, r, inner));
          if (op === "none") return !rows.some((r) => matches(target, r, inner));
          throw new FakePrismaUnsupportedError(`the "${op}" list-relation filter`);
        });
      }
      const target = modelOf(field.type);
      const one = rows[0];
      if (condition === null) return one === undefined;
      if (isObject(condition) && ("is" in condition || "isNot" in condition)) {
        if ("is" in condition) {
          return condition.is === null ? !one : Boolean(one) && matches(target, one, condition.is);
        }
        return condition.isNot === null
          ? Boolean(one)
          : !one || !matches(target, one, condition.isNot);
      }
      return Boolean(one) && matches(target, one, condition);
    });
  }

  // ── projection ────────────────────────────────────────────────────────────

  function applyListArgs(model: ModelMeta, rows: Row[], args: Args): Row[] {
    let result = rows.filter((row) => matches(model, row, args.where));
    if (args.cursor !== undefined) throw new FakePrismaUnsupportedError("cursor pagination");
    if (args.distinct !== undefined) throw new FakePrismaUnsupportedError("distinct");
    if (args.orderBy !== undefined) {
      const orders = (Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy]) as Args[];
      result = [...result].sort((a, b) => {
        for (const order of orders) {
          for (const [key, spec] of Object.entries(order)) {
            const direction = isObject(spec) ? spec.sort : spec;
            if (model.fields.get(key)?.kind === "object") {
              throw new FakePrismaUnsupportedError("ordering by a relation");
            }
            const x = a[key] ?? null;
            const y = b[key] ?? null;
            if (x === y) continue;
            // Postgres default: NULLS LAST ascending, NULLS FIRST descending.
            const cmp = x === null ? 1 : y === null ? -1 : compare(x, y);
            if (cmp !== 0) return direction === "desc" ? -cmp : cmp;
          }
        }
        return 0;
      });
    }
    const skip = (args.skip as number | undefined) ?? 0;
    const take = args.take as number | undefined;
    if (take !== undefined && take < 0) throw new FakePrismaUnsupportedError("negative take");
    return result.slice(skip, take === undefined ? undefined : skip + take);
  }

  function project(model: ModelMeta, row: Row, args: Args = {}): Row {
    const out: Row = {};
    const select = args.select as Args | undefined;
    const include = args.include as Args | undefined;
    if (select && include) throw new Error("fake prisma: select and include are exclusive");

    const scalarNames = [...model.fields.values()]
      .filter((field) => field.kind !== "object")
      .map((field) => field.name);
    const wanted = select
      ? Object.entries(select).filter(([, v]) => v)
      : [...scalarNames.map((name) => [name, true] as const), ...Object.entries(include ?? {})];

    for (const [key, spec] of wanted) {
      if (!spec) continue;
      if (key === "_count") {
        const countSelect = (isObject(spec) ? spec.select : undefined) as Args | undefined;
        const names = countSelect
          ? Object.keys(countSelect).filter((k) => countSelect[k])
          : [...model.fields.values()].filter((f) => f.list).map((f) => f.name);
        out._count = Object.fromEntries(
          names.map((name) => {
            const field = model.fields.get(name)!;
            const inner = countSelect?.[name];
            const whereInner = isObject(inner) ? inner.where : undefined;
            const target = modelOf(field.type);
            return [
              name,
              related(model, row, field).filter((r) => matches(target, r, whereInner)).length,
            ];
          }),
        );
        continue;
      }
      const field = model.fields.get(key);
      if (!field) throw new Error(`fake prisma: unknown field "${key}" in select on ${model.name}`);
      if (field.kind !== "object") {
        out[key] = clone(row[key] ?? null);
        continue;
      }
      const target = modelOf(field.type);
      const nested = isObject(spec) ? spec : {};
      const rows = related(model, row, field);
      if (field.list) {
        out[key] = applyListArgs(target, rows, nested).map((r) => project(target, r, nested));
      } else {
        out[key] = rows[0] ? project(target, rows[0], nested) : null;
      }
    }
    return out;
  }

  // ── writes ────────────────────────────────────────────────────────────────

  function coerce(field: FieldMeta, value: unknown): unknown {
    if (value === undefined) return undefined;
    if (field.type === "DateTime" && typeof value === "string") return new Date(value);
    if (field.type === "Json") return value === null ? null : clone(value);
    // A scalar list is a copy in Postgres too: the caller's array must not
    // alias the stored row.
    if (field.list && Array.isArray(value)) return clone(value);
    return value;
  }

  function assertUnique(model: ModelMeta, row: Row, except?: Row): void {
    for (const key of model.uniques) {
      if (key.some((name) => row[name] === null || row[name] === undefined)) continue;
      const clash = tables[model.name].find(
        (other) =>
          other !== except &&
          key.every((name) =>
            equalValues(other[name], row[name], Boolean(model.fields.get(name)?.citext)),
          ),
      );
      if (clash) {
        throw new FakePrismaKnownRequestError(
          "P2002",
          `Unique constraint failed on the fields: (${key.map((k) => `\`${k}\``).join(",")})`,
          { modelName: model.name, target: key },
        );
      }
    }
  }

  function assertForeignKeys(model: ModelMeta, row: Row): void {
    for (const field of model.fields.values()) {
      if (field.kind !== "object" || !field.relation?.fields.length) continue;
      const { fields, references } = field.relation;
      if (fields.some((name) => row[name] === null || row[name] === undefined)) continue;
      const exists = tables[field.type].some((candidate) =>
        references.every((ref, i) => equalValues(candidate[ref], row[fields[i]], false)),
      );
      if (!exists) {
        throw new FakePrismaKnownRequestError(
          "P2003",
          `Foreign key constraint violated on the constraint: \`${model.name}_${fields.join("_")}_fkey\``,
          { modelName: model.name, field_name: fields.join(",") },
        );
      }
    }
  }

  function notFound(model: ModelMeta, op: string): FakePrismaKnownRequestError {
    return new FakePrismaKnownRequestError(
      "P2025",
      `An operation failed because it depends on one or more records that were required but not found. No record was found for a ${op} on ${model.name}.`,
      { modelName: model.name, cause: `No record was found for a ${op}.` },
    );
  }

  function connectTarget(field: FieldMeta, where: unknown): Row {
    const target = modelOf(field.type);
    const found = tables[target.name].find((row) => matches(target, row, where));
    if (!found) throw notFound(target, "connect");
    return found;
  }

  function insert(model: ModelMeta, data: Args): Row {
    const row: Row = {};
    const now = new Date();
    const nestedLists: Array<[FieldMeta, Args]> = [];

    for (const [key, value] of Object.entries(data)) {
      const field = model.fields.get(key);
      if (!field) throw new Error(`fake prisma: unknown field "${key}" in create on ${model.name}`);
      if (field.kind !== "object") continue;
      if (!isObject(value)) throw new Error(`fake prisma: invalid relation input for ${key}`);
      if (field.list) {
        nestedLists.push([field, value]);
        continue;
      }
      if (!field.relation?.fields.length || !("connect" in value)) {
        throw new FakePrismaUnsupportedError(`nested "${Object.keys(value)}" on ${key}`);
      }
      const target = connectTarget(field, value.connect);
      field.relation.fields.forEach((fk, i) => {
        row[fk] = target[field.relation!.references[i]];
      });
    }

    for (const field of model.fields.values()) {
      if (field.kind === "object") continue;
      if (field.name in row) continue;
      const given = coerce(field, data[field.name]);
      if (given !== undefined) row[field.name] = given;
      else if (field.updatedAt) row[field.name] = now;
      else if (field.default?.kind === "uuid") row[field.name] = randomUUID();
      else if (field.default?.kind === "now") row[field.name] = now;
      else if (field.default?.kind === "autoincrement") row[field.name] = ++sequence;
      else if (field.default?.kind === "value") row[field.name] = clone(field.default.value);
      else if (field.optional || field.list) row[field.name] = field.list ? [] : null;
      else {
        throw new Error(
          `fake prisma: Argument \`${field.name}\` is missing in ${model.name}.create()`,
        );
      }
    }

    assertUnique(model, row);
    assertForeignKeys(model, row);
    tables[model.name].push(row);

    for (const [field, input] of nestedLists) writeNestedList(model, row, field, input);
    return row;
  }

  function writeNestedList(model: ModelMeta, parent: Row, field: FieldMeta, input: Args): void {
    const { target, local, remote } = relationLink(model, field);
    const withFk = (child: Args): Args => ({
      ...child,
      ...Object.fromEntries(remote.map((fk, i) => [fk, parent[local[i]]])),
    });
    for (const [op, value] of Object.entries(input)) {
      if (op === "create") {
        for (const child of Array.isArray(value) ? value : [value]) insert(target, withFk(child));
      } else if (op === "createMany") {
        const { data, skipDuplicates } = value as { data: Args | Args[]; skipDuplicates?: boolean };
        for (const child of Array.isArray(data) ? data : [data]) {
          try {
            insert(target, withFk(child));
          } catch (error) {
            if (!(skipDuplicates && (error as { code?: string }).code === "P2002")) throw error;
          }
        }
      } else if (op === "deleteMany") {
        const children = related(model, parent, field);
        const filters = Array.isArray(value) ? value : [value === true ? {} : value];
        for (const child of children) {
          if (filters.some((w) => matches(target, child, w))) remove(target, child);
        }
      } else {
        throw new FakePrismaUnsupportedError(`nested "${op}" on ${model.name}.${field.name}`);
      }
    }
  }

  function applyUpdate(model: ModelMeta, row: Row, data: Args): void {
    const next: Row = { ...row };
    const nestedLists: Array<[FieldMeta, Args]> = [];
    let touchedUpdatedAt = false;

    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      const field = model.fields.get(key);
      if (!field) throw new Error(`fake prisma: unknown field "${key}" in update on ${model.name}`);
      if (field.kind === "object") {
        if (!isObject(value)) throw new Error(`fake prisma: invalid relation input for ${key}`);
        if (field.list) {
          nestedLists.push([field, value]);
          continue;
        }
        const fks = field.relation?.fields ?? [];
        if ("connect" in value && fks.length) {
          const target = connectTarget(field, value.connect);
          fks.forEach((fk, i) => (next[fk] = target[field.relation!.references[i]]));
        } else if ("disconnect" in value && fks.length && field.optional) {
          fks.forEach((fk) => (next[fk] = null));
        } else {
          throw new FakePrismaUnsupportedError(`nested "${Object.keys(value)}" on ${key}`);
        }
        continue;
      }
      if (field.updatedAt) touchedUpdatedAt = true;
      if (isObject(value) && field.type !== "Json") {
        const current = next[key] as number;
        const [[op, operand]] = Object.entries(value) as [[string, unknown]];
        if (op === "set") next[key] = coerce(field, operand);
        else if (op === "increment") next[key] = current + (operand as number);
        else if (op === "decrement") next[key] = current - (operand as number);
        else if (op === "multiply") next[key] = current * (operand as number);
        else if (op === "divide") next[key] = current / (operand as number);
        else throw new FakePrismaUnsupportedError(`the "${op}" update operator`);
      } else {
        next[key] = coerce(field, value);
      }
    }

    if (!touchedUpdatedAt) {
      for (const field of model.fields.values()) if (field.updatedAt) next[field.name] = new Date();
    }
    assertUnique(model, next, row);
    assertForeignKeys(model, next);
    Object.assign(row, next);
    for (const [field, input] of nestedLists) writeNestedList(model, row, field, input);
  }

  /** Delete one row, applying `onDelete` on every relation that points at it. */
  function remove(model: ModelMeta, row: Row): void {
    for (const child of models.values()) {
      for (const field of child.fields.values()) {
        if (
          field.kind !== "object" ||
          field.type !== model.name ||
          !field.relation?.fields.length
        ) {
          continue;
        }
        const { fields, references, onDelete } = field.relation;
        const dependants = tables[child.name].filter((candidate) =>
          fields.every((fk, i) => equalValues(candidate[fk], row[references[i]], false)),
        );
        if (dependants.length === 0) continue;
        if (onDelete === "Cascade") {
          for (const dependant of dependants) remove(child, dependant);
        } else if (onDelete === "SetNull") {
          for (const dependant of dependants) for (const fk of fields) dependant[fk] = null;
        } else {
          throw new FakePrismaKnownRequestError(
            "P2003",
            `Foreign key constraint violated on the constraint: \`${child.name}_${fields.join("_")}_fkey\``,
            { modelName: model.name, field_name: fields.join(",") },
          );
        }
      }
    }
    tables[model.name] = tables[model.name].filter((candidate) => candidate !== row);
  }

  function findUniqueRow(model: ModelMeta, where: unknown): Row | undefined {
    if (!isObject(where)) throw new Error(`fake prisma: ${model.name} needs a unique where`);
    const hasUniqueKey = model.uniques.some(
      (key) => key.every((name) => where[name] !== undefined) || where[key.join("_")] !== undefined,
    );
    if (!hasUniqueKey) {
      throw new Error(
        `fake prisma: ${model.name} where must contain a unique key (${model.uniques
          .map((k) => k.join("_"))
          .join(" | ")}); got ${Object.keys(where).join(", ")}`,
      );
    }
    return tables[model.name].find((row) => matches(model, row, where));
  }

  // ── delegates ─────────────────────────────────────────────────────────────

  function delegate(model: ModelMeta) {
    const op =
      <T>(name: string, run: (args: Args) => T) =>
      (args: Args = {}) =>
        new LazyPrismaPromise(async () => {
          calls.push({ model: model.delegate, op: name, args: clone(args) });
          return run(args);
        });

    const findMany = (args: Args) =>
      applyListArgs(model, tables[model.name], args).map((row) => project(model, row, args));

    return {
      findMany: op("findMany", findMany),
      findFirst: op("findFirst", (args) => findMany({ ...args, take: 1 })[0] ?? null),
      findFirstOrThrow: op("findFirstOrThrow", (args) => {
        const found = findMany({ ...args, take: 1 })[0];
        if (!found) throw notFound(model, "findFirstOrThrow");
        return found;
      }),
      findUnique: op("findUnique", (args) => {
        const row = findUniqueRow(model, args.where);
        return row ? project(model, row, args) : null;
      }),
      findUniqueOrThrow: op("findUniqueOrThrow", (args) => {
        const row = findUniqueRow(model, args.where);
        if (!row) throw notFound(model, "findUniqueOrThrow");
        return project(model, row, args);
      }),
      count: op("count", (args) => {
        if (args.select !== undefined) throw new FakePrismaUnsupportedError("count({ select })");
        return applyListArgs(model, tables[model.name], args).length;
      }),
      create: op("create", (args) => project(model, insert(model, args.data as Args), args)),
      createMany: op("createMany", (args) => {
        const data = (Array.isArray(args.data) ? args.data : [args.data]) as Args[];
        let count = 0;
        for (const item of data) {
          try {
            insert(model, item);
            count++;
          } catch (error) {
            if (!(args.skipDuplicates && (error as { code?: string }).code === "P2002")) {
              throw error;
            }
          }
        }
        return { count };
      }),
      createManyAndReturn: op("createManyAndReturn", (args) => {
        const data = (Array.isArray(args.data) ? args.data : [args.data]) as Args[];
        return data.map((item) => project(model, insert(model, item), args));
      }),
      update: op("update", (args) => {
        const row = findUniqueRow(model, args.where);
        if (!row) throw notFound(model, "update");
        applyUpdate(model, row, args.data as Args);
        return project(model, row, args);
      }),
      updateMany: op("updateMany", (args) => {
        const rows = tables[model.name].filter((row) => matches(model, row, args.where));
        for (const row of rows) applyUpdate(model, row, args.data as Args);
        return { count: rows.length };
      }),
      updateManyAndReturn: op("updateManyAndReturn", (args) => {
        const rows = tables[model.name].filter((row) => matches(model, row, args.where));
        for (const row of rows) applyUpdate(model, row, args.data as Args);
        return rows.map((row) => project(model, row, args));
      }),
      upsert: op("upsert", (args) => {
        const existing = findUniqueRow(model, args.where);
        if (existing) {
          applyUpdate(model, existing, args.update as Args);
          return project(model, existing, args);
        }
        return project(model, insert(model, args.create as Args), args);
      }),
      delete: op("delete", (args) => {
        const row = findUniqueRow(model, args.where);
        if (!row) throw notFound(model, "delete");
        const snapshot = project(model, row, args);
        remove(model, row);
        return snapshot;
      }),
      deleteMany: op("deleteMany", (args) => {
        const rows = tables[model.name].filter((row) => matches(model, row, args.where));
        for (const row of rows) remove(model, row);
        return { count: rows.length };
      }),
      aggregate: op("aggregate", () => {
        throw new FakePrismaUnsupportedError("aggregate");
      }),
      groupBy: op("groupBy", () => {
        throw new FakePrismaUnsupportedError("groupBy");
      }),
    };
  }

  function rawSql(first: unknown): string {
    if (Array.isArray(first) && "raw" in first) return (first as string[]).join("?");
    if (typeof first === "string") return first;
    if (isObject(first) && typeof first.sql === "string") return first.sql;
    return String(first);
  }

  const raw =
    (op: string, fallback: unknown) =>
    (first: unknown, ...values: unknown[]) =>
      new LazyPrismaPromise(async () => {
        const sql = rawSql(first);
        calls.push({ model: "$client", op, args: { sql, values } });
        return rawHandler ? rawHandler(sql, values) : clone(fallback);
      });

  const client: Record<string, unknown> = {
    $connect: async () => undefined,
    $disconnect: async () => undefined,
    $on: () => undefined,
    $extends: () => {
      throw new FakePrismaUnsupportedError("$extends (count queries with fakeDb.calls instead)");
    },
    $queryRaw: raw("$queryRaw", []),
    $executeRaw: raw("$executeRaw", 0),
    $queryRawUnsafe: raw("$queryRawUnsafe", []),
    $executeRawUnsafe: raw("$executeRawUnsafe", 0),
    $transaction: async (input: unknown, options?: unknown) => {
      const kind = typeof input === "function" ? "interactive" : "batch";
      calls.push({ model: "$client", op: "$transaction", args: { kind, options } });
      const snapshot = clone(tables);
      try {
        if (typeof input === "function") return await input(client);
        const results: unknown[] = [];
        for (const operation of input as PromiseLike<unknown>[]) results.push(await operation);
        return results;
      } catch (error) {
        tables = snapshot;
        throw error;
      }
    },
  };
  for (const meta of models.values()) client[meta.delegate] = delegate(meta);

  const fake: FakeDb = {
    client: client as unknown as PrismaClient,
    calls,
    models,
    rows: (model) => clone(tables[modelOf(model).name]),
    seed: (async (model: string, data: Args | Args[]) => {
      const meta = modelOf(model);
      const created = (Array.isArray(data) ? data : [data]).map((item) =>
        project(meta, insert(meta, item)),
      );
      return Array.isArray(data) ? created : created[0];
    }) as FakeDb["seed"],
    onRaw: (handler) => {
      rawHandler = handler;
    },
    resetCalls: () => {
      calls.length = 0;
    },
    reset: () => {
      tables = Object.fromEntries([...models.keys()].map((m) => [m, []]));
      calls.length = 0;
      rawHandler = undefined;
      sequence = 0;
    },
  };
  return fake;
}

/** The instance `tests/setup.fake-db.ts` installs as `@/lib/db/prisma`. Reset after every test. */
export const fakeDb: FakeDb = createFakeDb();

// ─────────────────────────────────────────────────────────── ownership check ──

/**
 * Where the owning user id lives, per model (§4.4: "ownership predicate nests
 * `bike: { userId }`"). Models absent here hold no user data (`AuthAttempt`,
 * `VerificationToken`) and are not checked.
 */
const OWNERSHIP_PATHS: Record<string, string[]> = {
  user: ["id"],
  account: ["userId"],
  session: ["userId"],
  bike: ["userId"],
  bikePartState: ["bike", "userId"],
  checkup: ["bike", "userId"],
  buildList: ["bike", "userId"],
  checkupItem: ["checkup", "bike", "userId"],
  buildListItem: ["buildList", "bike", "userId"],
};

const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn"]);

function scopedBy(where: unknown, path: readonly string[], userId: string): boolean {
  if (!isObject(where)) return false;
  const [head, ...rest] = path;

  const conjuncts = where.AND === undefined ? [] : [where.AND].flat();
  if (conjuncts.some((w) => scopedBy(w, path, userId))) return true;
  if (Array.isArray(where.OR) && where.OR.length > 0) {
    if (where.OR.every((w) => scopedBy(w, path, userId))) return true;
  }

  for (const [key, value] of Object.entries(where)) {
    if (key === head) {
      if (rest.length === 0) {
        return value === userId || (isObject(value) && value.equals === userId);
      }
      const inner = isObject(value) && "is" in value ? value.is : value;
      if (scopedBy(inner, rest, userId)) return true;
    } else if (rest.length === 0 && isObject(value) && key.split("_").includes(head)) {
      // compound unique input, e.g. userId_guestLocalId: { userId, guestLocalId }
      if (value[head] === userId) return true;
    }
  }
  return false;
}

function createScopedBy(model: string, data: unknown, userId: string): boolean {
  const path = OWNERSHIP_PATHS[model];
  if (path.length !== 1) return true; // child rows: ownership was proven by the scoped read before
  const items = Array.isArray(data) ? data : [data];
  return items.every((item) => {
    if (!isObject(item)) return false;
    if (model === "user") return true; // sign-up creates the owner itself
    const relation = item.user;
    const connected =
      isObject(relation) && isObject(relation.connect) ? relation.connect.id : undefined;
    return item[path[0]] === userId || connected === userId;
  });
}

/**
 * Fails (throws) unless every recorded read and write of user-owned data is
 * constrained to `userId` in the query itself.
 *
 * Why the query and not the result: an action that fetches a row by id and
 * checks `row.userId` afterwards is one refactor away from an IDOR. Putting the
 * owner in the `where` makes a foreign id return nothing (→ `NOT_FOUND`, §4.7).
 *
 * Creates of child rows (a checkup item, a build-list item) carry no `where`;
 * they are accepted because the parent they attach to must itself have been
 * read with the predicate — which this same check enforces. Raw SQL cannot be
 * verified and is always reported.
 */
export function expectScopedToUser(calls: readonly FakeCall[], userId: string): void {
  const violations: string[] = [];
  for (const call of calls) {
    if (call.model === "$client") {
      if (call.op !== "$transaction") violations.push(`${call.op}: raw SQL cannot be verified`);
      continue;
    }
    const path = OWNERSHIP_PATHS[call.model];
    if (!path) continue;
    const args = (call.args ?? {}) as Args;
    const ok = CREATE_OPS.has(call.op)
      ? createScopedBy(call.model, args.data, userId)
      : scopedBy(args.where, path, userId) &&
        (call.op !== "upsert" || createScopedBy(call.model, args.create, userId));
    if (!ok) {
      violations.push(
        `${call.model}.${call.op} is not scoped by ${path.join(".")} = ${userId}: ${JSON.stringify(
          args.where ?? args.data ?? null,
        )}`,
      );
    }
  }
  if (violations.length > 0) {
    throw new Error(`Unscoped queries for user ${userId}:\n  - ${violations.join("\n  - ")}`);
  }
}
