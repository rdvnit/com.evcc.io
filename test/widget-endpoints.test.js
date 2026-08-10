'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const widgetsDir = path.join(__dirname, '..', 'widgets');

function listWidgets() {
  return fs.readdirSync(widgetsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

test('every widget api endpoint declared in compose has an implementation', () => {
  const failures = [];
  for (const widget of listWidgets()) {
    const composePath = path.join(widgetsDir, widget, 'widget.compose.json');
    const apiPath = path.join(widgetsDir, widget, 'api.js');
    if (!fs.existsSync(composePath) || !fs.existsSync(apiPath)) continue;

    const compose = JSON.parse(fs.readFileSync(composePath, 'utf8'));
    const apiModule = require(apiPath);

    for (const endpoint of Object.keys(compose.api || {})) {
      if (typeof apiModule[endpoint] !== 'function') {
        failures.push(`${widget}: compose declares "${endpoint}" but api.js has no implementation`);
      }
    }
  }
  assert.deepEqual(failures, []);
});
