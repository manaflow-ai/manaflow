#!/usr/bin/env node
/**
 * Post-install script for cmux55 (dev/test build)
 * Copies the platform-specific binary to the bin directory
 */

const fs = require('fs');
const path = require('path');

const PLATFORMS = {
  'darwin-arm64': 'cmux55-darwin-arm64',
  'darwin-x64': 'cmux55-darwin-x64',
  'linux-arm64': 'cmux55-linux-arm64',
  'linux-x64': 'cmux55-linux-x64',
  'win32-x64': 'cmux55-win32-x64',
};

function getPlatformPackage() {
  const platform = process.platform;
  const arch = process.arch;

  // Map Node.js arch to our naming
  let archName = arch;
  if (arch === 'x64') archName = 'x64';
  else if (arch === 'arm64') archName = 'arm64';

  const key = `${platform}-${archName}`;
  return PLATFORMS[key];
}

function findBinary(packageName) {
  const binName = process.platform === 'win32' ? 'cmux55.exe' : 'cmux55';

  // Try to find the binary in node_modules
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

  // Also try require.resolve to find the package
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
    // Binary not found - try to install the platform package
    console.error(`cmux55: Platform package ${platformPackage} not found`);
    console.error(`cmux55: Please ensure the package installed correctly.`);
    console.error(`cmux55: You can try: npm install -g ${platformPackage}`);
    // Don't exit with error - npm might still be installing optional deps
    return;
  }

  const binDir = path.join(__dirname, '..', 'bin');
  const destBinary = path.join(binDir, process.platform === 'win32' ? 'cmux55.exe' : 'cmux55');

  // Ensure bin directory exists
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  // Copy the binary
  fs.copyFileSync(sourceBinary, destBinary);

  // Make executable on Unix
  if (process.platform !== 'win32') {
    fs.chmodSync(destBinary, 0o755);
  }

  console.log(`cmux55: Installed ${platformPackage} binary`);
}

main();
