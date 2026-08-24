import { loadSampleState } from "./config.mjs";
import { GoogleSheetsStore } from "./google-sheets-store.mjs";
import { MemoryStore } from "./memory-store.mjs";

export async function createStore(config) {
  if (config.storage === "google") return new GoogleSheetsStore(config);
  return new MemoryStore(await loadSampleState(config));
}
