// یک تولیدکننده‌ی حداقلی و بدون هیچ وابستگی خارجی برای فایل‌های .xlsx واقعی.
// یک ZIP معتبر (بدون فشرده‌سازی) شامل فایل‌های XML استاندارد اکسل می‌سازد،
// تا نیازی به نصب پکیج جدید (و در نتیجه npm install دوباره) نباشد.

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function dosDateTime(date) {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f);
  const dateVal =
    (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
  return { time, date: dateVal };
}

// یک آرشیو ZIP ساده و «ذخیره‌شده بدون فشرده‌سازی» می‌سازد — برای فایل‌های کوچک XML
// این کاملاً کافی و کاملاً معتبر است.
function buildZip(files) {
  const { time, date } = dosDateTime(new Date());
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach((f) => {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const data = f.data;
    const crc = crc32(data);
    const size = data.length;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6); // bit 11: نام فایل UTF-8 است
    localHeader.writeUInt16LE(0, 8); // روش فشرده‌سازی: ذخیره (بدون فشرده‌سازی)
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(size, 18);
    localHeader.writeUInt32LE(size, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(size, 20);
    centralHeader.writeUInt32LE(size, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + data.length;
  });

  const centralDirStart = offset;
  const centralDirBuf = Buffer.concat(centralParts);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(centralDirStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

function escapeXml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]
  ));
}

function colLetter(n) {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sanitizeSheetName(name) {
  let s = String(name || 'Sheet1').replace(/[:\\/?*[\]]/g, ' ').trim();
  if (!s) s = 'Sheet1';
  return s.slice(0, 31);
}

function buildSheetXml(headers, rows, numericCols, rtl) {
  numericCols = numericCols || new Set();
  const colCount = headers.length;
  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  xml += '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
  // برگه‌ی راست‌به‌چپ با سطر عنوان ثابت (هنگام اسکرول دیده می‌ماند)
  if (rtl) xml += '<sheetViews><sheetView workbookViewId="0" rightToLeft="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
  xml += '<cols><col min="1" max="' + colCount + '" width="22" customWidth="1"/></cols>';
  xml += '<sheetData>';

  xml += '<row r="1">';
  headers.forEach((h, i) => {
    const ref = colLetter(i + 1) + '1';
    xml += '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + escapeXml(h) + '</t></is></c>';
  });
  xml += '</row>';

  rows.forEach((row, rIdx) => {
    const r = rIdx + 2;
    xml += '<row r="' + r + '">';
    row.forEach((val, cIdx) => {
      const ref = colLetter(cIdx + 1) + r;
      if (val === null || val === undefined || val === '') {
        return;
      }
      if (numericCols.has(cIdx) && !isNaN(Number(val))) {
        xml += '<c r="' + ref + '"><v>' + Number(val) + '</v></c>';
      } else {
        xml += '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + escapeXml(val) + '</t></is></c>';
      }
    });
    xml += '</row>';
  });

  xml += '</sheetData></worksheet>';
  return xml;
}

/**
 * یک بافر فایل .xlsx معتبر با یک برگه می‌سازد.
 * headers: آرایه‌ای از عنوان ستون‌ها
 * rows: آرایه‌ای از آرایه (هر ردیف به ترتیب همان ستون‌ها)
 * numericCols: Set از اندیس ستون‌هایی که باید عددی نوشته شوند (اندیس از ۰)
 */
function buildWorkbookXlsx(sheetName, headers, rows, numericCols) {
  return buildMultiSheetXlsx([{ name: sheetName, headers, rows, numericCols }], { rtl: false });
}

/**
 * چند برگه در یک فایل (مثلاً «خلاصه» + «جزئیات») — sheets: [{ name, headers, rows, numericCols }]
 * opts.rtl (پیش‌فرض true): برگه‌ها راست‌به‌چپ و سطر عنوان ثابت
 */
function buildMultiSheetXlsx(sheets, opts) {
  const rtl = !opts || opts.rtl !== false;
  const list = sheets.map((sh, i) => Object.assign({}, sh, { name: sanitizeSheetName(sh.name || 'Sheet' + (i + 1)), file: 'sheet' + (i + 1) + '.xml' }));

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    list.map((sh) => '<Override PartName="/xl/worksheets/' + sh.file + '" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
    '</Types>';

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const workbookXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' + list.map((sh, i) => '<sheet name="' + escapeXml(sh.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets>' +
    '</workbook>';

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    list.map((sh, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/' + sh.file + '"/>').join('') +
    '</Relationships>';

  const files = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rootRels, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRels, 'utf8') },
  ].concat(list.map((sh) => ({ name: 'xl/worksheets/' + sh.file, data: Buffer.from(buildSheetXml(sh.headers, sh.rows, sh.numericCols, rtl), 'utf8') })));

  return buildZip(files);
}

module.exports = { buildWorkbookXlsx, buildMultiSheetXlsx };
