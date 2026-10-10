/**
 * The part form's record of its own writes: which fields of which bike this
 * document has written and the form may not have been told about yet
 * (`components/bike/PartEditForm.tsx`; `.debug/017` §5.8, "Review of the fix"
 * and "Second review"). Plain TS: no React, nothing of the form's.
 *
 * Rule 2 of that form sends an edit only if it is not what is stored — and
 * "stored" is what the form was last HANDED. Twice that was not what the
 * bike held, and both times the visitor's correction was dropped as
 * "unchanged":
 *
 *   - a write of the field is still IN FLIGHT. 45 is on its way, the field
 *     mounted again still shows 42, the visitor types 42 to be sure;
 *   - a write of the field has ANSWERED, and nobody was there to be told. The
 *     answer's build goes to the workspace that sent the write; after a route
 *     change that workspace is gone, and the one mounted again goes on showing
 *     the page the router kept until Next has fetched it again — a whole
 *     request later, on the slow connection this is about.
 *
 * So a write is on record from before it leaves until it is SETTLED: it failed
 * or was refused (it wrote nothing), or the form has been handed, for that
 * field, exactly what it left there. While a field has an unsettled write, an
 * edit of it is sent whatever it compares to.
 *
 * Keyed by the BIKE (`BikeRepo.bikeParam`), never by a repo object or a
 * component: the form that asks is not the form that sent, and after a route
 * change neither is its workspace or its repo.
 *
 * ## What this costs, and what it cannot know
 *
 * Sending is the safe side — it is what the visitor typed and left — so the
 * doubt is resolved towards one write too many. That happens when the form is
 * never handed what this document's last write of a field left: the write
 * answered while that part's form was not on screen, and the field was changed
 * by SOMETHING ELSE (another tab, another device) before it was shown again.
 * The record stays, and the first value typed back to what the page shows is
 * sent although it changes nothing. Its answer is what the page says, and that
 * settles it.
 *
 * It knows what THIS document sent, and nothing else: not a write from another
 * tab, and nothing once the page is reloaded. And it orders nothing: two
 * writes of one field in transit together are applied by the server as they
 * arrive (`docs/backlog.md`).
 */
import type { AttributeValue } from "@/lib/domain/schema/part";

/** What a write left in its field: `value` is `undefined` for "no value". */
export interface Left {
  value: AttributeValue | undefined;
}

interface Unsettled {
  /** Writes sent and not answered yet. */
  inFlight: number;
  /** What the last write to be answered left in the field — until the form is handed it. */
  left?: Left;
}

/** An entry exists for as long as its field has an unsettled write, and no longer. */
const unsettled = new Map<string, Unsettled>();

/**
 * One field of one bike. A bike is `demo`, `local` or a UUID; a part id and
 * an attribute key are the domain's ids (`ID_PATTERN`: lower-case letters,
 * digits, hyphens). None of the three can hold the `/` or the `:` that keep
 * them apart.
 */
export function fieldOf(bikeParam: string, partId: string, key: string): string {
  return `${bikeParam}/${partId}:${key}`;
}

function answered(field: string, wrote: Left | null): void {
  const entry = unsettled.get(field);
  // Gone only if the record was emptied meanwhile (`forgetWrites`).
  if (entry === undefined) return;
  entry.inFlight -= 1;
  if (wrote !== null) entry.left = wrote;
  if (entry.inFlight === 0 && entry.left === undefined) unsettled.delete(field);
}

/**
 * Send one write of `field`, on record from before it leaves.
 *
 * `left` reads from an answer what the write left in the field, or `null` for
 * an answer that wrote nothing (a refusal). `send` is called synchronously,
 * and the promise handed back settles exactly as its own does.
 */
export function sendTracked<T>(
  field: string,
  send: () => Promise<T>,
  left: (answer: T) => Left | null,
): Promise<T> {
  const entry = unsettled.get(field) ?? { inFlight: 0 };
  entry.inFlight += 1;
  unsettled.set(field, entry);
  return send().then(
    (answer) => {
      answered(field, left(answer));
      return answer;
    },
    (error: unknown) => {
      answered(field, null);
      throw error;
    },
  );
}

/** Has `field` a write that is in flight, or that answered and the form was not handed yet? */
export function isUnsettled(field: string): boolean {
  return unsettled.has(field);
}

/**
 * The form has been handed `shown` for `field`. A write that answered and
 * left exactly that is settled; anything else stays on record.
 */
export function handed(field: string, shown: AttributeValue | undefined): void {
  const entry = unsettled.get(field);
  if (entry?.left === undefined || entry.left.value !== shown) return;
  delete entry.left;
  if (entry.inFlight === 0) unsettled.delete(field);
}

/**
 * Forget everything — for tests. The record is one document's, and in a test
 * file every case is a document of its own while the module is the same one.
 */
export function forgetWrites(): void {
  unsettled.clear();
}
