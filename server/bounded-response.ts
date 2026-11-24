export async function readBoundedText(
  response: { body: ReadableStream<Uint8Array> | null; headers: Pick<Headers, "get"> },
  limit: number,
  errorMessage: string,
): Promise<string> {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(errorMessage);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > limit) {
        await reader.cancel().catch(() => undefined);
        throw new Error(errorMessage);
      }
      const text = decoder.decode(value, { stream: true });
      if (text) chunks.push(text);
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}
