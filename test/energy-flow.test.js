'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { calculateEnergyFlow, formatKw, formatChargedKwh, formatRemainingSeconds } = require('../lib/energy-flow');

test('matches evcc self-consumption and grid-import flow calculations', () => {
  const flow = calculateEnergyFlow({
    pvPower: 2600,
    gridPower: 4700,
    homePower: 400,
    batteryPower: 0,
  }, [{
    title: 'Charger',
    vehicleTitle: 'M3P',
    icon: 'car',
    connected: true,
    charging: false,
    chargePower: 0,
    vehicleSoc: 49,
  }]);

  assert.equal(flow.selfPv, 400);
  assert.equal(flow.gridImport, 4700);
  assert.equal(flow.unknownOutput, 2200);
  assert.equal(flow.total, 7300);
  assert.equal(flow.loadpoints[0].icon, 'car');
  assert.equal(flow.loadpoints[0].soc, 49);
  assert.equal(flow.loadpoints[0].title, 'M3P');
  assert.equal(flow.loadpoints[0].chargeLabel, '0.0 kW');
});

test('splits battery charge and discharge and excludes disconnected idle loadpoints', () => {
  const flow = calculateEnergyFlow({
    pvPower: 5000,
    gridPower: -1000,
    homePower: 1500,
    batteryPower: -2000,
    batterySoc: 65,
    batteryConfigured: true,
  }, [{
    title: 'Garage',
    icon: 'heatpump',
    connected: false,
    charging: false,
    chargePower: 0,
  }]);

  assert.equal(flow.batteryCharge, 2000);
  assert.equal(flow.batteryDischarge, 0);
  assert.equal(flow.pvExport, 1000);
  assert.equal(flow.selfPv, 3500);
  assert.equal(flow.batterySoc, 65);
  assert.equal(flow.batteryConfigured, true);
  assert.deepEqual(flow.loadpoints, []);
});

test('normalises missing vehicle icon to car and preserves provided icons', () => {
  const flow = calculateEnergyFlow({ batteryPower: 0 }, [
    { title: 'Vehicle A', chargePower: 0, connected: true, vehicleSoc: 72 },
    { title: 'Vehicle B', icon: 'heatpump', chargePower: 0, connected: true },
    { title: 'Vehicle C', icon: '', chargePower: 0, connected: true },
  ]);

  assert.equal(flow.loadpoints.length, 3);
  assert.equal(flow.loadpoints[0].icon, 'car');
  assert.equal(flow.loadpoints[1].icon, 'heatpump');
  assert.equal(flow.loadpoints[2].icon, 'car');
});

test('formats loadpoint charge detail with phases and remaining time', () => {
  const flow = calculateEnergyFlow({ batteryPower: 0 }, [{
    title: 'Carport',
    vehicleTitle: 'ID.4',
    connected: true,
    charging: true,
    chargePower: 4200,
    vehicleSoc: 71,
    phasesActive: 3,
    chargeRemainingDuration: 4500,
    chargedEnergyWh: 12340,
  }]);

  const lp = flow.loadpoints[0];
  assert.equal(lp.phasesActive, 3);
  assert.equal(lp.chargedEnergyWh, 12340);
  assert.equal(lp.chargeRemainingDuration, 4500);
  assert.equal(lp.chargeLabel, '3p · 4.2 kW · 12.3 kWh · 1h 15m');
});

test('format helpers always display kilowatts and readable charging details', () => {
  assert.equal(formatKw(999), '1.0 kW');
  assert.equal(formatKw(4200), '4.2 kW');
  assert.equal(formatKw(0), '0.0 kW');
  assert.equal(formatChargedKwh(12340), '12.3 kWh');
  assert.equal(formatChargedKwh(0), null);
  assert.equal(formatRemainingSeconds(5400), '1h 30m');
  assert.equal(formatRemainingSeconds(1200), '20m');
  assert.equal(formatRemainingSeconds(0), null);
});
