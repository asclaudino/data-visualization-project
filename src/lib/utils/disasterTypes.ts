// src/lib/disasterTypes.ts

export const DISASTER_TYPES = [
  "Drought",
  "Earthquake",
  "Extreme temperature",
  "Flood",
  "Fog",
  "Mass movement (dry)",
  "Mass movement (wet)",
  "Glacial lake outburst flood",
  "Storm",
  "Volcanic activity",
  "Wildfire",
] as const;

export type DisasterType = (typeof DISASTER_TYPES)[number];
