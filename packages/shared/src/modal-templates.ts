import { z } from "zod";
import modalTemplateDataJson from "./modal-templates.json" with {
  type: "json",
};

const isoDateStringSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Invalid ISO date string",
  });

export const modalTemplateVersionSchema = z.object({
  version: z.number().int().positive(),
  capturedAt: isoDateStringSchema,
});

export const modalTemplatePresetSchema = z
  .object({
    templateId: z.string(),
    label: z.string(),
    cpu: z.string(),
    memory: z.string(),
    disk: z.string(),
    gpu: z.string().optional(),
    image: z.string(),
    description: z.string().optional(),
    useCases: z.array(z.string()).optional(),
    versions: z.array(modalTemplateVersionSchema).min(1).readonly(),
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

export const modalTemplateManifestSchema = z.object({
  schemaVersion: z.number().int().positive(),
  updatedAt: isoDateStringSchema,
  templates: z.array(modalTemplatePresetSchema).min(1),
});

export type ModalTemplateVersion = z.infer<typeof modalTemplateVersionSchema>;

export type ModalTemplatePreset = z.infer<typeof modalTemplatePresetSchema>;

export type ModalTemplateManifest = z.infer<
  typeof modalTemplateManifestSchema
>;

const modalTemplateManifest =
  modalTemplateManifestSchema.parse(modalTemplateDataJson);

export const MODAL_TEMPLATE_MANIFEST: ModalTemplateManifest =
  modalTemplateManifest;

export const MODAL_TEMPLATE_PRESETS: readonly ModalTemplatePreset[] =
  MODAL_TEMPLATE_MANIFEST.templates;

if (MODAL_TEMPLATE_PRESETS.length === 0) {
  throw new Error(
    "Modal template manifest must include at least one template",
  );
}

const firstPreset = MODAL_TEMPLATE_PRESETS[0];

if (!firstPreset) {
  throw new Error("Modal template manifest must include a default template");
}

export const DEFAULT_MODAL_TEMPLATE_ID: string = firstPreset.templateId;

/**
 * Get a template preset by its ID.
 */
export const getModalTemplateByPresetId = (
  presetId: string,
): ModalTemplatePreset | undefined => {
  return MODAL_TEMPLATE_PRESETS.find((p) => p.templateId === presetId);
};

/**
 * Get all GPU-enabled template presets.
 */
export const getModalGpuTemplates = (): readonly ModalTemplatePreset[] => {
  return MODAL_TEMPLATE_PRESETS.filter((p) => p.gpu !== undefined);
};

/**
 * GPUs available without special approval.
 * Higher-tier GPUs require contacting the Manaflow team.
 */
export const MODAL_AVAILABLE_GPUS = new Set(["T4", "L4", "A10G"]);

/**
 * Check if a GPU type requires approval (gated).
 * Returns true if the GPU is gated and not freely available.
 * Accepts GPU strings like "H100" or "H100:2" (multi-GPU).
 */
export const isModalGpuGated = (gpu: string): boolean => {
  const baseGpu = gpu.split(":")[0]?.toUpperCase() ?? "";
  return !MODAL_AVAILABLE_GPUS.has(baseGpu);
};

/**
 * The default template ID for preview configure environments (CPU-only).
 */
export const DEFAULT_MODAL_PREVIEW_TEMPLATE_ID: string =
  DEFAULT_MODAL_TEMPLATE_ID;
