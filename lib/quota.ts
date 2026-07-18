import { and, eq, lt, ne, or, sql } from "drizzle-orm";
import { aiQuotaUsage } from "@/db/schema";

const MINUTE_LIMIT = 3;
const DAY_LIMIT = 20;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const RETENTION_MS = 30 * DAY_MS;

export type QuotaResult =
  | {
      allowed: true;
      safetyIdentifier: string;
      remainingMinute: number;
      remainingDay: number;
    }
  | {
      allowed: false;
      retryAfterSeconds: number;
    };

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Creates a stable, non-reversible identifier for quota and API safety use.
 * The normalized email is never returned or persisted.
 */
export async function hashQuotaSubject(
  email: string,
  secretSalt: string,
): Promise<string> {
  if (secretSalt.length < 32) {
    throw new Error("The quota salt is missing or too short.");
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (
    normalizedEmail.length < 3 ||
    normalizedEmail.length > 320 ||
    !normalizedEmail.includes("@")
  ) {
    throw new Error("The authenticated user identifier is invalid.");
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secretSalt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`prooflatch:v1:${normalizedEmail}`),
  );

  // OpenAI safety identifiers accept at most 64 characters. A SHA-256 HMAC in
  // hexadecimal is exactly 64 and contains no raw identity data.
  return bytesToHex(digest);
}

function secondsUntilNextWindow(nowMs: number, windowMs: number): number {
  return Math.max(1, Math.ceil((windowMs - (nowMs % windowMs)) / 1_000));
}

/**
 * Atomically consumes both fixed-window quota gates in a single D1 UPSERT.
 *
 * If either gate is exhausted, SQLite's conflict-update WHERE clause prevents
 * both counters from changing, so a rejected request cannot consume the other
 * allowance.
 */
export async function consumeAiQuota({
  email,
  secretSalt,
  nowMs = Date.now(),
}: {
  email: string;
  secretSalt: string;
  nowMs?: number;
}): Promise<QuotaResult> {
  const subjectHash = await hashQuotaSubject(email, secretSalt);
  const minuteWindow = Math.floor(nowMs / MINUTE_MS);
  const dayWindow = Math.floor(nowMs / DAY_MS);
  const nowSeconds = Math.floor(nowMs / 1_000);
  const expiresAt = Math.floor((nowMs + RETENTION_MS) / 1_000);
  const { getDb } = await import("@/db");
  const db = getDb();

  const [usage] = await db
    .insert(aiQuotaUsage)
    .values({
      subjectHash,
      minuteWindow,
      minuteCount: 1,
      dayWindow,
      dayCount: 1,
      updatedAt: nowSeconds,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: aiQuotaUsage.subjectHash,
      set: {
        minuteWindow,
        minuteCount: sql<number>`case
          when ${aiQuotaUsage.minuteWindow} = ${minuteWindow}
            then ${aiQuotaUsage.minuteCount} + 1
          else 1
        end`,
        dayWindow,
        dayCount: sql<number>`case
          when ${aiQuotaUsage.dayWindow} = ${dayWindow}
            then ${aiQuotaUsage.dayCount} + 1
          else 1
        end`,
        updatedAt: nowSeconds,
        expiresAt,
      },
      where: and(
        or(
          ne(aiQuotaUsage.minuteWindow, minuteWindow),
          lt(aiQuotaUsage.minuteCount, MINUTE_LIMIT),
        ),
        or(
          ne(aiQuotaUsage.dayWindow, dayWindow),
          lt(aiQuotaUsage.dayCount, DAY_LIMIT),
        ),
      ),
    })
    .returning({
      minuteCount: aiQuotaUsage.minuteCount,
      dayCount: aiQuotaUsage.dayCount,
    });

  if (usage) {
    // Expired pseudonymous records are removed opportunistically. A cleanup
    // failure must not bypass or undo the successfully consumed quota.
    await db
      .delete(aiQuotaUsage)
      .where(lt(aiQuotaUsage.expiresAt, nowSeconds))
      .catch(() => undefined);

    return {
      allowed: true,
      safetyIdentifier: subjectHash,
      remainingMinute: Math.max(0, MINUTE_LIMIT - usage.minuteCount),
      remainingDay: Math.max(0, DAY_LIMIT - usage.dayCount),
    };
  }

  const [existing] = await db
    .select({
      minuteWindow: aiQuotaUsage.minuteWindow,
      minuteCount: aiQuotaUsage.minuteCount,
      dayWindow: aiQuotaUsage.dayWindow,
      dayCount: aiQuotaUsage.dayCount,
    })
    .from(aiQuotaUsage)
    .where(eq(aiQuotaUsage.subjectHash, subjectHash))
    .limit(1);

  const minuteBlocked =
    existing?.minuteWindow === minuteWindow &&
    existing.minuteCount >= MINUTE_LIMIT;
  const dayBlocked =
    existing?.dayWindow === dayWindow && existing.dayCount >= DAY_LIMIT;
  const retryAfterSeconds = Math.max(
    minuteBlocked ? secondsUntilNextWindow(nowMs, MINUTE_MS) : 0,
    dayBlocked ? secondsUntilNextWindow(nowMs, DAY_MS) : 0,
    1,
  );

  return { allowed: false, retryAfterSeconds };
}
