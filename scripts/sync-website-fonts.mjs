/* Author: ramanpal singh | URL: https://kwebby.com */
// Explicit maintenance command; production builds and browsers never call Google.
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname,join } from 'node:path';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const destination=join(root,'apps/web/public/fonts');
const cssPath=join(root,'apps/web/components/website-fonts.css');
const families=[
 ['inter','Inter','inter'],['source-sans-3','Source Sans 3','sourcesans3'],['manrope','Manrope','manrope'],
 ['dm-sans','DM Sans','dmsans'],['source-serif-4','Source Serif 4','sourceserif4'],['lora','Lora','lora'],
 ['noto-sans','Noto Sans','notosans'],['noto-sans-devanagari','Noto Sans Devanagari','notosansdevanagari'],
 ['noto-sans-gurmukhi','Noto Sans Gurmukhi','notosansgurmukhi']
];
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
function ensure(condition,message){if(!condition)throw new Error(message)}
function verifyWoff2(bytes,label){ensure(bytes.length>=48&&bytes.length<=1024*1024,`${label}: unexpected font size`);ensure(bytes.toString('ascii',0,4)==='wOF2',`${label}: expected WOFF2 binary`);ensure(bytes.readUInt32BE(8)===bytes.length,`${label}: WOFF2 length mismatch`);ensure(bytes.readUInt16BE(12)>0&&bytes.readUInt32BE(16)>0,`${label}: missing font tables`)}
async function download(url,limit=1024*1024){
 const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'},signal:AbortSignal.timeout(25000),redirect:'error'});
 ensure(response.ok,`Unable to download ${url}: HTTP ${response.status}`);ensure(Number(response.headers.get('content-length')||0)<=limit,'Download exceeds limit');
 const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;ensure(size<=limit,'Download exceeds limit');chunks.push(chunk)}return Buffer.concat(chunks);
}
async function verify(){
 const manifest=JSON.parse(await readFile(join(destination,'SOURCES.json'),'utf8'));let files=0,bytes=0;
 ensure(manifest.families.length===families.length,'Incomplete font catalog');
 for(const family of manifest.families){
  const license=await readFile(join(destination,family.license.file));ensure(sha256(license)===family.license.sha256,'License checksum mismatch');ensure(/SIL OPEN FONT LICENSE Version 1\.1/i.test(license.toString()),'Unexpected font license');
  for(const asset of family.assets){const data=await readFile(join(destination,asset.file));verifyWoff2(data,asset.file);ensure(data.length===asset.bytes&&sha256(data)===asset.sha256,'Font checksum mismatch');files++;bytes+=data.length;}
 }
 const css=await readFile(cssPath,'utf8');ensure(!/url\((?!['"]?\/fonts\/)/.test(css),'Font CSS must use local files only');ensure((css.match(/@font-face/g)||[]).length===files,'Font CSS and manifest disagree');
 console.log(`Verified ${manifest.families.length} font families, ${files} WOFF2 files, ${bytes} bytes; all fonts and licenses match their SHA-256 digests.`);
}
if(process.argv.includes('--verify')){await verify();process.exit(0)}
await mkdir(destination,{recursive:true});
const commit=JSON.parse((await download('https://api.github.com/repos/google/fonts/commits/main')).toString()).sha;
ensure(/^[a-f0-9]{40}$/.test(commit),'Google Fonts repository revision is unavailable');
const manifest={author:'ramanpal singh',url:'https://kwebby.com',downloadedAt:new Date().toISOString(),licenseRepository:'https://github.com/google/fonts',licenseRevision:commit,description:'Unmodified official Google Fonts WOFF2 subsets, self-hosted; normal variable weights 400–700. No runtime Google requests.',families:[]};
const css=['/* Author: ramanpal singh | URL: https://kwebby.com */','/* Self-hosted Google Fonts. Original OFL notices and source hashes: /fonts/SOURCES.json. */'];
for(const [id,family,directory]of families){
 const licenseUrl=`https://raw.githubusercontent.com/google/fonts/${commit}/ofl/${directory}/OFL.txt`;
 const license=await download(licenseUrl,20000);ensure(/SIL OPEN FONT LICENSE Version 1\.1/i.test(license.toString()),`${family}: expected verified OFL-1.1 source`);
 const licenseFile=`${id}-OFL.txt`;await writeFile(join(destination,licenseFile),license);
 const stylesheetUrl=`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replaceAll('%20','+')}:wght@400..700&display=swap`;
 const stylesheet=(await download(stylesheetUrl,100000)).toString();
 const allowed=new Set(['latin','latin-ext',...(id.endsWith('devanagari')?['devanagari']:[]),...(id.endsWith('gurmukhi')?['gurmukhi']:[])]);
 const entry={id,family,stylesheetUrl,stylesheetSha256:sha256(stylesheet),license:{spdx:'OFL-1.1',sourceUrl:licenseUrl,file:licenseFile,sha256:sha256(license)},assets:[]};
 for(const match of stylesheet.matchAll(/\/\*\s*([^*]+?)\s*\*\/\s*(@font-face\s*\{[^}]+\})/g)){
  const subset=match[1].trim(),rule=match[2];if(!allowed.has(subset))continue;
  const source=rule.match(/src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/)?.[1];ensure(source,`${family}/${subset}: unsupported font source`);
  const weight=rule.match(/font-weight:\s*([^;]+);/)?.[1]?.trim(),unicodeRange=rule.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim();
  ensure(weight==='400 700',`${family}: expected normal variable 400–700 range`);ensure(unicodeRange,`${family}: expected subset unicode range`);
  const bytes=await download(source);verifyWoff2(bytes,`${family}/${subset}`);const hash=sha256(bytes),file=`${id}-${subset}-${hash.slice(0,12)}.woff2`;
  await writeFile(join(destination,file),bytes);entry.assets.push({subset,file,bytes:bytes.length,sha256:hash,sourceUrl:source,weight,style:'normal',unicodeRange});
  css.push(`/* ${family} — ${subset} */\n@font-face {\n  font-family: '${family}';\n  font-style: normal;\n  font-weight: 400 700;\n  font-display: swap;\n  src: url('/fonts/${file}') format('woff2');\n  unicode-range: ${unicodeRange};\n}`);
 }
 for(const subset of allowed)ensure(entry.assets.some(asset=>asset.subset===subset),`${family}: missing ${subset} subset`);
 manifest.families.push(entry);console.log(`Downloaded ${family}: ${entry.assets.length} subsets; verified OFL-1.1`);
}
await writeFile(join(destination,'SOURCES.json'),`${JSON.stringify(manifest,null,2)}\n`);
await writeFile(cssPath,`${css.join('\n\n')}\n`);
await writeFile(join(destination,'README.md'),`<!-- Author: ramanpal singh | URL: https://kwebby.com -->\n# Self-hosted website font catalog\n\nNine Google Fonts families are bundled as unmodified official WOFF2 files. Each family includes its original SIL Open Font License 1.1 notice. SOURCES.json records the pinned Google Fonts license repository revision, source URLs, download date, byte sizes and SHA-256 checksums. The generated stylesheet contains only same-origin /fonts/ URLs with font-display: swap; fonts are requested only when selected and required by the text's Unicode ranges.\n\nIncluded subsets: Latin and Latin Extended for every family, plus Devanagari and Gurmukhi in their respective Noto families. These files cover normal variable weights 400–700; italic uses the browser's synthesized style. Other writing systems use the configured system fallback.\n\nVerify locally: node scripts/sync-website-fonts.mjs --verify\n\nAn explicit maintenance refresh uses node scripts/sync-website-fonts.mjs. Review source/version/hash changes before release. Production builds do not run that command and do not need network access to Google. Original third-party licenses remain unchanged; the project watermark applies to the packaging script and stylesheet, not to font authorship.\n`);
await verify();
