import { pool } from '../config/db.js';
import { logger } from '../utils/logger.js';

/**
 * Append-only audit trail. Records who did what to which entity. Always
 * best-effort: a failure here must never break the primary operation.
 */
export async function logAudit({ actorId = null, action, entityType, entityId = '', details = {} }) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [actorId, action, entityType, entityId, JSON.stringify(details)],
    );
  } catch (err) {
    logger.warn(`Audit log write failed (${action} ${entityType} ${entityId}):`, err.message);
  }
}
