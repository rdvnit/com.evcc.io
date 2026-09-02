'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

for (const driver of ['battery', 'loadpoint', 'site']) {
  test(`${driver} pairing styles do not leak into Homey's device list`, () => {
    const driverPath = path.join(__dirname, '..', 'drivers', driver);
    const compose = JSON.parse(fs.readFileSync(path.join(driverPath, 'driver.compose.json'), 'utf8'));
    const connectView = compose.pair[0].id;
    const html = fs.readFileSync(path.join(driverPath, 'pair', `${connectView}.html`), 'utf8');

    assert.equal(connectView, 'connect_v8');
    assert.match(html, /document\.body\.classList\.add\('evcc-pairing-view'\)/);
    assert.match(html, /document\.body\.classList\.remove\('evcc-pairing-view'\);\s*Homey\.showView\('list_devices'\)/);
    assert.doesNotMatch(html, /html\.homey-dark-mode body \*/);
    assert.doesNotMatch(html, /prepareSystemDeviceList/);
    assert.doesNotMatch(html, /document\.body\.style\.backgroundColor/);
    assert.doesNotMatch(html, /evcc-system-bottom-chrome/);
  });
}
