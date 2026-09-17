/**
 * Feature: DTMF keypresses over ConversationRelay
 *
 * Collects an account number from the keypad — `#` submits, `*` clears — and
 * answers on the spot, without waiting for the caller to say anything. The
 * confirmed number stays available to the message handler for later turns.
 *
 * Twilio sends one `dtmf` message per keypress and never batches them, so
 * buffering multi-digit entries is the handler's job. `dtmfDetection: true`
 * turns the events on; without it Twilio sends nothing.
 *
 * A keypress can also be the caller's first input, before they say anything.
 * TAC initializes the conversation on it just as it would on a prompt, so
 * `conversationId` and `sendResponse` work right away.
 *
 * Required env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_API_KEY,
 * TWILIO_API_SECRET, TWILIO_PHONE_NUMBER, TWILIO_VOICE_PUBLIC_DOMAIN
 */

import { config } from 'dotenv';
import { TAC, TACConfig, VoiceChannel, TACServer } from 'twilio-agent-connect';

config({ path: '../.env' });

const ACCOUNT_NUMBER_LENGTH = 8;

// Keyed by conversation id, cleared when the call ends.
const buffers = new Map<string, string>();
const accountNumbers = new Map<string, string>();

const tac = await TAC.create({ config: TACConfig.fromEnv() });

tac.onMessageReady(({ conversationId, message }) => {
  const accountNumber = accountNumbers.get(conversationId);

  return accountNumber
    ? `Thanks, I have account ${accountNumber} on file. You said: ${message}`
    : `You said: ${message}. You can also type your account number, then press pound.`;
});

const voiceChannel = new VoiceChannel(tac, {
  defaultTwimlOptions: {
    dtmfDetection: true,
    welcomeGreeting:
      'Hello! Type your account number followed by the pound key, ' +
      'or just tell me what you need.',
    // Lets a keypress barge in while the agent is speaking.
    interruptible: 'any',
  },
});

voiceChannel.onDtmf(async ({ conversationId, digit }) => {
  if (!conversationId) return;

  const buffer = buffers.get(conversationId) ?? '';

  if (digit === '*') {
    buffers.delete(conversationId);
    await voiceChannel.sendResponse(conversationId, 'Cleared. Go ahead and start over.');
    return;
  }

  if (digit === '#') {
    if (buffer.length !== ACCOUNT_NUMBER_LENGTH) {
      await voiceChannel.sendResponse(
        conversationId,
        `That was ${buffer.length} digits. Account numbers are ${ACCOUNT_NUMBER_LENGTH}. ` +
          'Press star to clear and try again.'
      );
      return;
    }

    accountNumbers.set(conversationId, buffer);
    buffers.delete(conversationId);
    await voiceChannel.sendResponse(
      conversationId,
      `Got it, account ${buffer.split('').join(' ')}. How can I help?`
    );
    return;
  }

  // Skip the A-D keys.
  if (!/^[0-9]$/.test(digit)) return;

  buffers.set(conversationId, buffer + digit);
});

tac.onConversationEnded(({ session }) => {
  buffers.delete(session.conversationId);
  accountNumbers.delete(session.conversationId);
});

tac.registerChannel(voiceChannel);

const server = new TACServer(tac);

await server.start();
