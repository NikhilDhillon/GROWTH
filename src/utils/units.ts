import { UnitSystem } from "@/types";

const poundsPerKilogram = 2.2046226218;
export const bodyWeightDisplayUnit: UnitSystem = "kg";

export function weightToStorageUnit(weight: number, unitSystem: UnitSystem) {
  return unitSystem === "kg" ? weight * poundsPerKilogram : weight;
}

export function weightFromStorageUnit(weight: number, unitSystem: UnitSystem) {
  return unitSystem === "kg" ? weight / poundsPerKilogram : weight;
}

export function formatWeight(weight: number, unitSystem: UnitSystem) {
  const converted = weightFromStorageUnit(weight, unitSystem);
  const value = unitSystem === "kg" ? converted.toFixed(1) : String(Math.round(converted));
  return `${value} ${unitSystem}`;
}

export function formatWeightInput(weight: number, unitSystem: UnitSystem) {
  const converted = weightFromStorageUnit(weight, unitSystem);
  return unitSystem === "kg" ? converted.toFixed(1) : String(Math.round(converted));
}

export function bodyWeightToStorageUnit(weight: number, unitSystem: UnitSystem = bodyWeightDisplayUnit) {
  return weightToStorageUnit(weight, unitSystem);
}

export function bodyWeightFromStorageUnit(weight: number, unitSystem: UnitSystem = bodyWeightDisplayUnit) {
  return weightFromStorageUnit(weight, unitSystem);
}

export function formatBodyWeight(weight: number, unitSystem: UnitSystem = bodyWeightDisplayUnit) {
  return formatWeight(weight, unitSystem);
}

export function formatBodyWeightInput(weight: number, unitSystem: UnitSystem = bodyWeightDisplayUnit) {
  return formatWeightInput(weight, unitSystem);
}
