/**
 * inAppNotification.service.js — the bell in the header. Plan §10.
 *
 * Distinct from notification.service.js, which sends EMAIL. Nothing here ever
 * leaves the application: a row is written for each HR user and shown in their
 * bell. That makes it the safe default for anything HR merely needs to *know*.
 *
 * ── Two rules ──────────────────────────────────────────────────────────────
 *
 *   · Read state is per person. One row per user per event, so Shweta reading
 *     an alert does not clear it for Subhajit.
 *   · Raising a notification can never break the thing that raised it. Every
 *     write is best-effort: if the table is missing (DDL not yet applied) or the
 *     insert fails, a warning is logged and the caller carries on. A submitted
 *     evaluation must never fail because a bell could not ring.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';

const SEVERITIES = ['info', 'warning', 'critical'];

/**
 * Notify every active user at or above the given roles.
 *
 * @param {object} n
 * @param {string} n.type - short machine key, e.g. 'joiners_detected'
 * @param {string} n.title
 * @param {string} [n.body]
 * @param {string} [n.link] - an in-app route, e.g. '/new-joiners'
 * @param {'info'|'warning'|'critical'} [n.severity]
 * @param {string} [n.dedupeKey] - the same key is delivered to a user only once
 * @param {string[]} [n.roles] - who hears about it
 * @returns {Promise<number>} rows written (0 when deduplicated or unavailable)
 */
export async function notifyStaff({
  type,
  title,
  body = null,
  link = null,
  severity = 'info',
  dedupeKey = null,
  roles = ['superadmin', 'admin', 'hr'],
}) {
  try {
    const users = await prisma.pea_users.findMany({
      where: { is_active: true, role: { in: roles } },
      select: { id: true },
    });

    const level = SEVERITIES.includes(severity) ? severity : 'info';
    let written = 0;

    for (const u of users) {
      // ON CONFLICT against the partial unique index: a dedupe key that has
      // already reached this user is silently skipped, which is the point.
      written += await prisma.$executeRaw`
        INSERT INTO pea_notifications (user_id, type, title, body, link, severity, dedupe_key)
        VALUES (${u.id}, ${type}, ${String(title).slice(0, 200)}, ${body}, ${link}, ${level}, ${dedupeKey})
        ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`;
    }

    return written;
  } catch (err) {
    logger.warn(`In-app notification "${type}" not recorded: ${err.message}`);
    return 0;
  }
}

/**
 * A user's recent notifications and unread count.
 * @param {number} userId
 * @param {number} [limit=30]
 * @returns {Promise<{items: object[], unread: number, available: boolean}>}
 */
export async function listForUser(userId, limit = 30) {
  try {
    const [items, unread] = await Promise.all([
      prisma.pea_notifications.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        take: Math.min(100, Math.max(1, limit)),
      }),
      prisma.pea_notifications.count({ where: { user_id: userId, read_at: null } }),
    ]);

    return { items: items.map((i) => ({ ...i, id: String(i.id) })), unread, available: true };
  } catch (err) {
    // Missing table before the 2026-09-13 DDL. The bell shows empty rather than
    // turning every page load into an error.
    logger.warn(`Notifications unavailable: ${err.message}`);
    return { items: [], unread: 0, available: false };
  }
}

/**
 * Mark one notification read. Scoped to the user, so nobody can clear another
 * person's alerts by guessing an id.
 * @param {number} userId
 * @param {string|number} id
 * @returns {Promise<number>} rows updated
 */
export async function markRead(userId, id) {
  const { count } = await prisma.pea_notifications.updateMany({
    where: { id: BigInt(id), user_id: userId, read_at: null },
    data: { read_at: new Date() },
  });
  return count;
}

/**
 * Mark everything read for a user.
 * @param {number} userId
 * @returns {Promise<number>} rows updated
 */
export async function markAllRead(userId) {
  const { count } = await prisma.pea_notifications.updateMany({
    where: { user_id: userId, read_at: null },
    data: { read_at: new Date() },
  });
  return count;
}
