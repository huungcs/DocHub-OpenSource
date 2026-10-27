const fs = require('fs');
const c = fs.readFileSync('dist/index.html', 'utf8');

const checks = [
  ['Canonical', c.includes('rel="canonical"')],
  ['Open Graph Title', c.includes('og:title')],
  ['Open Graph Image', c.includes('og:image')],
  ['Twitter Card', c.includes('twitter:card')],
  ['GEO Region', c.includes('name="geo.region" content="VN"')],
  ['GEO Coordinates', c.includes('name="geo.position"')],
  ['Content Language', c.includes('content-language')],
  ['JSON-LD Schema', c.includes('application/ld+json')],
  ['SoftwareApplication Schema', c.includes('"@type": "SoftwareApplication"')],
  ['FAQPage Schema', c.includes('"@type": "FAQPage"')],
  ['Robots.txt in dist', fs.existsSync('dist/robots.txt')],
  ['Sitemap.xml in dist', fs.existsSync('dist/sitemap.xml')],
  ['OG Image PNG in dist', fs.existsSync('dist/assets/og-image.png')]
];

console.log('=== SEO & GEO VERIFICATION REPORT ===');
let allPassed = true;
for (const [name, passed] of checks) {
  console.log(`${passed ? '✔ PASS' : '❌ FAIL'}: ${name}`);
  if (!passed) allPassed = false;
}

if (allPassed) console.log('\nALL SEO & GEO CHECKS PASSED (100%)!');
else process.exit(1);
