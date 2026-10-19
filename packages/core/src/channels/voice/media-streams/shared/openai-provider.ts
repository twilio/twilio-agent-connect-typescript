import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import type { TACTool } from '@twilio/tac-tools';
import packageJson from '../../../../../../../package.json' with { type: 'json' };
import type { TACConfig } from '../../../../lib/config';
import type { Logger } from '../../../../lib/logger';
import {
  VoiceTwiMLOptionsMediaStreamsSchema,
  type ConversationId,
  type ConversationSession,
  type TwiMLRequest,
  type VoiceTwiMLOptions,
  type VoiceTwiMLOptionsMediaStreams,
} from '../../../../types/index';
import { ExpiringMap } from '../../../../util/expiring-map';
import type { VoiceChannel } from '../../channel';
import { VoiceProvider } from '../../provider';
import { TwiMLBuilderMediaStreams } from '../twiml';
import type { MediaStreamsOpenAIProviderConfig } from './config';
import type { MediaStreamsOpenAICallState } from './state';

/**
 * Identifies this SDK to OpenAI on every WebSocket connection, per OpenAI's
 * requested User-Agent pattern: [Company/Library name]/[Language] [Version].
 *
 * Deliberately unlike the Twilio-facing User-Agent in `clients/base.ts`, which
 * follows Twilio's own convention instead.
 */
export const OPENAI_USER_AGENT = `twilio-agent-connect/TypeScript ${packageJson.version}`;

/**
 * Reserved `<Stream>` `customParameters` key correlating a call's
 * `sessionConfig` override to its WebSocket `start` event. The call SID can't
 * be the key: outbound, `calls.create()` returning it doesn't happen-before
 * Twilio connecting the stream; inbound, the TwiML request and the stream can
 * reach different replicas, so the config has to travel on the TwiML.
 *
 * @internal
 */
export const SESSION_CONFIG_TOKEN_PARAM = '_tac_session_config_token';

/**
 * Render Zod validation issues as a compact `path: message` list, so a thrown
 * `TypeError` names the fields that actually failed rather than dumping the
 * raw error.
 *
 * Typed structurally rather than against Zod's issue type so it stays usable
 * with the result of any schema's `safeParse`.
 *
 * @internal
 */
export function describeIssues(
  issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[]
): string {
  return issues.map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join(', ');
}

/**
 * Shared scaffolding for a {@link VoiceProvider} bridging Twilio Media Streams
 * to an OpenAI real-time voice API.
 *
 * Holds only what's identical across every such provider; each subclass still
 * owns its own `initiateOutboundConversation`, `handleWebSocket`,
 * `registerCall`, `connectModel`, {@link dispatchModelEvent},
 * `handleFunctionCall`, and `cleanupCall`.
 *
 * Generic over `TCallState` (bound to `MediaStreamsOpenAICallState`) so
 * {@link calls} keeps each subclass's own call-state shape instead of widening
 * to the shared base everywhere it's read.
 */
export abstract class MediaStreamsOpenAIProvider<
  TCallState extends MediaStreamsOpenAICallState,
