import { ErrorDecoder } from './decoder';
import { API_URL, MAX_TEXT_LENGTH, textChunks, type Issue } from './protocol';

export interface SessionStore {
  get(): string;
  set(id: string): Promise<void>;
}
export type HttpRequest = (url: string, method: 'GET' | 'POST') => Promise<{ status: number; text: string }>;

function aborted(): Error { return new DOMException('Canceled', 'AbortError'); }

/** Bound native HTTP calls too: requestUrl itself does not offer cancellation. */
export function waitFor<T>(promise: Promise<T>, signal: AbortSignal, timeout: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); };
    const cancel = () => { cleanup(); reject(aborted()); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('The service timed out. Please try again.')); }, timeout);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

export class RastClient {
  constructor(private store: SessionStore, private http: HttpRequest,
    private connect: (url: string) => WebSocket = url => new WebSocket(url)) {}

  private async session(signal: AbortSignal): Promise<string> {
    const saved = this.store.get();
    if (saved) {
      const url = new URL(API_URL);
      url.searchParams.set('sid', saved);
      const result = await waitFor(this.http(url.href, 'GET'), signal, 10000);
      if (result.status >= 200 && result.status < 300) return saved;
      if (result.status !== 404) throw new Error('Could not validate the Rast session. Please try again.');
    }
    const result = await waitFor(this.http(API_URL, 'POST'), signal, 10000);
    const id = result.text.trim();
    if (result.status < 200 || result.status >= 300 || !id) throw new Error('Could not start a Rast session. Please try again.');
    signal.throwIfAborted();
    await this.store.set(id);
    return id;
  }

  async *check(text: string, signal: AbortSignal): AsyncGenerator<Issue[]> {
    if (text.length > MAX_TEXT_LENGTH) throw new Error('Select a shorter passage (maximum 65,535 UTF-16 units).');
    if (!text.trim()) return;
    signal.throwIfAborted();
    const id = await this.session(signal);
    signal.throwIfAborted();
    const url = new URL(API_URL);
    url.protocol = 'wss:';
    url.searchParams.set('sid', id);
    const socket = this.connect(url.href);
    socket.binaryType = 'arraybuffer';
    const decoder = new ErrorDecoder();
    const close = () => socket.close();
    signal.addEventListener('abort', close, { once: true });
    try {
      await waitFor(new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = socket.onclose = () => reject(new Error('Could not connect to Rast. Check your internet connection and try again.'));
      }), signal, 10000);
      for (const chunk of textChunks(text)) {
        signal.throwIfAborted();
        const batch = await waitFor(new Promise<Issue[]>((resolve, reject) => {
          const requestId = crypto.getRandomValues(new Uint8Array(16));
          socket.onerror = socket.onclose = () => reject(new Error('The connection to Rast closed. Please try again.'));
          socket.onmessage = event => {
            try {
              if (!(event.data instanceof ArrayBuffer)) throw new Error('Invalid response from Rast.');
              const bytes = new Uint8Array(event.data);
              if (bytes.length < 20 || !requestId.every((v, i) => bytes[i] === v)) throw new Error('Invalid response from Rast.');
              const issues = decoder.decode(bytes.subarray(16));
              if (issues.some(issue => issue.length <= 0 || issue.offset + issue.length > chunk.text.length)) throw new Error('Invalid issue position from Rast.');
              resolve(issues.map(issue => ({ ...issue, offset: issue.offset + chunk.offset }))
                .filter(issue => issue.offset >= chunk.start && issue.offset < chunk.end));
            } catch (error) { reject(error); }
          };
          const encoded = new TextEncoder().encode(chunk.text);
          const message = new Uint8Array(16 + encoded.length);
          message.set(requestId);
          message.set(encoded, 16);
          socket.send(message);
        }), signal, 15000);
        socket.onmessage = null;
        yield batch;
      }
    } finally {
      signal.removeEventListener('abort', close);
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close();
    }
  }
}
