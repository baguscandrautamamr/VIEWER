// Enrich a fresh IfcConvert GLB from its source IFC, then compress safely.
// node scripts/prepare-identified-glb.mjs source.ifc fresh.glb output-web.glb
import fs from 'node:fs';
import { parseIfcElements } from './lib/ifc-elements.mjs';
import { compressGlb, fmtMB } from './lib/compress-glb.mjs';
const [ifc, input, output] = process.argv.slice(2);
if (!ifc || !input || !output) {
  console.error('Usage: node scripts/prepare-identified-glb.mjs source.ifc fresh.glb output-web.glb');
  process.exit(1);
}
const elements = parseIfcElements(fs.readFileSync(ifc, 'utf8'));
if (!elements.length) throw new Error('No IFC identity records found.');
const result = await compressGlb(input, output, { elements });
console.log(`${elements.length} source identities; ${fmtMB(result.before)} -> ${fmtMB(result.after)}`);
