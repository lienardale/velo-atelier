/**
 * The part form's record of its own writes: what this document has sent for
 * each field of each bike, and what the last of them left there
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
 * So what the form is handed for a field is IN DOUBT, and an edit of that
 * field is sent whatever it compares to, while a write of it is in flight —
 * and for as long as the page does not say what this document's last write of
 * it left. Not "until the page has said it once": a page rendered before a
 * write can be delivered after the one that was rendered after it.
 *
 * Keyed by the BIKE (`BikeRepo.bikeParam`), never by a repo object or a
 * component: the form that asks is not the form that sent, and after a route
 * change neither is its workspace or its repo.
 *
 * ## What this costs, and what it cannot know
 *
 * Sending is the safe side — it is what the visitor typed and left — so doubt
 * is resolved towards one write too many. That happens when a field this
 * document has written was changed since by SOMETHING ELSE (another tab,
 * another device): the page no longer says what the record holds, and the
 * first value typed back to what the page shows is sent although it changes
 * nothing. Its answer is what the page says, and the doubt ends there.
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

interface Written {
  /** Writes sent and not answered yet. */
  inFlight: number;
  /**
   * What was left by the write sent LAST, among those that have answered.
   * By the order they were sent in, not the order their answers came back
   * in: the answer of an earlier write can arrive after a later one's.
   */
  last?: Left & { sent: number };
}

const written = new Map<string, Written>();
let sent = 0;

/**
 * One field of one bike. A bike is `demo`, `local` or a UUID; a part id and
 * an attribute key are the domain's ids (`ID_PATTERN`: lower-case letters,
 * digits, hyphens). None of the three can hold the `/` or the `:` that keep
 * them apart.
 */
export function fieldOf(bikeParam: string, partId: string, key: string): string {
  return `${bikeParam}/${partId}:${key}`;
}

function answered(field: string, order: number, wrote: Left | null): void {
  const entry = written.get(field);
  // Gone only if the record was emptied meanwhile (`forgetWrites`).
  if (entry === undefined) return;
  entry.inFlight -= 1;
  if (wrote !== null && (entry.last === undefined || order > entry.last.sent)) {
    entry.last = { value: wrote.value, sent: order };
  }
  // A field whose every write failed or was refused holds nothing of ours.
  if (entry.inFlight === 0 && entry.last === undefined) written.delete(field);
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
  const entry = written.get(field) ?? { inFlight: 0 };
  entry.inFlight += 1;
  written.set(field, entry);
  sent += 1;
  const order = sent;
  return send().then(
    (answer) => {
      answered(field, order, left(answer));
      return answer;
    },
    (error: unknown) => {
      answered(field, order, null);
      throw error;
    },
  );
}

/**
 * Is `shown` — what the form was handed for `field` — in doubt? While a write
 * of the field is in flight, and for as long as `shown` is not what this
 * document's last write of it left.
 */
export function isInDoubt(field: string, shown: AttributeValue | undefined): boolean {
  const entry = written.get(field);
  if (entry === undefined) return false;
  return entry.inFlight > 0 || (entry.last !== undefined && entry.last.value !== shown);
}

/**
 * Forget everything — for tests. The record is one document's, and in a test
 * file every case is a document of its own while the module is the same one.
 */
export function forgetWrites(): void {
  written.clear();
}
