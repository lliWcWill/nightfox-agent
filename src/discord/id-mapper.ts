/**
 * Maps Discord snowflake IDs (64-bit strings) to negative numbers
 * for compatibility with existing Maps that use number keys.
 *
 * Telegram IDs are always positive. Discord IDs become negative. Zero collision.
 */

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Map a Discord snowflake string to a negative numeric chat ID suitable for number-keyed maps.
 *
 * @param snowflake - Discord snowflake ID as a decimal string
 * @returns A negative integer between -(Number.MAX_SAFE_INTEGER - 1) and 0 inclusive that deterministically represents the given snowflake
 */
export function discordChatId(snowflake: string): number {
  return -Number(BigInt(snowflake) % MAX_SAFE);
}