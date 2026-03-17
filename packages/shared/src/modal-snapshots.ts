import { z } from "zod";
import modalSnapshotDataJson from "./modal-snapshots.json" with {
  type: "json",
};

const isoDateStringSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Invalid ISO date string",
  });

export const modalSnapshotVersionSchema = z.object({
  snapshotId: z.string().regex(/^im-[a-zA-Z0-9]+$/),
  version: z.number().int().positive(),
  image: z.string(),
  capturedAt: isoDateStringSchema,
});

export const modalSnapshotManifestSchema = z.object({
  schemaVersion: z.number().int().positive(),
  updatedAt: isoDateStringSchema,
  snapshots: z.array(modalSnapshotVersionSchema).min(1),
});

export type ModalSnapshotVersion = z.infer<typeof modalSnapshotVersionSchema>;

export type ModalSnapshotManifest = z.infer<typeof modalSnapshotManifestSchema>;

const modalSnapshotManifest =
  modalSnapshotManifestSchema.parse(modalSnapshotDataJson);

export const MODAL_SNAPSHOT_MANIFEST: ModalSnapshotManifest =
  modalSnapshotManifest;

const sortedSnapshots = [...MODAL_SNAPSHOT_MANIFEST.snapshots].sort(
  (a, b) => a.version - b.version,
);

const latestSnapshot = sortedSnapshots[sortedSnapshots.length - 1];

if (!latestSnapshot) {
  throw new Error("Modal snapshot manifest must include at least one snapshot");
}

export const DEFAULT_MODAL_SNAPSHOT_ID: string = latestSnapshot.snapshotId;

/**
 * Get a snapshot by its ID.
 */
export const getModalSnapshotById = (
  snapshotId: string,
): ModalSnapshotVersion | undefined => {
  return MODAL_SNAPSHOT_MANIFEST.snapshots.find(
    (s) => s.snapshotId === snapshotId,
  );
};
