'use strict';

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function toIconName(icon = 'car') {
  const name = String(icon).toLowerCase().trim();
  return name || 'car';
}

function formatKw(watts) {
  const value = Math.abs(Number(watts) || 0);
  return `${(value / 1000).toFixed(1)} kW`;
}

function formatChargedKwh(chargedEnergyWh) {
  const value = Math.abs(Number(chargedEnergyWh) || 0);
  if (value <= 0) return null;
  return `${(value / 1000).toFixed(1)} kWh`;
}

function formatRemainingSeconds(seconds) {
  const value = Math.round(Number(seconds) || 0);
  if (!Number.isFinite(value) || value <= 0) return null;
  const h = Math.floor(value / 3600);
  const m = Math.round((value % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function calculateEnergyFlow(site = {}, loadpoints = []) {
  const pvProduction = positive(site.pvPower);
  const gridPower = Number.isFinite(Number(site.gridPower)) ? Number(site.gridPower) : 0;
  const homePower = positive(site.homePower);
  const batteryPower = Number.isFinite(Number(site.batteryPower)) ? Number(site.batteryPower) : 0;
  const batteryDischarge = positive(batteryPower);
  const batteryCharge = positive(-batteryPower);
  const activeLoadpoints = loadpoints
    .map((loadpoint) => ({
      title: loadpoint.vehicleTitle || loadpoint.title,
      icon: toIconName(loadpoint.icon),
      soc: typeof loadpoint.vehicleSoc === 'number' ? loadpoint.vehicleSoc : null,
      connected: Boolean(loadpoint.connected),
      charging: Boolean(loadpoint.charging),
      chargePower: positive(loadpoint.chargePower),
      phasesActive: typeof loadpoint.phasesActive === 'number' ? loadpoint.phasesActive : null,
      chargedEnergyWh: typeof loadpoint.chargedEnergyWh === 'number' ? loadpoint.chargedEnergyWh : null,
      chargeRemainingDuration: typeof loadpoint.chargeRemainingDuration === 'number' ? loadpoint.chargeRemainingDuration : null,
      chargeLabel: [
        typeof loadpoint.phasesActive === 'number' ? `${loadpoint.phasesActive}p` : null,
        formatKw(loadpoint.chargePower),
        formatChargedKwh(loadpoint.chargedEnergyWh),
        formatRemainingSeconds(loadpoint.chargeRemainingDuration),
      ]
        .filter(Boolean)
        .join(' · '),
    }))
    .filter((loadpoint) => loadpoint.connected || loadpoint.chargePower > 10);
  const loadpointsPower = activeLoadpoints.reduce((sum, loadpoint) => sum + loadpoint.chargePower, 0);
  const gridImport = positive(gridPower);
  const pvExport = positive(-gridPower);
  const consumption = homePower + batteryCharge + loadpointsPower;
  const selfPv = Math.min(pvProduction, consumption);
  const selfBattery = Math.max(0, Math.min(batteryDischarge, consumption - selfPv));
  const inPower = gridImport + pvProduction + batteryDischarge;
  const outPower = homePower + loadpointsPower + pvExport + batteryCharge;
  const knownPower = gridImport + selfPv + selfBattery + pvExport;
  const imbalance = Math.abs(inPower - outPower);
  const balanceTotal = Math.max(inPower, outPower);
  const imbalancePercent = balanceTotal > 0 ? imbalance / balanceTotal * 100 : 0;
  const unknownPower = imbalancePercent >= 10 ? Math.max(0, balanceTotal - knownPower) : 0;
  const unknownImport = outPower > inPower ? unknownPower : 0;
  const unknownOutput = inPower > outPower ? unknownPower : 0;
  const total = knownPower + unknownPower;

  return {
    pvProduction,
    gridImport,
    pvExport,
    homePower,
    batteryCharge,
    batteryDischarge,
    batterySoc: typeof site.batterySoc === 'number' ? site.batterySoc : null,
    batteryConfigured: Boolean(site.batteryConfigured),
    selfPv,
    selfBattery,
    unknownImport,
    unknownOutput,
    unknownPower,
    inPower,
    outPower,
    total,
    loadpoints: activeLoadpoints,
  };
}

module.exports = { calculateEnergyFlow, formatKw, formatChargedKwh, formatRemainingSeconds };
