import { z } from "zod";
import e2bTemplateDataJson from "./e2b-templates.json" with {
  type: "json",
};

const isoDateStringSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Invalid ISO date string",
  });

export const e2bTemplateVersionSchema = z.object({
  version: z.number().int().positive(),
  e2bTemplateId: z.string(),
  capturedAt: isoDateStringSchema,
});

export const e2bTemplatePresetSchema = z
  .object({
    templateId: z.string(),
    label: z.string(),
    cpu: z.string(),
    memory: z.string(),
    disk: z.string(),
    description: z.string().optional(),
    versions: z.array(e2bTemplateVersionSchema).min(1).readonly(),
  })
  .superRefine((preset, ctx) => {
    const sortedByVersion = [...preset.versions].sort(
      (a, b) => a.version - b.version,
    );
    for (let index = 1; index < sortedByVersion.length; index += 1) {
      const previous = sortedByVersion[index - 1];
      const current = sortedByVersion[index];
      if (!previous || !current) {
        continue;
      }
      if (current.version <= previous.version) {
        ctx.addIssue({
          code: "custom",
          message: "Versions must be strictly increasing",
          path: ["versions", index, "version"],
        });
        break;
      }
    }
  });

export const e2bTemplateManifestSchema = z.object({
  schemaVersion: z.number().int().positive(),
  updatedAt: isoDateStringSchema,
  templates: z.array(e2bTemplatePresetSchema).min(1),
});

export type E2BTemplateVersion = z.infer<typeof e2bTemplateVersionSchema>;

export type E2BTemplatePreset = z.infer<typeof e2bTemplatePresetSchema>;

export interface E2BTemplatePresetWithLatest extends E2BTemplatePreset {
  id: E2BTemplateVersion["e2bTemplateId"];
  latestVersion: E2BTemplateVersion;
  versions: readonly E2BTemplateVersion[];
}

export type E2BTemplateManifest = z.infer<typeof e2bTemplateManifestSchema>;

const sortVersions = (
  versions: readonly E2BTemplateVersion[],
): E2BTemplateVersion[] => [...versions].sort((a, b) => a.version - b.version);

const toPresetWithLatest = (
  preset: E2BTemplatePreset,
): E2BTemplatePresetWithLatest => {
  const sortedVersions = sortVersions(preset.versions);
  const latestVersion = sortedVersions.length > 0 ? sortedVersions[sortedVersions.length - 1] : undefined;
  if (!latestVersion) {
    throw new Error(`Template "${preset.templateId}" does not contain versions`);
  }
  return {
    ...preset,
    versions: sortedVersions,
    id: latestVersion.e2bTemplateId,
    latestVersion,
  };
};

const e2bTemplateManifest =
  e2bTemplateManifestSchema.parse(e2bTemplateDataJson);

export const E2B_TEMPLATE_MANIFEST: E2BTemplateManifest =
  e2bTemplateManifest;

const e2bTemplatePresets =
  E2B_TEMPLATE_MANIFEST.templates.map(toPresetWithLatest);

export const E2B_TEMPLATE_PRESETS: readonly E2BTemplatePresetWithLatest[] =
  e2bTemplatePresets;

if (E2B_TEMPLATE_PRESETS.length === 0) {
  throw new Error("E2B template manifest must include at least one template");
}

export type E2BTemplateId =
  (typeof E2B_TEMPLATE_PRESETS)[number]["id"];

const firstPreset = E2B_TEMPLATE_PRESETS[0];

if (!firstPreset) {
  throw new Error("E2B template manifest must include a default template");
}

const highPreset = E2B_TEMPLATE_PRESETS.find(
  (p) => p.templateId === "cmux-devbox-docker",
);
export const DEFAULT_E2B_TEMPLATE_ID: E2BTemplateId =
  highPreset?.id ?? firstPreset.id;

/**
 * Size tiers for E2B templates: low, mid, high.
 * Default is "high" (cmux-devbox-docker).
 */
export type E2BSizeTier = "low" | "mid" | "high";

const E2B_SIZE_TIER_PRESET_IDS: Record<E2BSizeTier, string> = {
  low: "cmux-devbox-low",
  mid: "cmux-devbox-mid",
  high: "cmux-devbox-docker",
};

export const DEFAULT_E2B_SIZE_TIER: E2BSizeTier = "high";

/**
 * Get the latest E2B template ID for a size tier.
 */
export const getE2BTemplateIdByTier = (
  tier: E2BSizeTier,
): E2BTemplateId | undefined => {
  const presetId = E2B_SIZE_TIER_PRESET_IDS[tier];
  const preset = E2B_TEMPLATE_PRESETS.find((p) => p.templateId === presetId);
  return preset?.id;
};

/**
 * Get the latest template ID for a given preset ID.
 */
export const getE2BTemplateIdByPresetId = (
  presetId: string,
): E2BTemplateId | undefined => {
  const preset = E2B_TEMPLATE_PRESETS.find((p) => p.templateId === presetId);
  return preset?.id;
};

/**
 * The default template ID for preview configure environments.
 */
export const DEFAULT_E2B_PREVIEW_TEMPLATE_ID: E2BTemplateId =
  getE2BTemplateIdByTier(DEFAULT_E2B_SIZE_TIER) ?? DEFAULT_E2B_TEMPLATE_ID;
