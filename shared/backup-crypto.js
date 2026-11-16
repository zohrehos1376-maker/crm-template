// رمزگذاری فایل پشتیبان (بدون وابستگی به دیتابیس — اسکریپت بازگردانی روی هر کامپیوتری اجرا شود)
// قالب: "CRMBK1" | salt(16) | iv(12) | tag(16) | داده (AES-256-GCM، کلید = scrypt(رمز))
const crypto = require('crypto');

const MAGIC = Buffer.from('CRMBK1');

function encrypt(buf, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), enc]);
}

function decrypt(buf, passphrase) {
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('این فایل پشتیبانِ رمزشده‌ی CRM نمونه نیست');
  let o = MAGIC.length;
  const salt = buf.subarray(o, (o += 16));
  const iv = buf.subarray(o, (o += 12));
  const tag = buf.subarray(o, (o += 16));
  const key = crypto.scryptSync(passphrase, salt, 32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(buf.subarray(o)), d.final()]);
  } catch (e) {
    throw new Error('رمز اشتباه است یا فایل خراب شده');
  }
}

module.exports = { encrypt, decrypt };
