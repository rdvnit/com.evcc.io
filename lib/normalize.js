'use strict';

/**
 * evcc's /api/state payload shape has drifted across releases (arrays of
 * meters vs. flattened power fields, "limitSoc" vs "effectiveLimitSoc", ...).
 * This module tolerates the known variants instead of hard-coding one, so a
 * point release doesn't quietly break every capability.
 */

function pick(obj, keys, fallback) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return fallback;
}

function sumPower(entries, key = 'power') {
  if (!Array.isArray(entries)) return undefined;
  return entries.reduce((sum, e) => sum + (Number(e && e[key]) || 0), 0);
}

function avg(entries, key) {
  if (!Array.isArray(entries) || entries.length === 0) return undefined;
  const vals = entries.map((e) => Number(e && e[key])).filter((v) => !Number.isNaN(v));
  if (!vals.length) return undefined;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function isConfigured(entry) {
  if (Array.isArray(entry)) return entry.length > 0;
  return entry !== null && entry !== undefined;
}

function normalizeSite(state) {
  if (!state) return {};

  const batteryConfigured = isConfigured(state.battery);
  const gridConfigured = Boolean(pick(state, ['gridConfigured'], isConfigured(state.grid)));

  const pvPower = pick(state, ['pvPower']) ?? sumPower(state.pv);
  const gridPower = pick(state, ['gridPower']) ?? (state.grid && state.grid.power);
  const homePower = pick(state, ['homePower']);
  const batteryPower = pick(state, ['batteryPower']) ?? sumPower(state.battery);
  const batterySoc = pick(state, ['batterySoc']) ?? avg(state.battery, 'soc');
  const batteryMode = pick(state, ['batteryMode', 'batteryModeExternal']);
  const batteryDischargeControl = pick(state, ['batteryDischargeControl', 'batteryDischargeAllowed']);
  const batteryBufferSoc = pick(state, ['bufferSoc', 'batteryBufferSoc']);
  const batteryBufferStartSoc = pick(state, ['bufferStartSoc', 'batteryBufferStartSoc']);
  const batteryPrioritySoc = pick(state, ['prioritySoc', 'batteryPrioritySoc']);
  const gridResidualPower = pick(state, ['residualPower', 'gridResidualPower']);
  const batteryGridChargeLimit = pick(state, ['batteryGridChargeLimit', 'batteryGridChargeLimitCost']);

  return {
    siteTitle: pick(state, ['siteTitle', 'title'], 'evcc'),
    pvPower: numOrNull(pvPower),
    gridPower: gridConfigured ? numOrNull(gridPower) : null,
    homePower: numOrNull(homePower),
    batteryPower: batteryConfigured ? numOrNull(batteryPower) : null,
    batterySoc: batteryConfigured ? numOrNull(batterySoc) : null,
    greenShareHome: numOrNull(pick(state, ['greenShareHome'])),
    batteryMode: typeof batteryMode === 'string' ? batteryMode : null,
    batteryDischargeControl: typeof batteryDischargeControl === 'boolean' ? batteryDischargeControl : null,
    batteryBufferSoc: numOrNull(batteryBufferSoc),
    batteryBufferStartSoc: numOrNull(batteryBufferStartSoc),
    batteryPrioritySoc: numOrNull(batteryPrioritySoc),
    gridResidualPower: numOrNull(gridResidualPower),
    batteryGridChargeLimit: numOrNull(batteryGridChargeLimit),
    batteryConfigured,
    gridConfigured,
  };
}

function normalizeLoadpoint(lp, index) {
  if (!lp) return null;

  const connected = pick(lp, ['connected', 'vehiclePresent'], false);
  const charging = pick(lp, ['charging'], false);
  const targetSoc = pick(lp, ['effectiveLimitSoc', 'limitSoc', 'vehicleTargetSoc', 'planSoc']);
  const vehicleSoc = pick(lp, ['vehicleSoc', 'soc']);
  const vehicleRange = pick(lp, ['vehicleRange', 'range']);
  const chargePower = pick(lp, ['chargePower', 'power']);
  const chargedEnergy = pick(lp, ['chargedEnergy', 'sessionEnergy']);

  return {
    index,
    title: pick(lp, ['title'], `Loadpoint ${index}`),
    mode: pick(lp, ['mode'], 'off'),
    connected: Boolean(connected),
    charging: Boolean(charging),
    targetSoc: numOrNull(targetSoc),
    vehicleSoc: numOrNull(vehicleSoc),
    vehicleRange: numOrNull(vehicleRange),
    vehicleTitle: pick(lp, ['vehicleTitle', 'vehicleName']),
    chargePower: numOrNull(chargePower),
    chargedEnergy: whToKwh(numOrNull(chargedEnergy)), // evcc reports this in Wh
  };
}

function numOrNull(v) {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function whToKwh(v) {
  return typeof v === 'number' ? v / 1000 : v;
}

function normalizeState(rawState) {
  const site = normalizeSite(rawState);
  const loadpointsRaw = Array.isArray(rawState && rawState.loadpoints) ? rawState.loadpoints : [];
  const loadpoints = loadpointsRaw.map((lp, i) => normalizeLoadpoint(lp, i + 1));
  return { site, loadpoints };
}

module.exports = { normalizeState, normalizeSite, normalizeLoadpoint };
