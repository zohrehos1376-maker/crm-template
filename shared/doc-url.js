// آدرس مدرک‌های فرم همکاری فقط از سایت خودمان پذیرفته و دانلود می‌شود (جلوی دانلود آدرس‌های داخلی سرور).
// دامنه‌های مجاز: crm.example.com و زیردامنه‌هایش؛ با DOC_URL_HOSTS در .env (جداشده با کاما) قابل تغییر.
function allowedHosts() {
  return String(process.env.DOC_URL_HOSTS || 'crm.example.com').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function isAllowedDocUrl(u) {
  let url;
  try { url = new URL(String(u || '')); } catch (e) { return false; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password || (url.port && url.port !== '80' && url.port !== '443')) return false;
  const host = url.hostname.toLowerCase();
  return allowedHosts().some((h) => host === h || host.endsWith('.' + h));
}

module.exports = { isAllowedDocUrl };
