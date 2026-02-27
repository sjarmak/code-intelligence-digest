#!/usr/bin/env tsx

import fs from "fs";
import path from "path";

const dataPath = path.resolve(process.cwd(), ".data", "playbook_state.json");
const seedPath = path.resolve(process.cwd(), "src", "config", "playbook_state.seed.json");

function main(): void {
  if (fs.existsSync(dataPath)) {
    console.log(`[playbook:ensure] Existing state found: ${dataPath}`);
    return;
  }

  if (!fs.existsSync(seedPath)) {
    console.log(`[playbook:ensure] No seed found at ${seedPath}; skipping`);
    return;
  }

  const dataDir = path.dirname(dataPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.copyFileSync(seedPath, dataPath);
  console.log(`[playbook:ensure] Seeded state from ${seedPath} -> ${dataPath}`);
}

main();
