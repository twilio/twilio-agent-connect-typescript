/**
 * Outbound sender resolution shared by messaging channels and voice providers.
 */

/**
 * Resolve the outbound sender address for a channel.
 *
 * `requested` (the caller's `options.from`) wins when it is one of the
 * channel's configured senders; otherwise throws. When omitted, the channel
 * default is used.
 *
 * @param requested - The caller's `options.from`, if any
 * @param options.allowlist - The channel's configured senders
 * @param options.default - The channel's default sender
 * @param options.channel - Channel label used in error messages (e.g. `sms`)
 */
export function resolveOutboundSender(
  requested: string | undefined,
  options: { allowlist: string[]; default: string | undefined; channel: string }
): string {
  if (requested !== undefined) {
    if (!options.allowlist.includes(requested)) {
      throw new Error(
        `from '${requested}' is not a configured ${options.channel} sender; ` +
          `configured senders: ${JSON.stringify(options.allowlist)}`
      );
    }
    return requested;
  }
  if (options.default === undefined) {
    throw new Error(`No default sender configured for ${options.channel}.`);
  }
  return options.default;
}
