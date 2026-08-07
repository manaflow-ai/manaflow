import { z } from "zod";
import vercelTemplateDataJson from "./vercel-templates.json" with {
  type: "json",
};

const isoDateStringSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Invalid ISO date string",
  });

export const vercelTemplateVersionSchema = z.object({
  version: z.number().int().positive(),
  capturedAt: isoDateStringSchema,
});

export const vercelTemplatePresetSchema = z
  .object({
    templateId: z.string(),
    label: z.string(),
    runtime: z.string(),
    cpu: z.string(),
    memory: z.string(),
    description: z.string().optional(),
    useCases: z.array(z.string()).optional(),
    versions: z.array(vercelTemplateVersionSchema).min(1).readonly(),
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

export const vercelTemplateManifestSchema = z.object({
  schemaVersion: z.number().int().positive(),
  updatedAt: isoDateStringSchema,
  templates: z.array(vercelTemplatePresetSchema).min(1),
});

export type VercelTemplateVersion = z.infer<typeof vercelTemplateVersionSchema>;

export type VercelTemplatePreset = z.infer<typeof vercelTemplatePresetSchema>;

export type VercelTemplateManifest = z.infer<
  typeof vercelTemplateManifestSchema
>;

const vercelTemplateManifest =
  vercelTemplateManifestSchema.parse(vercelTemplateDataJson);

export const VERCEL_TEMPLATE_MANIFEST: VercelTemplateManifest =
  vercelTemplateManifest;

export const VERCEL_TEMPLATE_PRESETS: readonly VercelTemplatePreset[] =
  VERCEL_TEMPLATE_MANIFEST.templates;

if (VERCEL_TEMPLATE_PRESETS.length === 0) {
  throw new Error(
    "Vercel template manifest must include at least one template",
  );
}

const firstPreset = VERCEL_TEMPLATE_PRESETS[0];

if (!firstPreset) {
  throw new Error("Vercel template manifest must include a default template");
}

export const DEFAULT_VERCEL_TEMPLATE_ID: string = "vercel-sandbox-node24";

/**
 * Get a template preset by its ID.
 */
export const getVercelTemplateByPresetId = (
  presetId: string,
): VercelTemplatePreset | undefined => {
  return VERCEL_TEMPLATE_PRESETS.find((p) => p.templateId === presetId);
};

/**
 * Get all available Vercel runtimes.
 */
export const VERCEL_AVAILABLE_RUNTIMES = ["node24", "node22", "python3.13"];

/**
 * The default runtime for Vercel Sandbox.
 */
export const DEFAULT_VERCEL_RUNTIME = "node24";
