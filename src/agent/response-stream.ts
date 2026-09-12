/** Only human-facing JSON fields become ephemeral drafts; never reasoning or executable markup. */
export function draftText(content: string): string {
  const fields: Partial<Record<'focus' | 'question' | 'summary', string>> = {};
  const pattern = /"(focus|question|summary)"\s*:\s*"/g;
  for (const match of content.matchAll(pattern)) {
    let raw = '',
      escaped = false;
    for (let i = match.index! + match[0].length; i < content.length; i++) {
      const c = content[i];
      if (!escaped && c === '"') break;
      raw += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
    }
    // A chunk may end inside a JSON escape; retain the preceding complete text.
    raw = raw.replace(/\\(?:u[\da-fA-F]{0,3})?$/, '');
    try {
      fields[match[1] as keyof typeof fields] = JSON.parse('"' + raw + '"');
    } catch {
      /* Wait for the next complete escape. */
    }
  }
  return (fields.summary || fields.focus || fields.question || '').slice(0, 240);
}

export async function readModelResponse(
  response: Response,
  onDraft?: (text: string) => void,
): Promise<any> {
  // Compatible endpoints and transport test doubles may still return a complete JSON response.
  if (!response.headers.get('content-type')?.includes('text/event-stream')) return response.json();
  if (!response.body) throw new Error('MODEL_STREAM_INTERRUPTED');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '',
    content = '',
    finish: string | null = null,
    refusal = '';
  let usage: unknown,
    done = false,
    previous = '',
    lastUpdate = 0;
  const event = (packet: string) => {
    const data = packet
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    if (data.trim() === '[DONE]') {
      done = true;
      return;
    }
    const value = JSON.parse(data);
    if (value.error) throw new Error('MODEL_STREAM_FAILED');
    if (value.usage) usage = value.usage;
    const choice = value.choices?.[0];
    if (choice?.finish_reason) finish = choice.finish_reason;
    if (typeof choice?.delta?.refusal === 'string') refusal += choice.delta.refusal;
    if (typeof choice?.delta?.content === 'string') content += choice.delta.content;
    if (content.length > 150000) throw new Error('INVALID_PROPOSAL');
    const draft = draftText(content);
    if (draft && draft !== previous && (!previous || Date.now() - lastUpdate >= 80)) {
      previous = draft;
      lastUpdate = Date.now();
      onDraft?.(draft);
    }
  };
  try {
    while (true) {
      const part = await reader.read();
      buffer += decoder.decode(part.value, { stream: !part.done });
      if (buffer.length > 1_000_000) throw new Error('MODEL_STREAM_FAILED');
      const packets = buffer.split(/\r?\n\r?\n/);
      buffer = packets.pop()!;
      for (const packet of packets) event(packet);
      if (part.done || done) break;
    }
    if (buffer.trim()) event(buffer);
    if (!done && !finish) throw new Error('MODEL_STREAM_INTERRUPTED');
    return { choices: [{ message: { content, refusal }, finish_reason: finish }], usage };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
