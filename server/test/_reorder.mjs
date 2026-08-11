import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('./api.test.mjs', import.meta.url));
const lines = readFileSync(file, 'utf8').split('\n');

const idx = (re) => lines.findIndex((l) => re.test(l));
const iPublic = idx(/SECTION 9: Public endpoints/);
const iAdmin = idx(/SECTION 10: Resolved issues \+ proof upload/);
const iOfficer = idx(/SECTION 11: Officer workflow/);
const iSummary = idx(/Summary/);
if (iPublic < 0 || iAdmin < 0 || iOfficer < 0 || iSummary < 0) throw new Error(`markers not found: ${iPublic},${iAdmin},${iOfficer},${iSummary}`);

const grab = (a, b) => lines.slice(a, b);

const publicBlock = grab(iPublic, iAdmin);
const adminBlock = grab(iAdmin, iOfficer);
const officerBlock = grab(iOfficer, iSummary);

const renum = (block, from, to) =>
  block.map((l) =>
    l
      .replace(new RegExp(`(step\\(')${from}\\.`), `$1${to}.`)
      .replace(new RegExp(`SECTION ${from}: `), `SECTION ${to}: `)
      .replace(new RegExp(`^  section\\('${from}\\.`), `  section('${to}.`),
  );

const newOfficer = renum(officerBlock, '11', '9');
const newPublic = renum(publicBlock, '9', '10');
const newAdmin = renum(adminBlock, '10', '11');

const out = [...lines.slice(0, iPublic), ...newOfficer, ...newPublic, ...newAdmin, ...lines.slice(iSummary)];
writeFileSync(file, out.join('\n'), 'utf8');
console.log('reordered OK', { iPublic, iAdmin, iOfficer, iSummary });
