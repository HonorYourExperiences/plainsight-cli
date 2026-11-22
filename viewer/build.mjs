// Bundle several analyzer graphs into one report (used for the demo page).
// usage: node viewer/build.mjs out.html graph1.json[:sample] graph2.json ...
import fs from "node:fs";
import path from "node:path";
import { renderReport } from "../src/report.mjs";
const [out, ...inputs] = process.argv.slice(2);
const graphs = inputs.map((arg) => {
  const [file, flag] = arg.split(":");
  const g = JSON.parse(fs.readFileSync(file, "utf8"));
  if (flag === "sample") g.sample = true;
  return g;
});
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, renderReport(graphs, { webFonts: true })); // a hosted demo page: web fonts are fine here
console.log(`wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB, ${graphs.length} graphs)`);
