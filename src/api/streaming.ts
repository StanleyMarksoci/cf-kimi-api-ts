import type { ChatCompletionChunk } from "../kimi/protocol";

export function streamErrorChunk(message: string): string {
  return `data: ${JSON.stringify({ error: { message, type: "api_error", param: null, code: "api_error" } })}\n\n`;
}

export async function* streamChatChunks(
  stream: AsyncGenerator<ChatCompletionChunk>,
  responseModel: string,
  conversationId?: string,
): AsyncGenerator<string> {
  let isFirst = true;
  for await (const chunk of stream) {
    const extra: Record<string, unknown> = {};
    if (isFirst && conversationId) {
      extra.conversation_id = conversationId;
      isFirst = false;
    }
    yield `data: ${JSON.stringify({
      id: chunk.id,
      object: chunk.object,
      created: chunk.created,
      model: responseModel,
      choices: chunk.choices,
      system_fingerprint: "fp_worker-ai-proxy",
      ...extra,
    })}\n\n`;
  }
  yield "data: [DONE]\n\n";
}

export function createStreamingResponse(
  streamFn: () => AsyncGenerator<string>,
): Response {
  return new Response(
    new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const chunk of streamFn())
            controller.enqueue(encoder.encode(chunk));
        } catch (error) {
          controller.enqueue(encoder.encode(streamErrorChunk(String(error))));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } finally {
          controller.close();
        }
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    },
  );
}
