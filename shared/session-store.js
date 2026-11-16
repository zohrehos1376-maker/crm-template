// Session store روی MariaDB. استفاده از Prisma باعث می‌شود
// نشست‌ها بدون وابستگی به درایور اختصاصی هر دیتابیس نگهداری شوند.
const session = require('express-session');

class PrismaSessionStore extends session.Store {
  constructor({ prisma, pruneIntervalMs = 15 * 60 * 1000 }) {
    super();
    this.prisma = prisma;
    this.pruneTimer = setInterval(() => {
      this.prisma.session.deleteMany({ where: { expire: { lt: new Date() } } }).catch((error) => {
        console.error('پاک‌سازی نشست‌های منقضی‌شده ناموفق بود:', error.message);
      });
    }, pruneIntervalMs);
    this.pruneTimer.unref();
  }

  get(sid, callback) {
    this.prisma.session.findUnique({ where: { sid } })
      .then(async (row) => {
        if (!row || row.expire <= new Date()) {
          if (row) await this.prisma.session.delete({ where: { sid } }).catch(() => {});
          callback(null, null);
          return;
        }
        callback(null, row.sess);
      })
      .catch(callback);
  }

  set(sid, sess, callback) {
    const expire = sessionExpiry(sess);
    // همان کاری که storeهای SQL انجام می‌دهند: فقط JSON قابل ذخیره وارد DB شود.
    const jsonSession = JSON.parse(JSON.stringify(sess));
    this.prisma.session.upsert({
      where: { sid },
      create: { sid, sess: jsonSession, expire },
      update: { sess: jsonSession, expire },
    }).then(() => callback && callback()).catch(callback);
  }

  destroy(sid, callback) {
    this.prisma.session.deleteMany({ where: { sid } })
      .then(() => callback && callback())
      .catch(callback);
  }

  touch(sid, sess, callback) {
    this.prisma.session.updateMany({
      where: { sid },
      data: { expire: sessionExpiry(sess) },
    }).then(() => callback && callback()).catch(callback);
  }
}

function sessionExpiry(sess) {
  const cookie = sess && sess.cookie;
  if (cookie && cookie.expires) {
    const expires = new Date(cookie.expires);
    if (!isNaN(expires.getTime())) return expires;
  }
  const maxAge = cookie && Number(cookie.maxAge);
  return new Date(Date.now() + (Number.isFinite(maxAge) ? maxAge : 24 * 60 * 60 * 1000));
}

module.exports = PrismaSessionStore;
