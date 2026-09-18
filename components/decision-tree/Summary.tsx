"use client";

import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Callout } from "@/components/ui-ext/Callout";
import { visibleQuestions } from "@/lib/domain/engine/decision";
import type { Answers, QuestionId } from "@/lib/domain/schema/decision";
import { useRouter } from "@/lib/i18n/navigation";

import { useDecisionText } from "./decision-text";

type LocalBikeModule = typeof import("@/lib/bike/local-bike");

/** Loads the guest-bike module — and with it the part catalogue — only when it is needed. */
export type LoadLocalBike = () => Promise<LocalBikeModule>;

const loadLocalBikeModule: LoadLocalBike = () => import("@/lib/bike/local-bike");

export interface SummaryProps {
  answers: Answers;
  guessed: readonly QuestionId[];
  onEdit: (question: QuestionId) => void;
  /** The screen heading's id and ref (focused on arrival, like every step heading). */
  headingId: string;
  headingRef: React.Ref<HTMLHeadingElement>;
  /** Injection point for tests. */
  loadLocalBike?: LoadLocalBike;
}

/**
 * The last screen of the tree (§6.3): every answer in a table, "par défaut"
 * badges on the guessed ones, one edit button per row, and "Générer mon vélo",
 * which stores the guest bike (`writeLocalBike`) and opens `/velo/local`. A
 * bike already stored in this browser is not overwritten without a
 * confirmation dialog.
 *
 * `lib/bike/local-bike` is imported on click, not at the top: it carries the
 * whole part catalogue, and the home page must stay light (bundle budget
 * `/[locale]`).
 */
export function Summary({
  answers,
  guessed,
  onEdit,
  headingId,
  headingRef,
  loadLocalBike = loadLocalBikeModule,
}: SummaryProps): React.JSX.Element {
  const t = useDecisionText();
  const tree = useTranslations("decision-tree");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const moduleRef = useRef<LocalBikeModule | null>(null);
  const guessedSet = new Set(guessed);
  const questions = visibleQuestions(answers);

  const save = (lib: LocalBikeModule) => {
    const bike = lib.writeLocalBike({ answers });
    if (bike === null) {
      setStorageError(true);
      setBusy(false);
      return;
    }
    router.push({ pathname: "/velo/[id]", params: { id: "local" } });
  };

  const generate = async () => {
    setBusy(true);
    setStorageError(false);
    const lib = await loadLocalBike();
    moduleRef.current = lib;
    if (lib.hasLocalBike()) {
      setBusy(false);
      setConfirmOpen(true);
      return;
    }
    save(lib);
  };

  const confirmReplace = () => {
    setConfirmOpen(false);
    if (moduleRef.current !== null) {
      setBusy(true);
      save(moduleRef.current);
    }
  };

  return (
    <div data-testid="decision-summary" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="text-3xl font-semibold outline-none sm:text-4xl"
        >
          {tree("summary.title")}
        </h1>
        <p className="max-w-2xl text-ink-muted">{tree("summary.intro")}</p>
      </div>

      <div className="overflow-hidden rounded-lg border border-rule">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">{tree("summary.caption")}</caption>
          <thead className="bg-paper-2 text-ink-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                {tree("summary.question")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {tree("summary.answer")}
              </th>
              <th scope="col" className="w-0 px-1 py-2">
                <span className="sr-only">{tree("summary.edit")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {questions.map((node) => {
              const answer = answers[node.id];
              const question = tree(`questions.${node.id}`);
              return (
                <tr key={node.id} data-question={node.id} className="border-t border-rule">
                  <th scope="row" className="px-3 py-2 align-middle font-medium text-ink">
                    {question}
                  </th>
                  <td className="px-3 py-2 align-middle text-ink">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span>
                        {answer === undefined
                          ? null
                          : t(`decision.${node.id}.options.${answer}.label`)}
                      </span>
                      {guessedSet.has(node.id) ? (
                        <Badge
                          variant="outline"
                          data-testid="default-badge"
                          className="text-ink-muted"
                        >
                          {tree("summary.defaultBadge")}
                        </Badge>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-1 py-1 align-middle">
                    <button
                      type="button"
                      onClick={() => onEdit(node.id)}
                      aria-label={tree("summary.editLabel", { question })}
                      className="tap-target gap-2 rounded-md px-2 text-accent hover:bg-paper-2 focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <Pencil aria-hidden="true" className="size-4" />
                      <span aria-hidden="true" className="hidden sm:inline">
                        {tree("summary.edit")}
                      </span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {storageError ? (
        <Callout tone="warning" role="alert" data-testid="storage-error">
          <p>{tree("summary.storageError")}</p>
        </Callout>
      ) : null}

      <div>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={busy}
          aria-busy={busy}
          data-testid="generate-bike"
          className="tap-target rounded-md bg-accent px-6 font-medium text-accent-fg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
        >
          {busy ? tree("summary.generating") : tree("summary.generate")}
        </button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{tree("summary.replace.title")}</DialogTitle>
            <DialogDescription>{tree("summary.replace.description")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose className="tap-target rounded-md border border-rule px-4 font-medium text-ink hover:bg-paper-2">
              {tree("summary.replace.cancel")}
            </DialogClose>
            <button
              type="button"
              onClick={confirmReplace}
              className="tap-target rounded-md bg-accent px-4 font-medium text-accent-fg hover:opacity-90"
            >
              {tree("summary.replace.confirm")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
