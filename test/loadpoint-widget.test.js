'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const html = fs.readFileSync('widgets/evcc-loadpoint/public/index.html', 'utf8');
const css = fs.readFileSync('widgets/evcc-loadpoint/public/style.css', 'utf8');
const compose = JSON.parse(fs.readFileSync('widgets/evcc-loadpoint/widget.compose.json', 'utf8'));

test('loadpoint widget exposes phase and charge detail rendering', () => {
  assert.equal(compose.height, 140);
  assert.match(html, /id="power-details"/);
  assert.match(html, /phaseIconSvg/);
  assert.match(html, /phase-icon/);
  assert.match(html, /data\.remaining/);
  assert.match(html, /data\.sessionEnergy/);
  assert.match(html, /buildModes\(data\.modes\)/);
  assert.match(css, /\.power-details/);
  assert.match(css, /\.phase-icon/);
  assert.match(css, /\.progress-marker/);
  assert.match(html, /progress-marker/);
  assert.match(html, /data\.targetSoc/);
});

test('loadpoint widget does not rebuild mode buttons or spin on background refresh', () => {
  assert.match(html, /if \(modeButtons\.length === 0\) buildModes/);
  assert.match(html, /setBusy\(true\)/);
  const setBusyCount = (html.match(/setBusy\(true\)/g) || []).length;
  // Only user-initiated actions (manual refresh, mode click) should set busy,
  // never the silent 10s poll.
  assert.equal(setBusyCount, 2);
  assert.doesNotMatch(html, /setInterval\(update, 10000\);\s*\n\s*setBusy\(true\)/);
});