> extends VoiceProvider {
  /**
   * The owning channel's logger, so this provider logs under the same name the
   * rest of the voice channel does.
   */
  protected override readonly logger: Logger;

  /** Executable tools from the config, looked up by the name the model sends. */
  protected readonly toolsByName: Map<string, TACTool>;

  /** Per-call transport state, keyed by conversation id. */
  protected readonly calls: Map<ConversationId, TCallState>;

  protected readonly config: MediaStreamsOpenAIProviderConfig;
  protected readonly tacConfig: TACConfig;
  protected readonly twimlBuilder: TwiMLBuilderMediaStreams;

  /**
   * Per-call session config overrides, minted by one Twilio request and
   * consumed when the call's WebSocket connects.
   *
   * Keyed by a token that rides the TwiML's custom parameters, rekeyed to the
   * call's conversation id on connect ({@link claimSessionConfig}). Set in
   * `handleIncomingCall` or `initiateOutboundConversation`, consumed when the
   * model connects. Bounded and expiring, so a call that never connects
   * doesn't leave its entry here forever.
   */
  protected readonly pendingSessionConfigs: ExpiringMap<Record<string, unknown>>;

  constructor(
    channel: VoiceChannel,
    tacConfig: TACConfig,
    config: MediaStreamsOpenAIProviderConfig
  ) {
    super(channel);
    this.logger = channel.getLoggerInternal();
    this.config = config;
    this.tacConfig = tacConfig;
    this.toolsByName = new Map(config.tools.map(tool => [tool.name, tool as TACTool]));
    this.calls = new Map();
    this.twimlBuilder = new TwiMLBuilderMediaStreams(tacConfig, config, this.logger);
    this.pendingSessionConfigs = new ExpiringMap();
  }

  /** The Twilio-facing WebSocket for a conversation, if one is tracked. */
  public override getWebSocket(conversationId: ConversationId): WebSocket | null {
    return this.calls.get(conversationId)?.twilioWs ?? null;
  }

  /**
   * Open a WebSocket and resolve once it is ready to carry traffic.
   *
   * Isolated from each subclass's `connectModel` so tests can substitute a
   * socket without reaching the network.
   *
   * A resolved socket always carries at least one `'error'` listener, whatever
   * the caller does with it next.
   *
   * @internal
   */
  public openModelSocket(url: string, headers: Record<string, string>): Promise<WebSocket> {
    return new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(url, { headers });
      const onOpen = (): void => {
        ws.off('error', onError);
        // A listener-less 'error' emission throws, and `ws` emits one for any
        // frame its receiver rejects — including mid-close. Callers that never
        // reach attachModelHandlers must still get a socket that can't do that.
        ws.on('error', () => {});
        resolve(ws);
      };
      const onError = (error: Error): void => {
        ws.off('open', onOpen);
        reject(error);
      };
      ws.once('open', onOpen);
      ws.once('error', onError);
    });
  }

  /**
   * The transcript captured so far for an in-progress call.
   *
   * It lives on `ConversationSession.metadata.transcript`, so once the call
   * ends (and the session is released at WebSocket teardown) it is no longer
   * reachable here — read it from the session a `VoiceChannel.onCallEnded`
   * handler receives instead.
   */
  public getTranscript(conversationId: ConversationId): Record<string, string>[] {
    const transcript = this.channel.getConversationSession(conversationId)?.metadata.transcript;
    return Array.isArray(transcript) ? [...(transcript as Record<string, string>[])] : [];
  }

  /**
   * The session config stashed for `key` — a session-config token before the
   * call connects, its conversation id after.
   *
   * @internal
   */
  public peekPendingSessionConfig(key: string): Record<string, unknown> | undefined {
    return this.pendingSessionConfigs.get(key);
  }

  /**
   * How many session config overrides are waiting for their call.
   *
   * @internal
   */
  public pendingSessionConfigCount(): number {
    return this.pendingSessionConfigs.size;
  }

  /**
   * Mint a fresh session-config token.
   *
   * @internal
   */
  protected static newSessionConfigToken(): string {
    return randomUUID().replace(/-/g, '');
  }

  /**
   * `perCall` with the session-config token added to the stream's custom
   * parameters.
   *
   * The builder replaces whole fields, so the token is added to the parameters
   * the call would otherwise get — from `perCall`, `defaultTwimlOptions` or
   * `host`, by the builder's precedence — rather than to `perCall`'s alone,
   * which would drop inherited ones.
   *
   * @internal
   */
  protected withSessionConfigToken(
    host: VoiceTwiMLOptionsMediaStreams | undefined,
    perCall: VoiceTwiMLOptionsMediaStreams | undefined,
    token: string
  ): VoiceTwiMLOptionsMediaStreams {
    const effective = this.twimlBuilder.buildTwimlOptions(host, perCall).customParameters ?? {};
    return {
      ...perCall,
      customParameters: { ...effective, [SESSION_CONFIG_TOKEN_PARAM]: token },
    };
  }

  /**
   * Move the session config stashed under `token` to this call's id.
   *
   * A token this instance doesn't hold means the config was stashed on another
   * instance — the TwiML webhook or `initiateOutboundConversation` ran
   * somewhere other than where the stream connected — or it expired. The call
   * then falls back to `defaultSessionConfig`, so this warns: with multiple
   * instances, per-call session configs need `TACConfig.instancePublicDomain`.
   *
   * @internal
   */
  protected claimSessionConfig(token: string | undefined, conversationId: ConversationId): void {
    if (token === undefined) {
      return;
    }
    const sessionConfig = this.pendingSessionConfigs.take(token);
    if (sessionConfig === undefined) {
      this.logger.warn(
        { conversation_id: conversationId },
        'Per-call sessionConfig not found on this instance; using defaultSessionConfig. ' +
          'With multiple instances, set TACConfig.instancePublicDomain so the stream ' +
          'connects to the instance that stashed it.'
      );
      return;
    }
    this.pendingSessionConfigs.set(conversationId, sessionConfig);
  }

  /**
   * The executable tool the model would run for `name`, if the config supplied
   * one.
   *
   * @internal
   */
  public peekTool(name: string): TACTool | undefined {
    return this.toolsByName.get(name);
  }

  // =========================================================================
  // Inbound Call Handling
  // =========================================================================

  /**
   * Build the `<Connect><Stream>` TwiML for an inbound call.
   *
   * TwiML fields are merged per-field, highest precedence first:
   *   1. Output of the customizer registered via
   *      `VoiceChannel.onInboundCallTwiml(...)`, if configured and
   *      `twimlRequest` is given
   *   2. `MediaStreamsProviderConfig.defaultTwimlOptions` — channel-wide
   *      defaults
   *   3. `options.hostTwimlOptions` — per-call transport facts supplied by the
   *      host
   *   4. TAC defaults: the WebSocket URL derived from
   *      `TACConfig.voiceCallbackDomain` + `voiceWebsocketPath`
   *
   * Also runs `MediaStreamsOpenAIProviderConfig.onInboundCallSessionConfig`, if
   * set, and stashes its result for the call to pick up once it connects,
   * under a token carried on the stream's custom parameters — so the config is
   * found by the stream it belongs to rather than keyed to a call SID. The
   * stash is written only after the TwiML builds, so a webhook that fails
   * leaves nothing behind it.
   *
   * @param twimlRequest - Parsed Twilio webhook fields for the inbound call.
   * @param options - Additional per-call inputs.
   * @param options.hostTwimlOptions - Per-call TwiML supplied by a custom
   *   in-process host.
   * @throws {TypeError} if either the host options or the customizer's output
   *   is not a `VoiceTwiMLOptionsMediaStreams`.
   * @throws {Error} if no WebSocket URL can be resolved — none of the TwiML
   *   layers set one and `TACConfig.voicePublicDomain` is unset.
   */
  public override async handleIncomingCall(
    twimlRequest?: TwiMLRequest,
    options?: { hostTwimlOptions?: VoiceTwiMLOptions }
  ): Promise<string> {
    const host = this.narrowTwimlOptions(
      options?.hostTwimlOptions,
      'handleIncomingCall',
      'options.hostTwimlOptions'
    );

    const onInboundCallTwimlHandler = this.channel.getInboundCallTwimlHandler();
    let customized: VoiceTwiMLOptionsMediaStreams | undefined;
    if (onInboundCallTwimlHandler && twimlRequest) {
      customized = this.narrowTwimlOptions(
        await onInboundCallTwimlHandler(twimlRequest),
        'handleIncomingCall',
        'the onInboundCallTwiml customizer output'
      );
    }

    let sessionConfig: Record<string, unknown> | null = null;
    if (this.config.onInboundCallSessionConfig && twimlRequest) {
      sessionConfig = await this.config.onInboundCallSessionConfig(twimlRequest);
    }

    let token: string | undefined;
    if (sessionConfig !== null) {
      // Ride a token for the config out on the TwiML, as outbound does, so the
      // config can be found when the call's stream connects instead of being
      // keyed to a call SID.
      token = MediaStreamsOpenAIProvider.newSessionConfigToken();
      customized = this.withSessionConfigToken(host, customized, token);
    }

    // Built before the stash, not after: build() throws when no WebSocket URL
    // can be resolved, and a throw here 500s the webhook so the call never
    // connects to drain the entry.
    const twiml = this.twimlBuilder.build('handleIncomingCall', { host, perCall: customized });

    if (token !== undefined && sessionConfig !== null) {
      this.pendingSessionConfigs.set(token, sessionConfig);
    }

    return twiml;
  }

  /**
   * Narrow provider-agnostic {@link VoiceTwiMLOptions} to this provider's
   * concrete shape. `VoiceProvider.handleIncomingCall` is typed against the
   * base so every provider can accept its own TwiML options, so the Media
   * Streams shape has to be established at runtime.
   *
   * @param value - Options from a caller or the application customizer.
   * @param caller - Name of the calling method, for the error message.
   * @param label - What produced `value`, for the error message.
   */
  protected narrowTwimlOptions(
    value: VoiceTwiMLOptions | undefined,
    caller: string,
    label: string
  ): VoiceTwiMLOptionsMediaStreams | undefined {
    if (value === undefined) {
      return undefined;
    }
    const parsed = VoiceTwiMLOptionsMediaStreamsSchema.safeParse(value);
    if (!parsed.success) {
      throw new TypeError(
        `MediaStreamsOpenAIProvider.${caller} requires ${label} to be a ` +
          `VoiceTwiMLOptionsMediaStreams: ${describeIssues(parsed.error.issues)}`
      );
    }
    return parsed.data;
  }

  // =========================================================================
  // Audio Bridge
  // =========================================================================

  /**
   * Parse one frame off the model socket and hand it to
   * {@link dispatchModelEvent}.
   *
   * A failure here is logged and skipped rather than ending the call: one
   * malformed delta must not hang up on the caller.
   *
   * @internal
   */
  public async handleModelMessage(
    conversationId: ConversationId,
    raw: Buffer | string
  ): Promise<void> {
    try {
      const event = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')) as Record<
        string,
        unknown
      >;
      const session = this.channel.getConversationSession(conversationId);
      if (session === undefined) {
        return;
      }
      await this.dispatchModelEvent(conversationId, session, event);
    } catch (err) {
      this.logger.error({ err, conversation_id: conversationId }, 'Error handling model event');
    }
  }

  /**
   * Interpret one event received from the model. Protocol-specific —
   * implemented by each subclass.
   */
  protected abstract dispatchModelEvent(
    conversationId: ConversationId,
    session: ConversationSession,
    event: Record<string, unknown>
  ): Promise<void>;

  /**
   * Look up a model-requested tool by name, run it, and return its output.
   *
   * Errors are returned as part of the output rather than thrown, so a bad
   * tool call does not kill the call.
   *
   * @internal
   */
  public async runToolCall(
    conversationId: ConversationId,
    name: string,
    argumentsJson: unknown
  ): Promise<unknown> {
    this.logger.debug({ conversation_id: conversationId, tool_name: name }, 'Tool call');

    const tool = this.toolsByName.get(name);
    if (tool === undefined) {
      return { error: `Unknown tool '${name}'` };
    }

    try {
      const parsedArguments: unknown = JSON.parse(
        typeof argumentsJson === 'string' && argumentsJson ? argumentsJson : '{}'
      );
      const output: unknown = await tool.implementation(parsedArguments);
      this.logger.debug({ conversation_id: conversationId, tool_name: name }, 'Tool result');
      return output;
    } catch (err) {
      // Only the generic message goes back: the model may read tool output
      // aloud, so a stack trace or upstream payload must never reach the caller.
      this.logger.error({ err, conversation_id: conversationId, tool_name: name }, 'Tool failed');
      return { error: `Tool '${name}' failed to execute.` };
    }
  }

  /** Write one event to this call's model socket, if it still has one. */
  protected modelSend(conversationId: ConversationId, payload: Record<string, unknown>): void {
    const modelWs = this.calls.get(conversationId)?.modelWs;
    if (!modelWs) {
      return;
    }
    try {
      modelWs.send(JSON.stringify(payload));
    } catch (err) {
      // A socket closing under a write is ordinary end-of-call, not an error.
      this.logger.debug({ err, conversation_id: conversationId }, 'Failed to send to model');
    }
  }

  /** Write one message to this call's Twilio socket, if it still has one. */
  protected twilioSend(conversationId: ConversationId, payload: Record<string, unknown>): void {
    const twilioWs = this.calls.get(conversationId)?.twilioWs;
    if (!twilioWs) {
      return;
    }
    try {
      twilioWs.send(JSON.stringify(payload));
    } catch (err) {
      this.logger.debug({ err, conversation_id: conversationId }, 'Failed to send to Twilio');
    }
  }

  /**
   * Always throws: the model streams its reply as audio straight to Twilio, so
   * this transport has no text response to send.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- Rejects without awaiting, but stays `async` so callers always get a Promise
  public override async sendResponse(
    _conversationId: ConversationId,
    _message: string,
    _metadata?: Record<string, unknown>
  ): Promise<void> {
    throw new Error(
      `${this.constructor.name} produces audio via the model; it has no text sendResponse.`
    );
  }

  /**
   * Drop this provider's Media Streams transport state on channel shutdown.
   *
   * Note: WebSocket connections are managed by the server and closed there.
   * This method only cleans up internal provider state — including session
   * config overrides stashed for calls that were placed but never connected.
   */
  public override shutdown(): void {
    super.shutdown();
    this.calls.clear();
    this.pendingSessionConfigs.clear();
  }
}
