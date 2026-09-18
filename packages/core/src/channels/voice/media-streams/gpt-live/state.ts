import { MediaStreamsOpenAICallState } from '../shared';

/**
 * Per-call bookkeeping `GPTLiveProvider` needs beyond `ConversationSession`.
 *
 * @internal
 */
export class CallState extends MediaStreamsOpenAICallState {
  /**
   * Settles once `session.closed` arrives, so teardown can wait for graceful
   * finalization before tearing the socket down.
   */
  readonly closed: Promise<void>;

  private readonly resolveClosed: () => void;

  constructor() {
    super();
    let resolve!: () => void;
    this.closed = new Promise<void>(r => {
      resolve = r;
    });
    this.resolveClosed = resolve;
  }

  markClosed(): void {
    this.resolveClosed();
  }
}
