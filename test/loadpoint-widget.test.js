'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync('widgets/evcc-loadpoint/public/index.html', 'utf8');
const css = fs.readFileSync('widgets/evcc-loadpoint/public/style.css', 'utf8');
const compose = JSON.parse(fs.readFileSync('widgets/evcc-loadpoint/widget.compose.json', 'utf8'));

test('loadpoint widget inline JavaScript parses', () => {
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length > 0);
  for (const script of scripts) assert.doesNotThrow(() => new vm.Script(script));
});

test('loadpoint widget exposes phase and charge detail rendering', () => {
  assert.equal(compose.height, 140);
  assert.match(html, /id="power-details"/);
  assert.match(html, /phaseIconSvg/);
  assert.match(html, /phase-icon/);
  assert.match(html, /data\.remaining/);
  assert.match(html, /data\.sessionEnergy/);
  assert.match(html, /buildModes\(data\.modes\)/);
  assert.match(html, /mode\.id === 'smart'/);
  assert.match(html, /\/always-charge\?deviceId=/);
  assert.match(css, /\.power-details/);
  assert.match(css, /\.phase-icon/);
  assert.match(css, /\.progress-marker/);
  assert.match(html, /progress-marker/);
  assert.match(html, /data\.targetSoc/);
});

test('loadpoint widget rebuilds mode buttons only when the evcc schema changes', () => {
  assert.match(html, /if \(modeSignature !== nextModeSignature\) buildModes/);
  assert.match(html, /setBusy\(true\)/);
  const setBusyCount = (html.match(/setBusy\(true\)/g) || []).length;
  // Only user-initiated actions (manual refresh and mode/always-charge button)
  // set busy, never the silent 10s poll.
  assert.equal(setBusyCount, 2);
  assert.doesNotMatch(html, /setInterval\(update, 10000\);\s*\n\s*setBusy\(true\)/);
});

test('loadpoint widget preserves Always charge outside Smart and hides inactive indicators', () => {
  assert.match(html, /let always = elements\.modes\.dataset\.always;/);
  assert.match(html, /dataset\.always = data\.alwaysCharge \|\| ''/);
  assert.match(html, /const showAlwaysCharge = selected &&/);
  assert.match(html, /onc\.hidden = !selected \|\| data\.alwaysCharge !== 'once'/);
});

test('loadpoint widget writes only the state dimension selected by the user', () => {
  assert.match(html, /if \(elements\.modes\.dataset\.selected !== 'smart'\)[\s\S]*\/mode\?[\s\S]*else if \(data\.alwaysChargeSupported\)[\s\S]*\/always-charge\?/);
  assert.doesNotMatch(html, /\/mode\?[\s\S]*render\(await Homey\.api\('POST', `\/always-charge/);
});
