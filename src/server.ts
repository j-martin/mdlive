import { renderPage } from './page';
import type { SourcePatch } from './edit';
import type { ReviewEvent } from './review';
import type { ClickTarget } from './sourcePosition';

const KEEPALIVE_INTERVAL_MS = 15_000;

export type Broadcaster = {
  url: string;
  send: (payload: unknown) => void;
};

export type ServerHandlers = {
  /** Gives the payload that a new connection receives first. */
  current: () => unknown;
  /** Pins the diff base to `commit`, or follows the `--base` ref again when `commit` is `null`. Throws on an invalid commit. */
  selectBase: (commit: string | null) => void;
  /** Opens the source of the file at the clicked position in the editor. Rejects when the editor cannot open it. */
  openSource: (target: ClickTarget) => Promise<void>;
  /** Writes patches to the file, in order. Throws when the file changed where a patch applies. */
  patchSource: (patches: SourcePatch[]) => void;
  /** Commits the file, and only the file, to git. Throws with the git error when the commit fails. */
  commitFile: () => void;
  /** Renders `source` like the file, without writing it, and gives the payload a page would receive. */
  renderSource: (source: string) => unknown;
  /** Sends a prompt about the source range to a Claude Code pane and gives the pane address. */
  promptClaude: (request: PromptRequest) => Promise<string>;
  /** Gives the pull request of the branch and its review threads on the file. */
  getReview: () => Promise<unknown>;
  /** Shows the file at the head of the pull request instead of the local file, and gives the review. */
  startReview: () => Promise<unknown>;
  /** Shows the local file again. */
  stopReview: () => void;
  /** Adds a draft review comment on the selection and gives the updated review. */
  addReviewComment: (request: ReviewCommentRequest) => Promise<unknown>;
  /** Changes the text of a review comment and gives the updated review. */
  editReviewComment: (commentId: string, body: string) => Promise<unknown>;
  /** Deletes a draft review comment and gives the updated review. */
  deleteReviewComment: (commentId: string) => Promise<unknown>;
  /** Deletes the pending review with all its drafts and gives the updated review. */
  discardReview: () => Promise<unknown>;
  /** Publishes the pending review and gives the updated review. */
  submitReview: (event: ReviewEvent, body: string) => Promise<unknown>;
};

export type ReviewCommentRequest = {
  /** Offset where the selection starts in the source that the page rendered. */
  from: number;
  /** Offset where the selection ends. */
  to: number;
  /** Rendered text of the selection, quoted when the range is empty. */
  text: string;
  feedback: string;
  /** Whether the comment starts with the quoted selection. Defaults to true. */
  quote?: boolean;
};

export type PromptRequest = {
  /** Offset where the selection starts in the source that the page rendered. */
  from: number;
  /** Offset where the selection ends. */
  to: number;
  /** Rendered text of the selection, used when the range is empty. */
  text: string;
  prompt: string;
};

/**
 * Starts an HTTP server that serves the page and pushes payloads to browsers with Server-Sent Events.
 */
