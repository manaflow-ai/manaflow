const { join } = require("node:path");
const { existsSync, rmSync, readdirSync, lstatSync } = require("node:fs");

const EN_PREFIXES = ["en", "en_GB"];

function shouldKeepLanguageDir(name) {
  if (!name.endsWith(".lproj")) return true;
  return EN_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function pruneLanguageDirs(baseDir) {
  if (!existsSync(baseDir)) {
    return;
  }
  for (const entry of readdirSync(baseDir)) {
    const entryPath = join(baseDir, entry);
    if (!shouldKeepLanguageDir(entry)) {
      try {
        rmSync(entryPath, { recursive: true, force: true });
      } catch {
        // ignore issues deleting optional localization directories
      }
      continue;
    }
    // Some language folders contain nested variants (e.g., en_GB/...) that also
    // need pruning. Recurse to ensure we clean anything under them.
    try {
      if (lstatSync(entryPath).isDirectory()) {
        pruneLanguageDirs(entryPath);
      }
    } catch {
      // ignore stat errors
    }
  }
}

function pruneSwiftShaderLibraries(electronFrameworkDir) {
  const targets = [
    join(
      electronFrameworkDir,
      "Libraries",
      "libvk_swiftshader.dylib",
    ),
    join(electronFrameworkDir, "Libraries", "vk_swiftshader_icd.json"),
    join(electronFrameworkDir, "Resources", "swiftshader"),
  ];
  for (const target of targets) {
    if (!target.startsWith(electronFrameworkDir)) continue;
    if (!existsSync(target)) continue;
    try {
      rmSync(target, { recursive: true, force: true });
    } catch {
      // ignore removal failures; these assets are optional
    }
  }
}

module.exports = async function afterPack(context) {
  console.log("[afterPack] pruning optional resources...");
  const { appOutDir, packager } = context;
  const appFilename = packager.appInfo.productFilename;
  const contentsDir = join(appOutDir, `${appFilename}.app`, "Contents");
  const topLevelResources = join(contentsDir, "Resources");
  pruneLanguageDirs(topLevelResources);

  const frameworksDir = join(contentsDir, "Frameworks");
  const electronFrameworkDir = join(
    frameworksDir,
    "Electron Framework.framework",
    "Versions",
    "A",
  );
  pruneLanguageDirs(join(electronFrameworkDir, "Resources"));
  pruneSwiftShaderLibraries(electronFrameworkDir);
};
