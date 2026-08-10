'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const html = fs.readFileSync('widgets/evcc-energy-flow/public/index.html', 'utf8');
const css = fs.readFileSync('widgets/evcc-energy-flow/public/style.css', 'utf8');
const compose = JSON.parse(fs.readFileSync('widgets/evcc-energy-flow/widget.compose.json', 'utf8'));

test('energy flow widget matches evcc visualization structure and site device filter', () => {
  assert.equal(compose.height, 140);
  assert.equal(compose.devices.filter.class, 'other');
  assert.equal(compose.devices.filter.capabilities, 'evcc_solar_power,evcc_grid_power,evcc_home_power');
  assert.match(html, /class="scale-row top"/);
  assert.match(html, /class="flow-bar"/);
  assert.match(html, /class="scale-row bottom"/);
  assert.match(html, /Homey\.ready\(\{ height: 140 \}\)/);
});

test('energy flow widget includes evcc flow colors and Homey dark-mode override', () => {
  assert.match(css, /--evcc-green: #0fde41/);
  assert.match(css, /--evcc-battery: #0ba631/);
  assert.match(css, /--evcc-yellow: #faf000/);
  assert.match(css, /--evcc-grid: #28293e/);
  assert.match(css, /\.homey-dark-mode\s*{/);
});

test('energy flow widget includes battery icon rendering and vehicle detail hookups', () => {
  assert.match(html, /battery:.*<svg/);
  assert.match(html, /function vehicleIcon\(icon\)/);
  assert.match(html, /supportedIcons = new Set/);
  assert.match(html, /secondaryLabel/);
});
