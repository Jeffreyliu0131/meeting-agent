import sanitize from 'sanitize-html';
import type {
  Artifact,
  Meeting,
  Proposal,
  Ref,
  ObjectState,
  RelationState,
} from '../contracts/model';
import { validateRefs } from '../domain/evidence';
import { calculate } from '../domain/calculator';
import { validateMeaning } from '../domain/meaning';
export function safeMarkup(markup: string, type: 'html' | 'svg'): string {
  if (Buffer.byteLength(markup) > 50000 || (markup.match(/</g) || []).length > 700)
    throw new Error('ARTIFACT_TOO_LARGE');
  // Active content is rejected, never silently converted into apparent success.
  if (
    /<\s*(script|iframe|object|embed|foreignObject|style|link|meta|form|input|button|image|use|animate|set)\b|\bon\w+\s*=|(?:href|src|url|style)\s*[=(]|<!|<\?/i.test(
      markup,
    )
  )
    throw new Error('UNSAFE_ARTIFACT');
  const tags =
    type === 'svg'
      ? [
          'svg',
          'g',
          'path',
          'rect',
          'circle',
          'ellipse',
          'line',
          'polyline',
          'polygon',
          'text',
          'tspan',
          'title',
          'desc',
        ]
      : [
          'section',
          'div',
          'p',
          'h2',
          'h3',
          'h4',
          'ul',
          'ol',
          'li',
          'strong',
          'em',
          'span',
          'table',
          'thead',
          'tbody',
          'tr',
          'th',
          'td',
          'br',
        ];
  const cleaned = sanitize(markup, {
    allowedTags: tags,
    allowedAttributes:
      type === 'svg'
        ? {
            '*': [
              'id',
              'viewBox',
              'xmlns',
              'x',
              'y',
              'x1',
              'y1',
              'x2',
              'y2',
              'width',
              'height',
              'cx',
              'cy',
              'r',
              'rx',
              'ry',
              'd',
              'points',
              'fill',
              'stroke',
              'stroke-width',
              'text-anchor',
              'font-size',
              'transform',
            ],
          }
        : { '*': ['id', 'class'] },
    allowedClasses: { '*': ['grid', 'stack', 'muted', 'emphasis', 'callout'] },
    parser: { lowerCaseAttributeNames: false, lowerCaseTags: false },
    allowedSchemes: [],
  });
  if (type === 'svg' && !/^\s*<svg\b/.test(cleaned)) throw new Error('INVALID_SVG');
  const identifiers = [...cleaned.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  if (new Set(identifiers).size !== identifiers.length) throw new Error('DUPLICATE_ID');
  for (const size of cleaned.matchAll(/font-size="([\d.]+)"/g))
    if (Number(size[1]) < 14) throw new Error('UNREADABLE_TEXT');
  return cleaned;
}
export function validateArtifact(
  a: Artifact,
  meeting: Meeting,
  objects: ObjectState[],
  relations: RelationState[],
): Artifact {
  if (Buffer.byteLength(JSON.stringify(a)) > 100000) throw new Error('ARTIFACT_TOO_LARGE');
  validateRefs(a.sources, meeting, true);
  const objectIds = new Set(objects.map((o) => o.id));
  const ids = new Set<string>();
  for (const block of a.blocks) {
    if (ids.has(block.id)) throw new Error('DUPLICATE_ID');
    ids.add(block.id);
    validateRefs(block.sources, meeting, true);
    if (block.origin === 'tool_computed') throw new Error('UNTRUSTED_TOOL_RESULT');
    if (block.objectIds.some((id) => !objectIds.has(id))) throw new Error('INVALID_OBJECT');
    if (block.type === 'table') {
      for (const row of block.rows) {
        if (row.cells.length !== block.columns.length) throw new Error('TABLE_WIDTH');
        validateRefs(row.sources, meeting, true);
      }
    }
    if (block.type === 'actions')
      for (const item of block.items) validateRefs(item.sources, meeting, true);
    if (block.type === 'timeline')
      for (const item of block.items) validateRefs(item.sources, meeting, true);
    if (block.type === 'chart')
      for (const item of block.values) {
        validateRefs(item.sources, meeting, true);
        if (item.binding) {
          const result = (
            meeting.toolObservations as import('../agent/tools').ToolObservation[] | undefined
          )?.find((r) => r.resultId === item.binding!.resultId && r.kind === 'calculate');
          const value = result?.values[0] as { result: string | null; unit: string } | undefined;
          if (
            !result ||
            !value ||
            !['known', 'conditional'].includes(result.status) ||
            value.result === null
          )
            throw new Error('UNKNOWN_TOOL_BINDING');
          if (value.unit !== block.unit) throw new Error('UNIT_MISMATCH');
          if (Number(value.result) !== item.value) throw new Error('TOOL_VALUE_MISMATCH');
        }
      }
    if (block.type === 'diagram') {
      const nodes = new Set(block.nodes.map((n) => n.id));
      if (nodes.size !== block.nodes.length || block.nodes.some((n) => !objectIds.has(n.objectId)))
        throw new Error('INVALID_NODE');
      for (const edge of block.edges) {
        const from = block.nodes.find((node) => node.id === edge.from);
        const to = block.nodes.find((node) => node.id === edge.to);
        const relation = relations.find((item) => item.id === edge.relationId);
        if (
          !from ||
          !to ||
          !relation ||
          relation.from !== from.objectId ||
          relation.to !== to.objectId
        )
          throw new Error('INVALID_EDGE');
      }
    }
    if (block.type === 'html' || block.type === 'svg')
      block.markup = safeMarkup(block.markup, block.type);
  }
  if (a.objectIds.some((id) => !objectIds.has(id))) throw new Error('INVALID_OBJECT');
  for (const formula of a.formulas) {
    validateRefs(formula.sources, meeting, true);
    if (
      !formula.sources.some((r) =>
        meeting.segments.some(
          (s) => s.id === r.id && s.rev === r.rev && s.text.includes(formula.basis),
        ),
      )
    )
      throw new Error('FORMULA_BASIS_NOT_QUOTED');
    calculate(formula);
  }
  return a;
}
export function validateDelta(proposal: Proposal, meeting: Meeting) {
  validateMeaning(proposal, meeting);
  if ([proposal.artifact, proposal.patch, proposal.plan].filter(Boolean).length > 1)
    throw new Error('AMBIGUOUS_EXPRESSION');
  if (proposal.plan) {
    validateRefs(proposal.plan.sources, meeting, true);
    if (
      proposal.plan.objectIds.some(
        (id) => ![...meeting.objects, ...proposal.objects].some((o) => o.id === id),
      )
    )
      throw new Error('INVALID_OBJECT');
  }
  const seen = new Set<string>();
  for (const obj of proposal.objects) {
    if (seen.has(obj.id)) throw new Error('DUPLICATE_ID');
    seen.add(obj.id);
    validateRefs(obj.sources, meeting, true);
    if (
      obj.origin === 'stated' &&
      obj.sources.every(
        (r) => meeting.segments.find((s) => s.id === r.id && s.rev === r.rev)?.kind === 'request',
      )
    )
      throw new Error('REQUEST_IS_NOT_FACT');
    if (obj.origin === 'tool_computed') throw new Error('UNTRUSTED_TOOL_RESULT');
  }
  const objects = new Set([
    ...meeting.objects.map((o) => o.id),
    ...proposal.objects.map((o) => o.id),
  ]);
  const relationIds = new Set<string>();
  for (const r of proposal.relations) {
    if (relationIds.has(r.id)) throw new Error('DUPLICATE_ID');
    relationIds.add(r.id);
    if (r.origin === 'tool_computed') throw new Error('UNTRUSTED_TOOL_RESULT');
    if (!objects.has(r.from) || !objects.has(r.to)) throw new Error('INVALID_RELATION');
    validateRefs(r.sources, meeting, true);
  }
  if (
    ['create_artifact', 'patch_artifact', 'propose_restructure'].includes(proposal.action) &&
    !proposal.artifact &&
    !proposal.patch &&
    !proposal.plan
  )
    throw new Error('MISSING_ARTIFACT');
  if (proposal.action === 'no_change' && (proposal.artifact || proposal.patch || proposal.plan))
    throw new Error('NO_CHANGE_ARTIFACT');
}
