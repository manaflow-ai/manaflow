const fs = require('fs');
const path = require('path');

const xaiRoot = process.env.XAI_ROOT
const darwinSource = process.env.GROK_DARWIN_ARM64 || path.join(xaiRoot, 'target', 'release', 'xai-grok-tui');
const darwinDest = path.resolve(__dirname, '..', 'vendor', 'darwin-arm64', 'grok');

const linuxSource = process.env.GROK_LINUX_X64 || path.join(xaiRoot, 'target',
    'explorer_cross_x86_64-unknown-linux-gnu', 'x86_64-unknown-linux-gnu', 'release', 'xai-grok-tui');
const linuxDest = path.resolve(__dirname, '..', 'vendor', 'linux-x64', 'grok');

function ensureDir(p) { fs.mkdirSync(path.dirname(p), { recursive: true }); }

function copy(from, to) {
    if (!fs.existsSync(from)) return false;
    ensureDir(to);
    fs.copyFileSync(from, to);
    fs.chmodSync(to, 0o755);
    console.log(`Packed: ${to}`);
    return true;
}

const okDarwin = copy(darwinSource, darwinDest);
const okLinux = copy(linuxSource, linuxDest);

if (!okDarwin || !okLinux) {
    console.error('[prepack] Missing required binaries. Provide paths via:');
    if (!okDarwin) console.error(`  GROK_DARWIN_ARM64= ${darwinSource} (darwin-arm64)`);
    if (!okLinux) console.error(`  GROK_LINUX_X64= ${linuxSource} (linux-x64)`);
    console.error('Or build them to the default locations before "npm publish".');
    process.exit(1);
}

// write vendor/version.json with the npm version
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
const versionJsonPath = path.resolve(__dirname, '..', 'vendor', 'version.json');
ensureDir(versionJsonPath);
fs.writeFileSync(versionJsonPath, JSON.stringify({ version: pkg.version }, null, 2));
console.log(`Wrote version metadata: ${versionJsonPath}`);

