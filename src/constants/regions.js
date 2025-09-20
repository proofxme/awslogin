'use strict';

const REGIONS = [
  { id: 'us-east-1', label: 'US East (N. Virginia)' },
  { id: 'us-east-2', label: 'US East (Ohio)' },
  { id: 'us-west-1', label: 'US West (N. California)' },
  { id: 'us-west-2', label: 'US West (Oregon)' },
  { id: 'ca-central-1', label: 'Canada (Central)' },
  { id: 'sa-east-1', label: 'South America (São Paulo)' },
  { id: 'eu-west-1', label: 'Europe (Ireland)' },
  { id: 'eu-west-2', label: 'Europe (London)' },
  { id: 'eu-west-3', label: 'Europe (Paris)' },
  { id: 'eu-central-1', label: 'Europe (Frankfurt)' },
  { id: 'eu-north-1', label: 'Europe (Stockholm)' },
  { id: 'eu-south-1', label: 'Europe (Milan)' },
  { id: 'me-south-1', label: 'Middle East (Bahrain)' },
  { id: 'ap-south-1', label: 'Asia Pacific (Mumbai)' },
  { id: 'ap-south-2', label: 'Asia Pacific (Hyderabad)' },
  { id: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
  { id: 'ap-northeast-2', label: 'Asia Pacific (Seoul)' },
  { id: 'ap-northeast-3', label: 'Asia Pacific (Osaka)' },
  { id: 'ap-east-1', label: 'Asia Pacific (Hong Kong)' },
  { id: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
  { id: 'ap-southeast-2', label: 'Asia Pacific (Sydney)' },
  { id: 'ap-southeast-3', label: 'Asia Pacific (Jakarta)' },
  { id: 'ap-southeast-4', label: 'Asia Pacific (Melbourne)' },
  { id: 'af-south-1', label: 'Africa (Cape Town)' }
];

function formatRegion(regionId) {
  if (!regionId) {
    return 'Not set';
  }

  const match = REGIONS.find((region) => region.id === regionId.trim());
  if (match) {
    return `${match.id} (${match.label})`;
  }
  return regionId;
}

function buildRegionChoices(currentRegion, { includeKeepCurrent = true } = {}) {
  const items = REGIONS.map((region) => ({
    value: region.id,
    label: `${region.id} — ${region.label}`
  }));

  if (includeKeepCurrent) {
    items.push({
      value: currentRegion || null,
      label: currentRegion ? `Keep current setting (${formatRegion(currentRegion)})` : 'Keep region unset'
    });
  }

  return items;
}

module.exports = {
  formatRegion,
  buildRegionChoices
};
