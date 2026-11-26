// Builds a self-contained browser test view of the Studio (for a hosted page that allows comments).
// Usage: node build.ts && node scripts/build-test-view.mjs <outDir>
// Hosting limits it works around: at most ~500 files and 16MB per text file, so the catalog icons are
// packed into one JSON of data URLs and the large AWS form schema is split into four parts. index.html
// patches image src / fetch to serve those, then imports studio.js unchanged. Samples use the hash:
// #starter, #hub-spoke, #estate.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const out = process.argv[2];
if (!out) { throw new Error('Pass an output folder.'); }
rmSync(out, { recursive: true, force: true });
cpSync(dist, out, { recursive: true, filter: source => !source.endsWith('.map') && !source.includes('catalog-icons') && !source.includes('provenance') && !source.endsWith('index.html') });

const iconsDir = join(dist, 'assets', 'catalog-icons');
const icons = {};
for (const name of readdirSync(iconsDir, { recursive: true })) {
	const file = String(name).replaceAll('\\', '/');
	if (file.endsWith('.svg')) { icons['./assets/catalog-icons/' + file] = 'data:image/svg+xml;base64,' + readFileSync(join(iconsDir, file)).toString('base64'); }
}
writeFileSync(join(out, 'catalog-icons.json'), JSON.stringify(icons));

const awsFile = join(out, 'assets', 'provider-forms', 'aws', 'resources.json');
if (existsSync(awsFile)) {
	const aws = JSON.parse(readFileSync(awsFile, 'utf8'));
	const size = Math.ceil(aws.resources.length / 4);
	for (let n = 0; n < 4; n++) {
		writeFileSync(join(out, 'assets', 'provider-forms', 'aws', 'resources.part' + (n + 1) + '.json'), JSON.stringify({ ...aws, resources: aws.resources.slice(n * size, (n + 1) * size) }));
	}
	rmSync(awsFile);
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'index.html'), readFileSync(new URL('./test-view.html', import.meta.url), 'utf8'));
console.log('Test view written to ' + out);
