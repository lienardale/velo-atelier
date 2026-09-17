import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DECISION_TREE } from "@/lib/domain/data/decision-tree";
import type { QuestionId } from "@/lib/domain/schema/decision";
import { renderWithIntl } from "@/tests/_helpers/intl";

import { DefaultCallout } from "./DefaultCallout";

const node = (id: QuestionId) => DECISION_TREE.find((candidate) => candidate.id === id)!;

describe("DefaultCallout", () => {
  it("names the default and the earlier answer it depends on (city → V-brake)", async () => {
    await renderWithIntl(
      <DefaultCallout node={node("brake-type")} answers={{ discipline: "city-hybrid" }} />,
    );
    const callout = screen.getByRole("status");
    expect(callout).toHaveTextContent("Réponse par défaut : V-brake");
    expect(callout).toHaveTextContent("pour un vélo : Ville ou VTC.");
    expect(callout).toHaveTextContent("depuis le récapitulatif");
  });

  it("gives the general reason for a plain fallback (gravel → hydraulic disc)", async () => {
    await renderWithIntl(
      <DefaultCallout node={node("brake-type")} answers={{ discipline: "gravel" }} />,
    );
    const callout = screen.getByRole("status");
    expect(callout).toHaveTextContent("Disque hydraulique");
    expect(callout).toHaveTextContent("C’est le cas le plus courant.");
    expect(callout).not.toHaveTextContent("pour un vélo");
  });

  it("speaks English", async () => {
    await renderWithIntl(
      <DefaultCallout node={node("wheel-size")} answers={{ discipline: "kids" }} />,
      { locale: "en" },
    );
    const callout = screen.getByRole("status");
    expect(callout).toHaveTextContent("Default answer: 20 inch");
    expect(callout).toHaveTextContent("a bike like this: Kids.");
  });
});
