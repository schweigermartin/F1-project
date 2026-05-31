import { describe, expect, it } from "vitest";

import {
  BEDROCK_PROMPT_VERSION,
  buildExplanationPrompt,
  FEATURE_LABELS_DE,
  MAX_EXPLANATION_SENTENCES,
  SYSTEM_PROMPT,
} from "../src/bedrock-prompts.js";
import { PODIUM_FEATURE_NAMES, type ShapContribution } from "../src/prediction-schema.js";

const shapTop: ShapContribution[] = [
  { feature: "grid_position", contribution: 0.31 },
  { feature: "driver_form", contribution: 0.14 },
  { feature: "is_wet", contribution: -0.09 },
];

describe("SYSTEM_PROMPT", () => {
  it("pins the explain-not-predict constraint (AC-5)", () => {
    expect(SYSTEM_PROMPT).toContain("NICHT von dir");
    expect(SYSTEM_PROMPT).toContain("sagst nichts vorher");
  });

  it("caps the answer length (AC-2)", () => {
    expect(SYSTEM_PROMPT).toContain(`höchstens ${MAX_EXPLANATION_SENTENCES} Sätzen`);
  });

  it("is a stable snapshot (prompt changes are reviewable)", () => {
    expect(SYSTEM_PROMPT).toMatchSnapshot();
  });
});

describe("FEATURE_LABELS_DE", () => {
  it("has a German label for every model feature (Constitution VI)", () => {
    for (const feature of PODIUM_FEATURE_NAMES) {
      expect(FEATURE_LABELS_DE[feature]).toBeTruthy();
    }
  });
});

describe("buildExplanationPrompt", () => {
  it("renders the probability as a whole-percent fact and splits dafür/dagegen", () => {
    const prompt = buildExplanationPrompt("VER", 0.68, shapTop);
    expect(prompt).toContain("Fahrer: VER");
    expect(prompt).toContain("Berechnete Podiums-Wahrscheinlichkeit: 68 %");
    expect(prompt).toContain("Spricht dafür: Startplatz, aktuelle Form des Fahrers");
    expect(prompt).toContain("Spricht dagegen: Regen-/Nässebedingungen");
  });

  it("is deterministic for fixed input (snapshot)", () => {
    expect(buildExplanationPrompt("VER", 0.68, shapTop)).toMatchSnapshot();
  });

  it("uses an em dash when a direction has no contributing feature", () => {
    const prompt = buildExplanationPrompt("LEC", 0.42, [
      { feature: "grid_position", contribution: 0.2 },
    ]);
    expect(prompt).toContain("Spricht dagegen: —");
  });

  it("handles an empty SHAP list (explain from the probability alone)", () => {
    const prompt = buildExplanationPrompt("HAM", 0.15, []);
    expect(prompt).toContain("Spricht dafür: —");
    expect(prompt).toContain("Spricht dagegen: —");
    expect(prompt).toContain("15 %");
  });

  it("rounds the probability to whole percent", () => {
    expect(buildExplanationPrompt("NOR", 0.666, [])).toContain("67 %");
  });
});

describe("BEDROCK_PROMPT_VERSION", () => {
  it("is exported so cached explanations can record their template version", () => {
    expect(BEDROCK_PROMPT_VERSION).toBe("v1");
  });
});
