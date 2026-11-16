// خواننده‌ی حداقلی و بدون هیچ وابستگی خارجی برای فایل‌های .xlsx —
// همتای lib/xlsx.js (که فقط می‌نویسد). فقط برگه‌ی اول فایل را می‌خواند،
// و سلول‌های متنی (inlineStr و shared strings) و عددی را پشتیبانی می‌کند —
// همان چیزی که هم فایل خروجی خودِ برنامه و هم یک فایل معمولی ذخیره‌شده با
// Excel/LibreOffice تولید می‌کنند.

const zlib = require('zlib');

function readUInt32LE(buf, off) { return buf.readUInt32LE(off); }
function readUInt16LE(buf, off) { return buf.readUInt16LE(off); }

// آرشیو ZIP را با خواندن دایرکتوری مرکزی (از انتهای فایل) باز می‌کند و یک
// Map از نام فایل به Buffer (از حالت فشرده خارج‌شده) برمی‌گرداند.
function readZipEntries(buf) {
  // پیدا کردن رکورد End Of Central Directory (EOCD) از انتهای فایل
  const EOCD_SIG = 0x06054b50;
  let eocdOffset = -1;
  const minPos = Math.max(0, buf.length - 65557); // حداکثر اندازه‌ی ممکن comment
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (readUInt32LE(buf, i) === EOCD_SIG) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error('فایل ZIP/XLSX معتبر نیست (EOCD پیدا نشد)');

  const entryCount = readUInt16LE(buf, eocdOffset + 10);
  const centralDirOffset = readUInt32LE(buf, eocdOffset + 16);

  const entries = new Map();
  let pos = centralDirOffset;
  const CENTRAL_SIG = 0x02014b50;
  for (let i = 0; i < entryCount; i++) {
    if (readUInt32LE(buf, pos) !== CENTRAL_SIG) break;
    const method = readUInt16LE(buf, pos + 10);
    const compSize = readUInt32LE(buf, pos + 20);
    const nameLen = readUInt16LE(buf, pos + 28);
    const extraLen = readUInt16LE(buf, pos + 30);
    const commentLen = readUInt16LE(buf, pos + 32);
    const localHeaderOffset = readUInt32LE(buf, pos + 42);
    const name = buf.slice(pos + 46, pos + 46 + nameLen).toString('utf8');

    entries.set(name, { method, compSize, localHeaderOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }

  const out = new Map();
  for (const [name, meta] of entries) {
    const lp = meta.localHeaderOffset;
    const LOCAL_SIG = 0x04034b50;
    if (readUInt32LE(buf, lp) !== LOCAL_SIG) continue;
    const nameLen = readUInt16LE(buf, lp + 26);
    const extraLen = readUInt16LE(buf, lp + 28);
    const dataStart = lp + 30 + nameLen + extraLen;
    const compressed = buf.slice(dataStart, dataStart + meta.compSize);
    let data;
    if (meta.method === 0) data = compressed;
    else if (meta.method === 8) data = zlib.inflateRawSync(compressed);
    else continue; // روش فشرده‌سازی پشتیبانی‌نشده (به‌ندرت پیش می‌آید)
    out.set(name, data);
  }
  return out;
}

function decodeXmlEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    const body = m[1];
    // یک <si> می‌تواند چند <t> داشته باشد (متن با فرمت‌بندی چندبخشی)؛ همه را می‌چسبانیم.
    const parts = [];
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let tm;
    while ((tm = tRe.exec(body))) parts.push(decodeXmlEntities(tm[1]));
    out.push(parts.join(''));
  }
  return out;
}

function colLetterToIndex(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1; // اندیس از صفر
}

