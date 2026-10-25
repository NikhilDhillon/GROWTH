/** The pound plates the plate calculator and flow mode's load pictures use, largest first. */
export const plateWeights = [45, 35, 25, 10, 5] as const;
export type PlateWeight = typeof plateWeights[number];
