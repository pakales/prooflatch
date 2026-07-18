import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * One fixed-window quota record per pseudonymous user.
 *
 * `subjectHash` is an HMAC generated with a server-only salt. Raw email
 * addresses and names must never be written to this table.
 */
export const aiQuotaUsage = sqliteTable(
  "ai_quota_usage",
  {
    subjectHash: text("subject_hash").primaryKey(),
    minuteWindow: integer("minute_window").notNull(),
    minuteCount: integer("minute_count").notNull(),
    dayWindow: integer("day_window").notNull(),
    dayCount: integer("day_count").notNull(),
    updatedAt: integer("updated_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [index("ai_quota_usage_expires_at_idx").on(table.expiresAt)],
);