// فایل sheetN.xml را به آرایه‌ای از ردیف‌ها تبدیل می‌کند؛ هر ردیف آرایه‌ای از
// مقادیر متنی است (سلول‌های خالی/جاافتاده با رشته‌ی خالی پر می‌شوند).
function parseSheetRows(xml, sharedStrings) {
  const rows = [];
  const rowRe = /<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const rowNum = Number(rm[1]);
    const body = rm[2];
    const cells = [];
    const cellRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(body))) {
      const attrs = cm[1] || '';
      const inner = cm[2] || '';
      const refM = /r="([A-Z]+)\d+"/.exec(attrs);
      if (!refM) continue;
      const colIdx = colLetterToIndex(refM[1]);
      const typeM = /t="([^"]+)"/.exec(attrs);
      const type = typeM ? typeM[1] : null;

      let value = '';
      if (type === 'inlineStr') {
        const tM = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner);
        value = tM ? decodeXmlEntities(tM[1]) : '';
      } else if (type === 's') {
        const vM = /<v>([\s\S]*?)<\/v>/.exec(inner);
        const idx = vM ? Number(vM[1]) : -1;
        value = sharedStrings[idx] !== undefined ? sharedStrings[idx] : '';
      } else {
        const vM = /<v>([\s\S]*?)<\/v>/.exec(inner);
        value = vM ? decodeXmlEntities(vM[1]) : '';
      }
      cells[colIdx] = value;
    }
    // cells ممکن است یک آرایه‌ی «سوراخ‌دار» (sparse) باشد — یعنی مثلاً ستون ۵ مقدار
    // دارد ولی ستون ۳ هیچ‌وقت set نشده. Array.prototype.map/slice روی این سوراخ‌ها
    // اصلاً اجرا نمی‌شوند (نه این‌که undefined بدهند)، پس باید صریحاً با '' پر شوند
    // وگرنه در JSON یا هر پردازش بعدی به‌جای رشته‌ی خالی مقدار null ظاهر می‌شود.
    rows[rowNum - 1] = Array.from({ length: cells.length }, (_, i) => (cells[i] === undefined ? '' : cells[i]));
  }
  // خالی‌های بین ردیف‌ها (ردیف کاملاً خالی در اکسل) را به آرایه‌ی خالی تبدیل می‌کند
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

// اولین برگه‌ی یک فایل xlsx را می‌خواند و آرایه‌ای از ردیف‌ها (هر ردیف آرایه‌ای
// از رشته‌ها) برمی‌گرداند. ردیف اول معمولاً سرستون‌هاست.
function readFirstSheetRows(buf) {
  const entries = readZipEntries(buf);
  const sheetName =
    [...entries.keys()].find((n) => n === 'xl/worksheets/sheet1.xml') ||
    [...entries.keys()].sort().find((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  if (!sheetName) throw new Error('برگه‌ای در فایل اکسل پیدا نشد');

  const sharedStringsXml = entries.has('xl/sharedStrings.xml')
    ? entries.get('xl/sharedStrings.xml').toString('utf8')
    : '';
  const sharedStrings = parseSharedStrings(sharedStringsXml);

  const sheetXml = entries.get(sheetName).toString('utf8');
  const rows = parseSheetRows(sheetXml, sharedStrings);

  const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
  return rows.map((r) => {
    const out = r.slice();
    while (out.length < width) out.push('');
    return out.map((v) => (v === undefined ? '' : v));
  });
}

// همه‌ی برگه‌های فایل، به ترتیب و با نامشان: [{ name, rows }]
// (برای فایل‌هایی مثل «باشگاه مشتریان» که مشتری‌ها و خریدها در برگه‌های جدا هستند)
function readAllSheets(buf) {
  const entries = readZipEntries(buf);
  const sharedStrings = parseSharedStrings(
    entries.has('xl/sharedStrings.xml') ? entries.get('xl/sharedStrings.xml').toString('utf8') : ''
  );
  const wb = entries.has('xl/workbook.xml') ? entries.get('xl/workbook.xml').toString('utf8') : '';
  const rels = entries.has('xl/_rels/workbook.xml.rels') ? entries.get('xl/_rels/workbook.xml.rels').toString('utf8') : '';
  const target = {};
  (rels.match(/<Relationship\b[^>]*>/g) || []).forEach((tag) => {
    const id = /\bId="([^"]+)"/.exec(tag);
    const t = /\bTarget="([^"]+)"/.exec(tag);
    if (id && t) target[id[1]] = t[1];
  });
  const sheets = [];
  (wb.match(/<sheet\b[^>]*>/g) || []).forEach((tag) => {
    const name = /\bname="([^"]+)"/.exec(tag);
    const rid = /\br:id="([^"]+)"/.exec(tag);
    if (!name || !rid || !target[rid[1]]) return;
    const path = 'xl/' + target[rid[1]].replace(/^\/?xl\//, '');
    if (!entries.has(path)) return;
    const rows = parseSheetRows(entries.get(path).toString('utf8'), sharedStrings);
    const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
    sheets.push({
      name: decodeXmlEntities(name[1]),
      rows: rows.map((r) => {
        const out = r.slice();
        while (out.length < width) out.push('');
        return out.map((v) => (v === undefined ? '' : v));
      }),
    });
  });
  return sheets;
}

module.exports = { readFirstSheetRows, readAllSheets };
