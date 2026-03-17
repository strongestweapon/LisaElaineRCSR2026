/**
 * YB Tracking Binary Parser Library
 *
 * Parses the binary format from YB Tracking's BIN/{raceKey}/AllPositions3 endpoint.
 * Reverse-engineered from pro.yb.tl viewer JS bundle.
 *
 * Usage:
 *   const { parseAllPositions3 } = require('./yb_parser');
 *   const buf = fs.readFileSync('positions.bin');
 *   const teams = parseAllPositions3(buf);
 *   // teams = [{ id: 6, moments: [{ lat, lon, at, dtf?, alt?, lap?, pc? }, ...] }, ...]
 */

/**
 * Parse BIN/AllPositions3 binary data into team position arrays.
 *
 * Binary format:
 *   Header (5 bytes):
 *     byte 0: flags
 *       bit 0 (& 1): has altitude
 *       bit 1 (& 2): has distance-to-finish (dtf)
 *       bit 2 (& 4): has laps
 *       bit 3 (& 8): has progress counter (pc)
 *       if bits 0+2+3 all set: "super" mode (resets altitude/laps/pc flags)
 *     bytes 1-4: base timestamp (uint32, seconds since epoch)
 *
 *   Per team:
 *     2 bytes: team id (uint16)
 *     2 bytes (or 8 in super mode): number of positions (uint16 or bigUint64)
 *     Per position:
 *       First byte check: if bit 7 (& 128) is set -> delta-encoded, else absolute
 *
 *       Absolute position:
 *         4 bytes: time offset from base (uint32) -> at = base + offset
 *         4 bytes: lat * 1e5 (int32)
 *         4 bytes: lon * 1e5 (int32)
 *         [optional: 2 bytes altitude (int16)]
 *         [optional: 4 bytes dtf (int32)]
 *         [optional: 1 byte lap (uint8)]
 *         [optional: 4 bytes pc / 21e6 (int32)]
 *
 *       Delta position:
 *         2 bytes: time delta + flags (uint16, time = lower 15 bits)
 *         2 bytes: lat delta (int16)
 *         2 bytes: lon delta (int16)
 *         [optional: 2 bytes altitude (int16)]
 *         [optional: 2 bytes dtf delta (int16)]
 *         [optional: 1 byte lap (uint8)]
 *         [optional: 2 bytes pc delta / 32000 (int16)]
 *         Computed: lat += prev.lat, lon += prev.lon, at = prev.at - timeDelta
 *
 *   Final: all lat/lon values are divided by 1e5
 *
 * @param {Buffer|Uint8Array} buf - Raw binary data from the endpoint
 * @returns {Array<{id: number, moments: Array<{lat: number, lon: number, at: number}>}>}
 */
function parseAllPositions3(buf) {
  const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const dv = new DataView(arrayBuf);
  const flags = dv.getUint8(0);

  let hasAlt = (flags & 1) === 1;
  const hasDtf = (flags & 2) === 2;
  let hasLaps = (flags & 4) === 4;
  let hasPc = (flags & 8) === 8;
  const superMode = hasPc && hasLaps && hasAlt;
  if (superMode) { hasPc = false; hasLaps = false; hasAlt = false; }

  const baseTimestamp = dv.getUint32(1);
  let pos = 5;
  const teams = [];

  while (pos < arrayBuf.byteLength) {
    const teamId = dv.getUint16(pos); pos += 2;
    const numPositions = superMode ? Number(dv.getBigUint64(pos)) : dv.getUint16(pos);
    const moments = new Array(numPositions);
    pos += superMode ? 8 : 2;

    let prev = {};
    for (let i = 0; i < numPositions; i++) {
      const firstByte = dv.getUint8(pos);
      const m = {};

      if ((firstByte & 128) === 128) {
        // Delta-encoded
        let timeBits = dv.getUint16(pos); pos += 2;
        const dlat = dv.getInt16(pos); pos += 2;
        const dlon = dv.getInt16(pos); pos += 2;
        if (hasAlt) { m.alt = dv.getInt16(pos); pos += 2; }
        if (hasDtf) {
          const dd = dv.getInt16(pos); pos += 2;
          m.dtf = ((prev?.dtf) ?? 0) + dd;
          if (hasLaps) { m.lap = dv.getUint8(pos); pos++; }
        }
        if (hasPc) { m.pc = dv.getInt16(pos) / 32000; pos += 2; }
        timeBits = timeBits & 32767;
        m.lat = (prev.lat ?? 0) + dlat;
        m.lon = (prev.lon ?? 0) + dlon;
        m.at = (prev.at ?? 0) - timeBits;
        m.pc = (prev.pc ?? 0) + (m.pc ?? 0);
      } else {
        // Absolute
        const timeOffset = dv.getUint32(pos); pos += 4;
        const lat = dv.getInt32(pos); pos += 4;
        const lon = dv.getInt32(pos); pos += 4;
        if (hasAlt) { m.alt = dv.getInt16(pos); pos += 2; }
        if (hasDtf) {
          const dtf = dv.getInt32(pos); pos += 4;
          m.dtf = dtf;
          if (hasLaps) { m.lap = dv.getUint8(pos); pos++; }
        }
        if (hasPc) { m.pc = dv.getInt32(pos) / 21000000; pos += 4; }
        m.lat = lat;
        m.lon = lon;
        m.at = baseTimestamp + timeOffset;
      }
      moments[i] = m;
      prev = m;
    }

    // Convert from integer encoding to decimal degrees
    moments.forEach(m => { m.lat /= 1e5; m.lon /= 1e5; });
    teams.push({ id: teamId, moments });
  }

  return teams;
}