export const startServer = (port: number, fileLabel: string, handlers: ServerHandlers): Broadcaster => {
  const encoder = new TextEncoder();
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const page = renderPage(fileLabel);

  const encode = (payload: unknown): Uint8Array => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

  const openStream = (): Response => {
    let client: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        client = controller;
        clients.add(controller);
        controller.enqueue(encode(handlers.current()));
      },
      cancel: () => {
        if (client !== null) {
          clients.delete(client);
        }
      },
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  };

  const selectBase = async (request: Request): Promise<Response> => {
    try {
      const body = (await request.json()) as { commit?: unknown };
      if (body.commit !== null && typeof body.commit !== 'string') {
        return new Response('"commit" must be a string or null', { status: 400 });
      }
      handlers.selectBase(body.commit);
      return new Response(null, { status: 204 });
    } catch (error) {
      return new Response(error instanceof Error ? error.message : String(error), { status: 400 });
    }
  };

  const isClickTarget = (value: unknown): value is ClickTarget => {
    const target = value as ClickTarget;
    return (
      typeof target === 'object' &&
      target !== null &&
      Number.isInteger(target.start) &&
      Number.isInteger(target.end) &&
      Number.isInteger(target.offset) &&
      Array.isArray(target.texts) &&
      target.texts.every((text) => typeof text === 'string')
    );
  };

  const openSource = async (request: Request): Promise<Response> => {
    const body: unknown = await request.json().catch(() => null);
    if (!isClickTarget(body)) {
      return new Response('Expected { start, end, offset, texts }', { status: 400 });
    }
    try {
      await handlers.openSource(body);
      return new Response(null, { status: 204 });
    } catch (error) {
      return new Response(error instanceof Error ? error.message : String(error), { status: 500 });
    }
  };

  const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

  const isSourcePatch = (value: unknown): value is SourcePatch => {
    const patch = value as SourcePatch;
    return (
      typeof patch === 'object' &&
      patch !== null &&
      Number.isInteger(patch.from) &&
      Number.isInteger(patch.to) &&
      patch.from <= patch.to &&
      ['text', 'before', 'removed', 'after'].every((key) => typeof patch[key as keyof SourcePatch] === 'string')
    );
  };

  const patchSource = async (request: Request): Promise<Response> => {
    const body = (await request.json().catch(() => null)) as { patches?: unknown } | null;
    const patches = body?.patches;
    if (!Array.isArray(patches) || !patches.every(isSourcePatch)) {
      return new Response('Expected { patches: [{ from, to, text, before, removed, after }] }', { status: 400 });
    }
    try {
      handlers.patchSource(patches);
      return new Response(null, { status: 204 });
    } catch (error) {
      return new Response(errorMessage(error), { status: 409 });
    }
  };

  const commitFile = (): Response => {
    try {
      handlers.commitFile();
      return new Response(null, { status: 204 });
    } catch (error) {
      return new Response(errorMessage(error), { status: 500 });
    }
  };

  const renderSource = async (request: Request): Promise<Response> => {
    const body = (await request.json().catch(() => null)) as { source?: unknown } | null;
    if (typeof body?.source !== 'string') {
      return new Response('Expected { source }', { status: 400 });
    }
    return Response.json(handlers.renderSource(body.source));
  };

  const respond = async (result: Promise<unknown>): Promise<Response> => {
    try {
      return Response.json(await result);
    } catch (error) {
      return new Response(errorMessage(error), { status: 500 });
    }
  };

  const readBody = async (request: Request): Promise<Record<string, unknown>> =>
    ((await request.json().catch(() => null)) as Record<string, unknown> | null) ?? {};

  const addReviewComment = async (request: Request): Promise<Response> => {
    const body = await readBody(request);
    const valid =
      Number.isInteger(body.from) &&
      Number.isInteger(body.to) &&
      (body.from as number) <= (body.to as number) &&
      typeof body.text === 'string' &&
      typeof body.feedback === 'string' &&
      (body.quote === undefined || typeof body.quote === 'boolean') &&
      body.feedback.trim() !== '';
    if (!valid) {
      return new Response('Expected { from, to, text, feedback } with feedback', { status: 400 });
    }
    return respond(handlers.addReviewComment(body as ReviewCommentRequest));
  };

  const editReviewComment = async (request: Request): Promise<Response> => {
    const { id, body } = await readBody(request);
    if (typeof id !== 'string' || id === '' || typeof body !== 'string' || body.trim() === '') {
      return new Response('Expected { id, body } with a body', { status: 400 });
    }
    return respond(handlers.editReviewComment(id, body));
  };

  const deleteReviewComment = async (request: Request): Promise<Response> => {
    const { id } = await readBody(request);
    if (typeof id !== 'string' || id === '') {
      return new Response('Expected { id }', { status: 400 });
    }
    return respond(handlers.deleteReviewComment(id));
  };

  const REVIEW_EVENTS = new Set(['COMMENT', 'APPROVE', 'REQUEST_CHANGES']);

  const submitReview = async (request: Request): Promise<Response> => {
    const { event, body } = await readBody(request);
    if (typeof event !== 'string' || !REVIEW_EVENTS.has(event) || typeof body !== 'string') {
      return new Response('Expected { event: COMMENT | APPROVE | REQUEST_CHANGES, body }', { status: 400 });
    }
    return respond(handlers.submitReview(event as ReviewEvent, body));
  };

  const isPromptRequest = (value: unknown): value is PromptRequest => {
    const request = value as PromptRequest;
    return (
      typeof request === 'object' &&
      request !== null &&
      Number.isInteger(request.from) &&
      Number.isInteger(request.to) &&
      request.from <= request.to &&
      typeof request.text === 'string' &&
      typeof request.prompt === 'string' &&
      request.prompt.trim() !== ''
    );
  };

  const promptClaude = async (request: Request): Promise<Response> => {
    const body: unknown = await request.json().catch(() => null);
    if (!isPromptRequest(body)) {
      return new Response('Expected { from, to, text, prompt } with a prompt', { status: 400 });
    }
    try {
      return Response.json({ pane: await handlers.promptClaude(body) });
    } catch (error) {
      return new Response(errorMessage(error), { status: 500 });
    }
  };

  const server = Bun.serve({
    port,
    idleTimeout: 0,
    routes: {
      '/': () => new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
      '/events': openStream,
      '/base': { POST: selectBase },
      '/open': { POST: openSource },
      '/patch': { POST: patchSource },
      '/render': { POST: renderSource },
      '/commit': { POST: commitFile },
      '/prompt': { POST: promptClaude },
      '/review': { GET: () => respond(handlers.getReview()) },
      '/review/start': { POST: () => respond(handlers.startReview()) },
      '/review/stop': { POST: () => { handlers.stopReview(); return new Response(null, { status: 204 }); } },
      '/review/comment': { POST: addReviewComment },
      '/review/edit': { POST: editReviewComment },
      '/review/delete': { POST: deleteReviewComment },
      '/review/discard': { POST: () => respond(handlers.discardReview()) },
      '/review/submit': { POST: submitReview },
    },
    fetch: () => new Response('Not found', { status: 404 }),
  });

  const write = (chunk: Uint8Array): void => {
    for (const client of clients) {
      try {
        client.enqueue(chunk);
      } catch {
        clients.delete(client);
      }
    }
  };

  setInterval(() => write(encoder.encode(': keepalive\n\n')), KEEPALIVE_INTERVAL_MS);

  return {
    url: `http://localhost:${server.port}`,
    send: (payload) => write(encode(payload)),
  };
};
