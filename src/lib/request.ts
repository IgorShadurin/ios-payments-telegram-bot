export class RequestBodyError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 | 415,
  ) {
    super(message);
    this.name = "RequestBodyError";
  }
}

export async function readJsonBody(
  request: Request,
  maxBytes = 512 * 1024,
): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new RequestBodyError("Content-Type must be application/json", 415);
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new RequestBodyError("Request body is too large", 413);
  }
  if (!request.body) {
    throw new RequestBodyError("Request body is required", 400);
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new RequestBodyError("Request body is too large", 413);
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(combined),
    );
  } catch {
    throw new RequestBodyError("Request body must be valid UTF-8 JSON", 400);
  }
}
