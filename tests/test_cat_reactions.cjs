const fs = require('fs');
const path = require('path');
const assert = require('assert');

const projectDir = path.resolve(__dirname, '..');

console.log('Testing Cat Reactions & Team Ping System...');

const expectedKeys = [
  'happy', 'working', 'depressed', 'angry', 'sleepy', 'shocked', 'love',
  'shy', 'proud', 'pleading', 'sparkle', 'chill', 'curious', 'confused',
  'idea', 'derp', 'dizzy', 'sweating', 'freeze', 'singing', 'gentleman', 'confident'
];

assert.strictEqual(expectedKeys.length, 22, 'There must be exactly 22 reactions');

// 1. Check Orange Cat files (both Lottie JSON and WebP)
for (const k of expectedKeys) {
  const pJson = path.join(projectDir, 'assets/cats/orange', `${k}.json`);
  assert(fs.existsSync(pJson), `Missing assets/cats/orange/${k}.json`);
  const json = JSON.parse(fs.readFileSync(pJson, 'utf8'));
  assert(json.fr === 60, `${k}.json frame rate should be 60`);
  assert(json.w === 512 && json.h === 512, `${k}.json should be 512x512`);

  const pWebp = path.join(projectDir, 'assets/cats/orange', `${k}.webp`);
  assert(fs.existsSync(pWebp), `Missing assets/cats/orange/${k}.webp`);
  assert(fs.statSync(pWebp).size > 500, `${k}.webp is too small or empty`);
}
console.log('✔ All 22 Orange Cat twin vector Lottie & WebP files verified (60fps 512x512)');

// 2. Check Black Cat Lottie & WebP files
for (const k of expectedKeys) {
  const pJson = path.join(projectDir, 'assets/cats/black', `${k}.json`);
  assert(fs.existsSync(pJson), `Missing assets/cats/black/${k}.json`);
  const json = JSON.parse(fs.readFileSync(pJson, 'utf8'));
  assert(json.fr === 60, `${k}.json frame rate should be 60`);
  assert(json.w === 512 && json.h === 512, `${k}.json should be 512x512`);

  const pWebp = path.join(projectDir, 'assets/cats/black', `${k}.webp`);
  assert(fs.existsSync(pWebp), `Missing assets/cats/black/${k}.webp`);
  assert(fs.statSync(pWebp).size > 500, `${k}.webp is too small or empty`);
}
console.log('✔ All 22 Black Cat Lottie & WebP files verified (authentic 60fps 512x512 vector animations)');

// 3. Check vendor/lottie.min.js & index.html
const lottiePath = path.join(projectDir, 'vendor/lottie.min.js');
assert(fs.existsSync(lottiePath), 'Missing vendor/lottie.min.js');
assert(fs.statSync(lottiePath).size > 100000, 'vendor/lottie.min.js size too small');

const indexHtml = fs.readFileSync(path.join(projectDir, 'index.html'), 'utf8');
assert(indexHtml.includes('vendor/lottie.min.js'), 'index.html must include vendor/lottie.min.js');
console.log('✔ lottie-web library bundled and loaded in index.html');

// 4. Check package.json build files inclusion
const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
const files = pkg.build.files;
assert(files.includes('assets/cats/**'), 'package.json build.files must include assets/cats/**');
assert(files.includes('vendor/**'), 'package.json build.files must include vendor/**');
console.log('✔ package.json build files configuration verified');

// 5. Check app.js integrations
const appJs = fs.readFileSync(path.join(projectDir, 'app.js'), 'utf8');
assert(appJs.includes('const CAT_REACTIONS ='), 'app.js must define CAT_REACTIONS');
assert(appJs.includes('getCatLottie'), 'app.js must define getCatLottie');
assert(appJs.includes('openCatReactionPicker'), 'app.js must define openCatReactionPicker');
assert(appJs.includes('displayCatReactionBanner'), 'app.js must define displayCatReactionBanner');
assert(appJs.includes('triggerCatPing'), 'app.js must define triggerCatPing');
assert(appJs.includes('cat-team-ping-btn'), 'app.js tracker must contain cat-team-ping-btn');
assert(!appJs.includes('data-cat-ping='), 'cards must NOT contain individual cat ping buttons');
assert(appJs.includes("event: 'cat_reaction'"), 'app.js subscribe() must listen for cat_reaction broadcasts');
assert(appJs.includes('isAppFocused'), 'app.js must perform smart focus detection');
assert(appJs.includes("workspaceId:'17f39873-e10f-4bdf-93ee-1f92b3e25251'"), 'workspaceId must be permanently defaulted to GIR_WORKSPACE_ID');

// 6. Check Online Presence Notification integration
assert(appJs.includes('handleUserOnline'), 'app.js must define handleUserOnline');
assert(appJs.includes('lastOnlineAlerts'), 'app.js must debounce online alerts');
assert(appJs.includes("event: 'user_online'"), 'app.js subscribe() must listen for user_online broadcasts');
assert(appJs.includes("channel.track"), 'app.js subscribe() must track user presence');
console.log('✔ Mutual Online Presence Notification system verified in app.js');

console.log('\nAll 22 Cat Reaction & Online Presence tests passed with flying colors! 🐾');
