#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const htmlPath = path.resolve(__dirname, '../../InkFlow_V1.15.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const marker = '/* V1.15 ridge-aware terrain material:';
const start = html.indexOf(marker), end = html.indexOf('class Terrain3D{', start);
assert.ok(start >= 0 && end > start, 'Could not extract the production ridge-field helper');
const api = new Function(html.slice(start, end) + '\nreturn { buildRidgeField, ridgeAlignedWash };')();
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(1664525, s) + 1013904223) >>> 0) / 4294967296); }
function axialError(a, b) { return Math.acos(Math.min(1, Math.abs(Math.cos(a - b)))) * 180 / Math.PI; }
function mean(a) { return a.reduce((x, y) => x + y, 0) / Math.max(1, a.length); }
function percentile(a, p) { const sorted = a.slice().sort((x, y) => x - y); return sorted[Math.floor(p * (sorted.length - 1))]; }
const width = 40, height = 26, dx = 3.35 / (width - 1), dz = 2.42 / (height - 1);
const straightErrors = [], straightAccepted = [];
for (const noise of [0, 0.003, 0.01, 0.02]) for (const angle of [0, 17, 43, 79, 121, 158]) for (const seed of [27, 91, 173]) {
  const random = rng(seed), theta = angle * Math.PI / 180, c = Math.cos(theta), s = Math.sin(theta);
  const fieldHeight = new Float64Array(width * height), land = new Uint8Array(width * height).fill(1), ridgeWidth = 0.31;
  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
    const X = (x - (width - 1) / 2) * dx, Z = (z - (height - 1) / 2) * dz, u = X * c + Z * s;
    fieldHeight[z * width + x] = Math.exp(-u * u / (2 * ridgeWidth * ridgeWidth)) + noise * (2 * random() - 1);
  }
  const field = api.buildRidgeField(fieldHeight, land, width, height, dx, dz, 1.3), caseErrors = [];
  for (let z = 3; z < height - 3; z++) for (let x = 3; x < width - 3; x++) {
    const X = (x - (width - 1) / 2) * dx, Z = (z - (height - 1) / 2) * dz, u = X * c + Z * s, i = z * width + x;
    if (Math.abs(u) < ridgeWidth * 0.45 && field[i * 3 + 2] > 0.25) caseErrors.push(axialError(Math.atan2(field[i * 3 + 1], field[i * 3]), theta));
  }
  straightErrors.push(...caseErrors); straightAccepted.push(caseErrors.length);
}
assert.ok(straightErrors.length > 6000, 'Straight-ridge sample coverage unexpectedly low');
const straight = { cases:72, acceptedSamples:straightErrors.length, meanErrorDeg:+mean(straightErrors).toFixed(3), p90ErrorDeg:+percentile(straightErrors,0.9).toFixed(3), maxErrorDeg:+Math.max(...straightErrors).toFixed(3), meanAcceptedPerCase:+mean(straightAccepted).toFixed(1) };
assert.ok(straight.meanErrorDeg < 0.6 && straight.p90ErrorDeg < 1.5, 'Straight-ridge direction accuracy regressed');
const curvedErrors = [];
for (const seed of [27, 91, 173]) {
  const random = rng(seed), fieldHeight = new Float64Array(width * height), land = new Uint8Array(width * height).fill(1);
  const amplitude = 0.18, frequency = 2 * Math.PI / 3.2, ridgeWidth = 0.31;
  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
    const X = (x - (width - 1) / 2) * dx, Z = (z - (height - 1) / 2) * dz;
    const f = amplitude * Math.sin(frequency * X), fp = amplitude * frequency * Math.cos(frequency * X), u = (Z - f) / Math.sqrt(1 + fp * fp);
    fieldHeight[z * width + x] = Math.exp(-u * u / (2 * ridgeWidth * ridgeWidth)) + 0.01 * (2 * random() - 1);
  }
  const field = api.buildRidgeField(fieldHeight, land, width, height, dx, dz, 1.3);
  for (let z = 3; z < height - 3; z++) for (let x = 3; x < width - 3; x++) {
    const X = (x - (width - 1) / 2) * dx, Z = (z - (height - 1) / 2) * dz;
    const f = amplitude * Math.sin(frequency * X), fp = amplitude * frequency * Math.cos(frequency * X), u = (Z - f) / Math.sqrt(1 + fp * fp), i = z * width + x;
    if (Math.abs(u) < ridgeWidth * 0.45 && field[i * 3 + 2] > 0.25) curvedErrors.push(axialError(Math.atan2(field[i * 3 + 1], field[i * 3]), Math.atan2(1, -fp)));
  }
}
const curved = { seeds:3, acceptedSamples:curvedErrors.length, meanErrorDeg:+mean(curvedErrors).toFixed(3), p90ErrorDeg:+percentile(curvedErrors,0.9).toFixed(3), maxErrorDeg:+Math.max(...curvedErrors).toFixed(3) };
assert.ok(curved.meanErrorDeg < 1 && curved.p90ErrorDeg < 1.5, 'Curved-ridge direction accuracy regressed');
function generatedTerrain(w, h, seed, layout) {
  const phase = (seed % 10007) * 0.013, relief = layout === 'high' ? 1.15 : layout === 'flat' ? 0.58 : 1;
  const river = v => 0.50 + 0.09 * Math.sin(v * 5.5 + phase * 0.48) + 0.025 * Math.sin(v * 14 + phase);
  const ridge = (u, v, cx, cz, sx, sz, amp, j) => { const bend = 0.022 * Math.sin(v * 12 + phase + j * 2), xx = (u - cx - bend) / sx, zz = (v - cz) / sz; return amp * Math.exp(-1.7 * (xx * xx + zz * zz)) * (0.84 + 0.16 * Math.cos(u * 29 + v * 17 + j + phase)); };
  const chains = [[0.12,0.14,0.21,0.16,0.57],[0.30,0.21,0.16,0.18,0.69],[0.18,0.39,0.18,0.24,0.66],[0.73,0.12,0.23,0.18,0.66],[0.85,0.32,0.15,0.23,0.79],[0.70,0.53,0.15,0.18,0.46],[0.12,0.70,0.19,0.22,0.55],[0.89,0.83,0.20,0.22,0.44]];
  const fieldHeight = new Float64Array(w * h), land = new Uint8Array(w * h);
  for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
    const i = z * w + x, u = x / (w - 1), v = z / (h - 1), bank = Math.abs(u - river(v)), channel = 0.018 + 0.018 * v;
    let mountains = 0; for (let j = 0; j < chains.length; j++) mountains += ridge(u, v, ...chains[j], j);
    const detail = 0.92 + 0.08 * Math.sin(u * 51 + v * 23 + phase) + 0.04 * Math.sin(u * 113 - v * 39 + phase);
    const floodplain = 0.088 + 0.036 * Math.sin(u * 17 + v * 10 + phase) ** 2, banks = 1 - Math.exp(-((bank / channel) ** 4));
    const hh = 0.019 + 0.017 * (1 - v) + banks * (floodplain + mountains * relief * detail);
    fieldHeight[i] = Math.max(0.006, hh); land[i] = hh > 0.064 ? 1 : 0;
  }
  return { fieldHeight, land };
}
const terrainCases = [];
for (const [w, h] of [[40,26],[64,40]]) {
  const cellX = 3.35 / (w - 1), cellZ = 2.42 / (h - 1);
  for (const layout of ['deep','high','flat']) for (const seed of [17,27,91,173,509]) {
    const terrain = generatedTerrain(w,h,seed,layout), field = api.buildRidgeField(terrain.fieldHeight,terrain.land,w,h,cellX,cellZ,1.3);
    let landCells=0,accepted=0,confidence=0,invalid=0,angleDelta=0,pairs=0;
    for(let z=0;z<h;z++)for(let x=0;x<w;x++){const i=z*w+x;if(!terrain.land[i])continue;landCells++;const c=field[i*3+2];if(!Number.isFinite(c))invalid++;if(c>=0.25){accepted++;confidence+=c;if(x+1<w&&field[(i+1)*3+2]>=0.25){const a=Math.atan2(field[i*3+1],field[i*3]),b=Math.atan2(field[(i+1)*3+1],field[(i+1)*3]);angleDelta+=axialError(a,b);pairs++;}}}
    terrainCases.push({resolution:w+'x'+h,layout,seed,landCoveragePct:+(100*accepted/landCells).toFixed(1),meanConfidence:accepted?+(confidence/accepted).toFixed(3):0,neighborAngleMeanDeg:pairs?+(angleDelta/pairs).toFixed(2):null,invalidValues:invalid});
  }
}
const generated = { cases:terrainCases.length, landCoverageMinPct:Math.min(...terrainCases.map(x=>x.landCoveragePct)), landCoverageMaxPct:Math.max(...terrainCases.map(x=>x.landCoveragePct)), meanConfidence:+mean(terrainCases.map(x=>x.meanConfidence)).toFixed(3), meanNeighborAngleDeg:+mean(terrainCases.map(x=>x.neighborAngleMeanDeg)).toFixed(2), invalidValues:terrainCases.reduce((sum,x)=>sum+x.invalidValues,0) };
assert.ok(generated.landCoverageMinPct>15&&generated.landCoverageMaxPct<30,'Unexpected ridge-field coverage');
assert.equal(generated.invalidValues,0,'Non-finite ridge-field values detected');
const flatHeight=new Float64Array(width*height),flatLand=new Uint8Array(width*height).fill(1),random=rng(88);
for(let i=0;i<flatHeight.length;i++)flatHeight[i]=0.1+0.003*(2*random()-1);
const flatField=api.buildRidgeField(flatHeight,flatLand,width,height,dx,dz,1.3);
let flatMaxConfidence=0;for(let i=0;i<width*height;i++)flatMaxConfidence=Math.max(flatMaxConfidence,flatField[i*3+2]);
assert.equal(flatMaxConfidence,0,'Flat low-amplitude noise should not create ridge directions');
const washSamples=[];
for(let i=0;i<1000;i++)washSamples.push(api.ridgeAlignedWash((i%40)/12,Math.floor(i/40)/12,0.6,0.8,(i%100)/100,(i%10)/10));
const wash={samples:washSamples.length,min:+Math.min(...washSamples).toFixed(6),max:+Math.max(...washSamples).toFixed(6),allFinite:washSamples.every(Number.isFinite),maxAbs:+Math.max(...washSamples.map(Math.abs)).toFixed(6)};
assert.ok(wash.allFinite&&wash.maxAbs<0.01,'Directional wash exceeded its intended subtle amplitude');
const result={experiment:'InkFlow V1.15 ridge-aware terrain integration validation',implementation:'buildRidgeField and ridgeAlignedWash extracted from the production HTML',parameters:{gaussianSigmaCells:1.3,confidenceAcceptanceThreshold:0.25,ridgeWidthWorldUnits:0.31,straightNoiseAmplitudes:[0,0.003,0.01,0.02],straightAnglesDeg:[0,17,43,79,121,158],seeds:[27,91,173]},results:{straightRidges:straight,curvedRidge:curved,generatedTerrain:generated,flatNoise:{maxConfidence:flatMaxConfidence},directionalWash:wash},generatedTerrainCases:terrainCases,limitations:['Straight and curved Gaussian ridge tests measure direction recovery on synthetic fields, not perceived art quality.','Generated terrain tests mirror the current EcoSim initial height-field formula; they do not run the full ecological simulation.','No real-browser WebGL screenshot, GPU compatibility, frame-rate, or long-duration ecological regression test was performed.']};
console.log(JSON.stringify(result,null,2));