/**
 * Convert moments array to GPX string
 * @param {string} name - Track name
 * @param {Array} moments - Position array from parseAllPositions3
 * @param {boolean} sortAsc - Sort by time ascending (default: true)
 * @returns {string} GPX XML string
 */
function toGPX(name, moments, sortAsc = true) {
  const sorted = [...moments];
  if (sortAsc) sorted.sort((a, b) => a.at - b.at);

  let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="YB Tracking Export" xmlns="http://www.topografix.com/GPX/1/1">
 <trk>
  <name>${name}</name>
  <type>Sail</type>
  <trkseg>
`;
  for (const m of sorted) {
    const time = new Date(m.at * 1000).toISOString();
    gpx += `   <trkpt lat="${m.lat}" lon="${m.lon}"><time>${time}</time></trkpt>\n`;
  }
  gpx += `  </trkseg>
 </trk>
</gpx>`;
  return gpx;
}

/**
 * Calculate haversine distance between two points in nautical miles
 * @param {number} lat1 - Latitude of point 1 (degrees)
 * @param {number} lon1 - Longitude of point 1 (degrees)
 * @param {number} lat2 - Latitude of point 2 (degrees)
 * @param {number} lon2 - Longitude of point 2 (degrees)
 * @returns {number} Distance in nautical miles
 */
function haversineNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // earth radius in nm
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Calculate distance-to-finish along a rhumb line (sum of segments from
 * the nearest point on the rhumb line to the finish).
 *
 * @param {number} lat - Current latitude
 * @param {number} lon - Current longitude
 * @param {Array<[number,number]>} rhumbLine - Array of [lat, lon] waypoints (start to finish)
 * @returns {number} Distance to finish in nautical miles
 */
function distanceToFinish(lat, lon, rhumbLine) {
  // Find the nearest segment on the rhumb line
  let minDist = Infinity;
  let nearestIdx = 0;
  for (let i = 0; i < rhumbLine.length; i++) {
    const d = haversineNm(lat, lon, rhumbLine[i][0], rhumbLine[i][1]);
    if (d < minDist) { minDist = d; nearestIdx = i; }
  }

  // Sum remaining rhumb line segments from nearest waypoint to finish
  let dtf = haversineNm(lat, lon, rhumbLine[nearestIdx][0], rhumbLine[nearestIdx][1]);
  // If nearest is behind us, start from next waypoint
  if (nearestIdx < rhumbLine.length - 1) {
    for (let i = nearestIdx; i < rhumbLine.length - 1; i++) {
      dtf += haversineNm(rhumbLine[i][0], rhumbLine[i][1], rhumbLine[i + 1][0], rhumbLine[i + 1][1]);
    }
  }
  // But if we're closest to a waypoint ahead, subtract the segment we already passed
  // Simple approach: distance from current pos to nearest, then nearest to finish
  if (nearestIdx > 0) {
    // Recalculate: just use distance from current pos to nearest waypoint + remaining
    let remaining = 0;
    for (let i = nearestIdx; i < rhumbLine.length - 1; i++) {
      remaining += haversineNm(rhumbLine[i][0], rhumbLine[i][1], rhumbLine[i + 1][0], rhumbLine[i + 1][1]);
    }
    dtf = minDist + remaining;
  }

  return dtf;
}

/**
 * Calculate Projected Corrected Time for IRC handicap racing.
 *
 * Formula:
 *   Projected Corrected Time = (elapsed + DTF / avgSpeed) × TcF
 *
 * Where:
 *   - elapsed = time since race start (seconds)
 *   - DTF = distance to finish along rhumb line (nm)
 *   - avgSpeed = distance sailed so far / elapsed time (knots)
 *   - TcF = IRC Time Correction Factor (from RaceSetup team.tcf2)
 *
 * IRC Corrected Time (at finish):
 *   Corrected Time = Elapsed Time × TcF
 *   - Verified: Fenice 221321s × 1.206 = 266913s (matches YB leaderboard cElapsed)
 *   - Lower corrected time = better ranking
 *   - Higher TcF = faster boat (penalized more)
 *
 * During race (projected):
 *   - DTF calculated from current position to finish along rhumb line waypoints
 *   - avgSpeed from distance made good / elapsed (not VMG which is wind-relative)
 *   - Projected total elapsed = elapsed + DTF / avgSpeed
 *   - Then multiply by TcF for corrected time
 *
 * @param {number} elapsed - Seconds since race start
 * @param {number} distSailed - Distance sailed so far in nautical miles
 * @param {number} dtf - Distance to finish in nautical miles
 * @param {number} tcf - IRC Time Correction Factor
 * @returns {{ projectedElapsed: number, projectedCorrected: number, avgSpeed: number }}
 */
function projectedCorrectedTime(elapsed, distSailed, dtf, tcf) {
  const avgSpeed = elapsed > 0 ? distSailed / (elapsed / 3600) : 0; // knots
  const remainingTime = avgSpeed > 0 ? (dtf / avgSpeed) * 3600 : Infinity; // seconds
  const projectedElapsed = elapsed + remainingTime;
  const projectedCorrected = projectedElapsed * tcf;
  return { projectedElapsed, projectedCorrected, avgSpeed };
}

module.exports = { parseAllPositions3, toGPX, haversineNm, distanceToFinish, projectedCorrectedTime };
