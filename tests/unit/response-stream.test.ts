import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readModelResponse, draftText } from '../../src/agent/response-stream';
import { layoutGraph, NODE_WIDTH } from '../../src/renderers/graph-layout';

test('model drafts decode split escapes and never expose reasoning fields or markup', () => {
  assert.equal(draftText('{"focus":"Scope \\u4'), 'Scope ');
  assert.equal(draftText('{"focus":"Scope \\u4e2d"}'), 'Scope 中');
  assert.equal(draftText('{"reasoning_content":"secret","markup":"<svg/>"}'), '');
});
test('SSE drafts arrive before completion; split UTF-8, CRLF, usage and finish reason survive', async () => {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream({
      start(c) {
        controller = c;
      },
    }),
    {
      headers: { 'content-type': 'text/event-stream' },
    },
  );
  const drafts: string[] = [];
  const result = readModelResponse(response, (s) => drafts.push(s));
  const send = (data: unknown) =>
    controller.enqueue(encoder.encode('data: ' + JSON.stringify(data) + '\r\n\r\n'));
  const bytes = encoder.encode(
    'data: ' +
      JSON.stringify({ choices: [{ delta: { content: '{"focus":"新方向' } }] }) +
      '\r\n\r\n',
  );
  for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(drafts, ['新方向']);
  send({ choices: [{ delta: { content: '"}' }, finish_reason: 'stop' }] });
  send({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 8 } });
  controller.enqueue(encoder.encode('data: [DONE]\r\n\r\n'));
  controller.close();
  const body = await result;
  assert.equal(body.choices[0].message.content, '{"focus":"新方向"}');
  assert.deepEqual(body.usage, { prompt_tokens: 12, completion_tokens: 8 });
});
test('interrupted SSE cannot silently become a committed model result', async () => {
  await assert.rejects(
    () =>
      readModelResponse(
        new Response('data: {"choices":[{"delta":{"content":"{}"}}]}\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        }),
      ),
    /MODEL_STREAM_INTERRUPTED/,
  );
  const data = { choices: [{ message: { content: '{}' } }] };
  assert.deepEqual(await readModelResponse(new Response(JSON.stringify(data))), data);
});
test('mindmap follows actual topology; long labels and appended nodes do not overlap', () => {
  const nodes = [
    { id: 'root', label: '目标' },
    ...['a', 'b', 'c'].map((id) => ({ id, label: '一个保留必要限制条件的长标签' })),
  ];
  const graph = {
    layout: 'mindmap' as const,
    nodes,
    edges: nodes.slice(1).map((n) => ({ from: n.id, to: 'root' })),
  };
  const first = layoutGraph(graph);
  assert.ok(first.positions.get('root')!.x < first.positions.get('a')!.x);
  const next = layoutGraph(
    {
      ...graph,
      nodes: [...nodes, { id: 'd', label: '新增' }],
      edges: [...graph.edges, { from: 'd', to: 'root' }],
    },
    first.positions,
  );
  for (const [id, p] of first.positions) assert.deepEqual(next.positions.get(id), p);
  const points = [...next.positions.values()];
  for (let a = 0; a < points.length; a++)
    for (let b = a + 1; b < points.length; b++)
      assert.ok(
        Math.abs(points[a].x - points[b].x) >= NODE_WIDTH ||
          Math.abs(points[a].y - points[b].y) >= next.nodeHeight,
      );
});
