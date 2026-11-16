// آماده‌سازی فایل مدرک برای ذخیره روی سرور CRM:
//   - HEIC/HEIF (عکس آیفون و بعضی سامسونگ‌ها) ← JPEG، تا در همه‌ی مرورگرها دیده شود
//   - هر عکس تا ۱۶۰۰ پیکسل کوچک و JPEG با کیفیت ۷۵ (برای خواندن مدرک کافی است)
//   - GIF ← JPEG (فریم اول)؛ PDF و ویدیو (mp4/mov) دست‌نخورده ذخیره می‌شوند
// خروجی: { buf, mime } یا خطا با پیام فارسی
let sharp = null;
try { sharp = require('sharp'); } catch (e) { sharp = null; }

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf', 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'image/gif': '.gif' };
const RAW = ['application/pdf', 'video/mp4', 'video/quicktime'];
const BY_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf', heic: 'image/heic', heif: 'image/heif', mp4: 'video/mp4', mov: 'video/quicktime' };

// نوع واقعی فایل از روی چند بایت اول (هاست‌ها و گوشی‌ها نوع را همیشه درست نمی‌گویند)
function sniff(buf) {
  if (!buf || buf.length < 12) return '';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.slice(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.slice(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (buf.slice(4, 8).toString('latin1') === 'ftyp') {
    const major = buf.slice(8, 12).toString('latin1');
    const brands = buf.slice(8, Math.min(buf.length, 64)).toString('latin1');
    if (/heic|heix|hevc|hevx|heim|heis|mif1|msf1/.test(major)) return 'image/heic';
    if (major === 'qt  ') return 'video/quicktime';
    if (/mp4|isom|iso[0-9]|avc1|M4V|3gp/.test(major)) return 'video/mp4';
    if (/heic|heix|mif1/.test(brands)) return 'image/heic';
  }
  return '';
}

// mime و نام فایل فقط وقتی به کار می‌آیند که بایت‌ها چیزی نگویند
function detect(buf, mime, name) {
  const s = sniff(buf);
  if (s) return s;
  const m = String(mime || '').split(';')[0].trim().toLowerCase();
  if (EXT[m] || m === 'image/gif' || m === 'image/heic' || m === 'image/heif') return m === 'image/heif' ? 'image/heic' : m;
  const ext = (String(name || '').split('?')[0].match(/\.([a-z0-9]+)$/i) || [])[1];
  const byExt = ext ? BY_EXT[ext.toLowerCase()] : '';
  return byExt === 'image/heif' ? 'image/heic' : byExt || '';
}

async function heicToJpeg(buf) {
  const convert = require('heic-convert');
  const out = await convert({ buffer: buf, format: 'JPEG', quality: 0.9 });
  return Buffer.from(out);
}

async function shrink(buf, mime) {
  if (!sharp) return { buf, mime };
  try {
    const out = await sharp(buf).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75, mozjpeg: true }).toBuffer();
    return out.length < buf.length || mime !== 'image/jpeg' ? { buf: out, mime: 'image/jpeg' } : { buf, mime };
  } catch (e) {
    return { buf, mime };
  }
}

async function prepare(buf, mime, name) {
  let type = detect(buf, mime, name);
  if (!type) throw new Error('نوع فایل پشتیبانی نمی‌شود (فقط عکس یا PDF)');
  // فایلی که فقط نام/نوعش «عکس» یا «PDF» می‌گوید ولی محتوایش نه (مثلاً HTML با پسوند jpg)
  // ذخیره نمی‌شود؛ PDF و ویدیو دست‌نخورده ذخیره می‌شوند، پس امضای واقعی‌شان لازم است
  if (!sniff(buf)) {
    if (RAW.includes(type) || !sharp) throw new Error('محتوای فایل با نوعش جور نیست');
    try { await sharp(buf).metadata(); } catch (e) { throw new Error('فایل عکس سالم نیست'); }
  }
  if (RAW.includes(type)) return { buf, mime: type };
  if (type === 'image/heic') {
    try {
      buf = await heicToJpeg(buf);
      type = 'image/jpeg';
    } catch (e) {
      throw new Error('تبدیل عکس HEIC ناموفق بود');
    }
  }
  return shrink(buf, type);
}

// برای فیلتر سریع فایل‌های آپلودی پیش از پردازش
function acceptable(buf, mime, name) {
  return !!detect(buf, mime, name);
}

module.exports = { prepare, acceptable, detect, EXT };
