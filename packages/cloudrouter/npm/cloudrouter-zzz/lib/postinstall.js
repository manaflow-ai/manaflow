#!/usr/bin/env node
/**
 * Post-install script for cloudrouter-zzz
 * Copies the platform-specific cmux binary to the bin directory
 */

const fs = require('fs');
const path = require('path');

const PLATFORMS = {
  'darwin-arm64': 'cloudrouter-zzz-darwin-arm64',
  'darwin-x64': 'cloudrouter-zzz-darwin-x64',
  'linux-arm64': 'cloudrouter-zzz-linux-arm64',
  'linux-x64': 'cloudrouter-zzz-linux-x64',
  'win32-x64': 'cloudrouter-zzz-win32-x64',
};

function getPlatformPackage() {
  const platform = process.platform;
  const arch = process.arch;

  let archName = arch;
  if (arch === 'x64') archName = 'x64';
  else if (arch === 'arm64') archName = 'arm64';

  const key = `${platform}-${archName}`;
  return PLATFORMS[key];
}

function findBinary(packageName) {
  const binName = process.platform === 'win32' ? 'cmux.exe' : 'cmux';

  const possiblePaths = [
    // Hoisted to top-level node_modules (local install)
    path.join(__dirname, '..', '..', packageName, 'bin'),
    // In our own node_modules
    path.join(__dirname, '..', 'node_modules', packageName, 'bin'),
    // Global install - sibling package
    path.join(__dirname, '..', '..', '..', packageName, 'bin'),
    // pnpm global
    path.join(__dirname, '..', '..', '.pnpm', 'node_modules', packageName, 'bin'),
  ];

  try {
    const pkgPath = require.resolve(`${packageName}/package.json`, { paths: [path.join(__dirname, '..')] });
    const pkgBinPath = path.join(path.dirname(pkgPath), 'bin', binName);
    possiblePaths.unshift(path.dirname(pkgBinPath));
  } catch (e) {
    // Package not resolvable, continue with other paths
  }

  for (const p of possiblePaths) {
    const binPath = path.join(p, binName);
    if (fs.existsSync(binPath)) {
      return binPath;
    }
  }

  return null;
}

function main() {
  const platformPackage = getPlatformPackage();

  if (!platformPackage) {
    console.error(`Unsupported platform: ${process.platform}-${process.arch}`);
    console.error('Supported platforms: darwin-arm64, darwin-x64, linux-arm64, linux-x64, win32-x64');
    process.exit(1);
  }

  const sourceBinary = findBinary(platformPackage);

  if (!sourceBinary) {
    console.error(`cloudrouter-zzz: Platform package ${platformPackage} not found`);
    console.error(`cloudrouter-zzz: Please ensure the package installed correctly.`);
    return;
  }

  const binDir = path.join(__dirname, '..', 'bin');
  const destBinary = path.join(binDir, process.platform === 'win32' ? 'cmux.exe' : 'cmux');

  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  fs.copyFileSync(sourceBinary, destBinary);

  if (process.platform !== 'win32') {
    fs.chmodSync(destBinary, 0o755);
  }

  console.log(`cloudrouter-zzz: Installed ${platformPackage} binary`);
}

main();
