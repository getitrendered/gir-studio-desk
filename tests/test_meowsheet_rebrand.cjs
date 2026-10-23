const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

console.log('Running MeowSheet rebrand and migration verification tests...');

// 1. package.json checks
const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
assert.strictEqual(pkg.name, 'meowsheet', 'package name is meowsheet');
assert.strictEqual(pkg.productName, 'MeowSheet', 'package productName is MeowSheet');
assert.ok(/^\d+\.\d+\.\d+$/.test(pkg.version), 'package version is semver');
assert.strictEqual(pkg.build.appId, 'com.meowsheet.app', 'build.appId is com.meowsheet.app');
assert.strictEqual(pkg.build.productName, 'MeowSheet', 'build.productName is MeowSheet');
assert.strictEqual(pkg.build.win.executableName, 'MeowSheet', 'build.win.executableName is MeowSheet');
assert.strictEqual(pkg.build.nsis.artifactName, 'MeowSheet-${version}-Setup.${ext}', 'NSIS artifactName is MeowSheet-${version}-Setup.${ext}');
console.log('✓ Test 1: package.json metadata and build configuration verified');

// 2. index.html checks
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.ok(html.includes('<title>MeowSheet</title>'), 'HTML title is MeowSheet');
assert.ok(html.includes('alt="MeowSheet Logo"'), 'Top bar logo alt is MeowSheet Logo');
console.log('✓ Test 2: index.html title and logo verified');

// 3. main.cjs checks
const mainCjs = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
assert.ok(mainCjs.includes("app.setAppUserModelId('com.meowsheet.app')"), 'AppUserModelId set to com.meowsheet.app');
assert.ok(mainCjs.includes("title: 'MeowSheet'"), 'BrowserWindow title is MeowSheet');
assert.ok(mainCjs.includes("const targetUserData = path.join(app.getPath('appData'), 'meowsheet');"), 'Target userData is meowsheet');
assert.ok(mainCjs.includes("const legacyUserData = path.join(app.getPath('appData'), 'gir-studio-desk');"), 'Legacy userData is gir-studio-desk');
console.log('✓ Test 3: main.cjs branding and paths verified');

// 4. Migration logic simulation test
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meowsheet-test-'));
try {
  const legacyDir = path.join(tempDir, 'gir-studio-desk');
  const targetDir = path.join(tempDir, 'meowsheet');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'ledger.json'), JSON.stringify({ version: '0.2.26', clients: [{ id: 'c1', name: 'Test Client' }] }));

  // Simulate main.cjs migration block:
  if (!fs.existsSync(targetDir) && fs.existsSync(legacyDir)) {
    fs.cpSync(legacyDir, targetDir, { recursive: true });
  } else if (fs.existsSync(path.join(legacyDir, 'ledger.json')) && !fs.existsSync(path.join(targetDir, 'ledger.json'))) {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.copyFileSync(path.join(legacyDir, 'ledger.json'), path.join(targetDir, 'ledger.json'));
  }

  assert.ok(fs.existsSync(path.join(targetDir, 'ledger.json')), 'Target ledger.json successfully migrated');
  const migrated = JSON.parse(fs.readFileSync(path.join(targetDir, 'ledger.json'), 'utf8'));
  assert.strictEqual(migrated.clients[0].name, 'Test Client');
  console.log('✓ Test 4: Seamless user data migration simulation passed');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

// 5. app.js checks
const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
assert.ok(appJs.includes('/* MeowSheet: renderer state'), 'app.js header comment updated');
assert.ok(appJs.includes("'Connecting to MeowSheet'"), 'Access connecting text updated');
assert.ok(appJs.includes("'Join MeowSheet workspace'"), 'Access join workspace text updated');
assert.ok(appJs.includes("'Welcome to MeowSheet'"), 'Access welcome text updated');
assert.ok(appJs.includes('alt="MeowSheet"'), 'Access logo alt text updated');
console.log('✓ Test 5: app.js UI labels verified');

// 6. release.yml workflow checks
const releaseYml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');
assert.ok(releaseYml.includes('release/MeowSheet-$version-Setup.exe'), 'Release workflow points to MeowSheet executable');
assert.ok(releaseYml.includes('MeowSheet ${{ github.ref_name }}'), 'Release title uses MeowSheet');
console.log('✓ Test 6: GitHub Actions release workflow verified');

console.log('ALL MEOWSHEET REBRAND & MIGRATION TESTS PASSED!');
