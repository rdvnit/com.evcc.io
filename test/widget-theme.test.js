'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const css = fs.readFileSync('widgets/evcc-loadpoint/public/style.css', 'utf8');
const html = fs.readFileSync('widgets/evcc-loadpoint/public/index.html', 'utf8');

test('primary widget text uses a namespaced Homey-aware color token', () => {
  assert.match(css, /--evcc-primary-text: var\(--homey-text-color, #111217\)/);
  assert.match(css, /\.homey-dark-mode\s*{[^}]*--evcc-primary-text: #f5f5f7/s);
  assert.equal((css.match(/color: var\(--evcc-primary-text\)/g) || []).length, 3);
  assert.doesNotMatch(css, /--primary:/);
  assert.doesNotMatch(css, /color-scheme:\s*light/);
});

test('dark progress track and phase icon use theme-safe widget tokens', () => {
  assert.match(css, /\.homey-dark-mode\s*{[^}]*--evcc-progress-track: #010322/s);
  assert.match(css, /\.phase-icon svg line\s*{[^}]*stroke: var\(--evcc-primary-text\)/s);
});

test('widget loads the refactored stylesheet revision', () => {
  assert.match(html, /style\.css\?v=12/);
});