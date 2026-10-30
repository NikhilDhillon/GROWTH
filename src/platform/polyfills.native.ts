/**
 * The phone app runs the website's data layer, which expects browser storage and
 * Web Crypto: localStorage is kept in SQLite on the device, and random values and
 * UUIDs come from the system's secure generator.
 */
import "expo-sqlite/localStorage/install";
import { getRandomValues, randomUUID } from "expo-crypto";

const runtime = globalThis as { crypto?: Partial<Crypto> };
runtime.crypto ??= {};
if (typeof runtime.crypto.getRandomValues !== "function") runtime.crypto.getRandomValues = getRandomValues as Crypto["getRandomValues"];
if (typeof runtime.crypto.randomUUID !== "function") runtime.crypto.randomUUID = randomUUID as Crypto["randomUUID"];
