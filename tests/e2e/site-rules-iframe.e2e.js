/**
 * E2E tests for site rules vs cross-origin iframe players.
 *
 * Scenario: a site rule disables the embedding site (e.g. ispa.com), but the
 * video lives in a cross-origin iframe (e.g. player.vimeo.com). The iframe's
 * own href never matches the rule, so the bridge must also match against
 * location.ancestorOrigins.
 *
 * Setup: two local HTTP servers on different origins —
 *   http://localhost:8991  → parent page embedding the player
 *   http://127.0.0.1:8992  → player page with the <video>
 * (localhost vs 127.0.0.1 is a genuine cross-origin boundary.)
 */

import http from 'http';
import { launchChromeWithExtension, assert, sleep } from './e2e-utils.js';

const PARENT_PORT = 8991;
const PLAYER_PORT = 8992;
const PARENT_URL = `http://localhost:${PARENT_PORT}/parent.html`;
const PLAYER_URL = `http://127.0.0.1:${PLAYER_PORT}/player.html`;

const VIDEO_SRC = 'https://www.w3schools.com/html/mov_bbb.mp4';

const PARENT_HTML = `<!DOCTYPE html>
<html><head><title>Embedding site</title></head>
<body>
  <h1>Parent page (embedding site)</h1>
  <iframe src="${PLAYER_URL}" width="700" height="500"></iframe>
</body></html>`;

const PLAYER_HTML = `<!DOCTYPE html>
<html><head><title>Player</title></head>
<body>
  <video controls width="640" height="480" loop muted>
    <source src="${VIDEO_SRC}" type="video/mp4">
  </video>
</body></html>`;

function serve(port, html) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });
    server.listen(port, () => resolve(server));
  });
}

/** Find the extension ID from the loaded service worker target. */
async function getExtensionId(browser) {
  for (let i = 0; i < 20; i++) {
    const target = browser
      .targets()
      .find((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'));
    if (target) {
      return new URL(target.url()).host;
    }
    await sleep(500);
  }
  throw new Error('Extension service worker not found');
}

/** Set siteRules via chrome.storage from the extension's options page. */
async function setSiteRules(browser, extensionId, siteRules) {
  const page = await browser.newPage();
  try {
    await page.goto(`chrome-extension://${extensionId}/ui/options/options.html`, {
      waitUntil: 'domcontentloaded',
    });
    await page.evaluate(
      (rules) => new Promise((resolve) => chrome.storage.sync.set({ siteRules: rules }, resolve)),
      siteRules
    );
  } finally {
    await page.close();
  }
}

/** Get the player iframe's frame handle from the parent page. */
function getPlayerFrame(page) {
  return page.frames().find((f) => f.url().startsWith(`http://127.0.0.1:${PLAYER_PORT}`));
}

/** Wait until the player frame has (or confirms absence of) a controller. */
async function frameHasController(frame, timeout) {
  try {
    await frame.waitForSelector('.vsc-controller', { timeout });
    return true;
  } catch {
    return false;
  }
}

export default async function runSiteRulesIframeE2ETests() {
  console.log('🎭 Running Site Rules Iframe E2E Tests...\n');

  let browser;
  let parentServer;
  let playerServer;
  let passed = 0;
  let failed = 0;

  const runTest = async (testName, testFn) => {
    try {
      console.log(`   🧪 ${testName}`);
      await testFn();
      console.log(`   ✅ ${testName}`);
      passed++;
    } catch (error) {
      console.log(`   ❌ ${testName}: ${error.message}`);
      failed++;
    }
  };

  try {
    parentServer = await serve(PARENT_PORT, PARENT_HTML);
    playerServer = await serve(PLAYER_PORT, PLAYER_HTML);

    const { browser: chromeBrowser, page } = await launchChromeWithExtension();
    browser = chromeBrowser;
    const extensionId = await getExtensionId(browser);

    await runTest('Controller appears in cross-origin iframe without disable rule', async () => {
      await setSiteRules(browser, extensionId, []);
      await page.goto(PARENT_URL, { waitUntil: 'domcontentloaded' });
      await sleep(2000);

      const frame = getPlayerFrame(page);
      assert.exists(frame, 'Player iframe should exist');
      assert.true(
        await frameHasController(frame, 15000),
        'Controller should appear in the player iframe'
      );
    });

    await runTest('Disabling the embedding site also disables the iframe player', async () => {
      // Rule matches the PARENT origin (localhost) only — the iframe's own
      // href (127.0.0.1) does not contain 'localhost', so this only works if
      // ancestor origins are part of the match.
      await setSiteRules(browser, extensionId, [{ pattern: 'localhost', enabled: false }]);
      await page.goto(PARENT_URL, { waitUntil: 'domcontentloaded' });
      await sleep(4000); // give the extension time to (wrongly) inject

      const frame = getPlayerFrame(page);
      assert.exists(frame, 'Player iframe should exist');
      assert.false(
        await frameHasController(frame, 3000),
        'Controller must NOT appear in the player iframe when the parent site is disabled'
      );
    });

    await runTest('Unrelated disable rule leaves the iframe player enabled', async () => {
      await setSiteRules(browser, extensionId, [{ pattern: 'example.com', enabled: false }]);
      await page.goto(PARENT_URL, { waitUntil: 'domcontentloaded' });
      await sleep(2000);

      const frame = getPlayerFrame(page);
      assert.exists(frame, 'Player iframe should exist');
      assert.true(
        await frameHasController(frame, 15000),
        'Controller should appear when no rule matches'
      );
    });
  } catch (error) {
    console.log(`   💥 Test setup failed: ${error.message}`);
    failed++;
  } finally {
    if (browser) {
      await browser.close();
    }
    if (parentServer) {
      parentServer.close();
    }
    if (playerServer) {
      playerServer.close();
    }
  }

  console.log(`\n   📊 Site Rules Iframe Tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
