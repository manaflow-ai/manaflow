#!/usr/bin/env node
/**
 * Post-install script for cloudrouter
 * Copies the platform-specific binary to the bin directory
 */

const fs = require('fs');
const path = require('path');

const PLATFORMS = {
  'darwin-arm64': '@manaflow-ai/cloudrouter-darwin-arm64',
  'darwin-x64': '@manaflow-ai/cloudrouter-darwin-x64',
  'linux-arm64': '@manaflow-ai/cloudrouter-linux-arm64',
  'linux-x64': '@manaflow-ai/cloudrouter-linux-x64',
  'win32-x64': '@manaflow-ai/cloudrouter-win32-x64',
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
  const binName = process.platform === 'win32' ? 'cloudrouter.exe' : 'cloudrouter';
  // Extract the short name for scoped package paths
  const shortName = packageName.replace('@manaflow-ai/', '');

  // Try to find the binary in node_modules
  const possiblePaths = [
    // Hoisted to top-level node_modules (local install) - scoped
    path.join(__dirname, '..', '..', '@manaflow-ai', shortName, 'bin'),
    // In our own node_modules - scoped
    path.join(__dirname, '..', 'node_modules', '@manaflow-ai', shortName, 'bin'),
    // Global install - sibling package - scoped
    path.join(__dirname, '..', '..', '..', '@manaflow-ai', shortName, 'bin'),
    // pnpm global - scoped
    path.join(__dirname, '..', '..', '.pnpm', 'node_modules', '@manaflow-ai', shortName, 'bin'),
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
    console.error(`cloudrouter: Platform package ${platformPackage} not found`);
    console.error(`cloudrouter: Please ensure the package installed correctly.`);
    console.error(`cloudrouter: You can try: npm install -g ${platformPackage}`);
    // Don't exit with error - npm might still be installing optional deps
    return;
  }

  const binDir = path.join(__dirname, '..', 'bin');
  const destBinary = path.join(binDir, process.platform === 'win32' ? 'cloudrouter.exe' : 'cloudrouter');

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

  console.log(`cloudrouter: Installed ${platformPackage} binary`);
}

main();
