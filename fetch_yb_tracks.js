#!/usr/bin/env node
// Fetch GPS tracks from YB Tracking and export as GPX files
// Usage: node fetch_yb_tracks.js [raceKey] [teamId1,teamId2,...]

const https = require('https');
const fs = require('fs');
const { parseAllPositions3, toGPX } = require('./yb_parser');

const RACE_KEY = process.argv[2] || 'rolexchinasea2026';
const TARGET_IDS = process.argv[3]
  ? process.argv[3].split(',').map(Number)
  : [6, 10, 14, 21]; // IRC Premier: Fenice, Moonblue 2, Parnassus, Lisa Elaine

const BIN_URL = `https://yb.tl/BIN/${RACE_KEY}/AllPositions3`;
const SETUP_URL = `https://yb.tl/JSON/${RACE_KEY}/RaceSetup`;

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  console.log(`Race: ${RACE_KEY}`);
  console.log(`Target team IDs: ${TARGET_IDS.join(', ')}`);

  console.log('Fetching race setup...');
  const setupBuf = await fetch(SETUP_URL);
  const setup = JSON.parse(setupBuf.toString());
  const teamMap = {};
  for (const t of setup.teams) teamMap[t.id] = t.name;

  console.log('Fetching binary position data...');
  const binData = await fetch(BIN_URL);
  console.log(`Downloaded ${binData.length} bytes`);

  const allPositions = parseAllPositions3(binData);
  console.log(`Parsed ${allPositions.length} teams total`);

  for (const team of allPositions) {
    if (!TARGET_IDS.includes(team.id)) continue;
    const name = teamMap[team.id] || `Team ${team.id}`;
    const raceName = `${name} - Rolex China Sea Race 2026`;
    const filename = name.toLowerCase().replace(/\s+/g, '_') + '_yb.gpx';
    const gpx = toGPX(raceName, team.moments, true);
    fs.writeFileSync(filename, gpx);
    console.log(`  ${name} (id=${team.id}): ${team.moments.length} positions -> ${filename}`);
  }
  console.log('Done!');
}

main().catch(console.error);
