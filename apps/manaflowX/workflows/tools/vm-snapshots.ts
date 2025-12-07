import vmSnapshotsData from "../../sandbox/vm-snapshots.json";

export function loadVmSnapshots() {
  return vmSnapshotsData;
}

export function getLatestSnapshotId(): string {
  const snapshotsData = loadVmSnapshots();
  const preset = snapshotsData.presets[0];
  const latestVersion = preset.versions[preset.versions.length - 1];
  return latestVersion.snapshotId;
}
