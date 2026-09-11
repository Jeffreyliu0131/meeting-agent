import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  Locale,
  type Meeting,
  type Command,
  type Preferences,
  type Segment,
} from '../contracts/model';
import { calculate } from './calculator';
import { validateRefs } from './evidence';
export const uid = () => randomUUID();
const limited = z.string().trim().min(1).max(12000);
export function createMeeting(payload: Record<string, unknown>, preferences: Preferences): Meeting {
  const p = z
    .object({
      title: z.string().max(120),
      mode: z.enum(['manual', 'microphone', 'online', 'replay']),
      outputLocale: Locale,
      timezone: z.string().max(100),
    })
    .parse(payload);
  new Intl.DateTimeFormat('en', { timeZone: p.timezone });
  return {
    id: uid(),
    title: p.title || 'Untitled meeting',
    timezone: p.timezone,
    createdAt: new Date().toISOString(),
    endedAt: null,
    status: 'active',
    mode: p.mode,
    capture: 'idle',
    epoch: 0,
    revision: 1,
    inputVersion: 0,
    understoodVersion: 0,
    languageRevision: 1,
    outputLocale: p.outputLocale || preferences.defaultOutputLocale,
    segments: [],
    translations: [],
    inputGaps: [],
    objects: [],
    relations: [],
    artifacts: [],
    scenarios: [],
    decisions: [],
    focus: '',
    changes: [],
    processing: 'idle',
    error: null,
    captureError: null,
    metrics: { calls: 0, inputTokens: 0, outputTokens: 0, lastLatencyMs: 0 },
  };
}
export function reduceMeeting(
  m: Meeting,
  command: Command,
): { schedule: boolean; result: unknown } {
  const p = command.payload;
  let schedule = false;
  let result: unknown = null;
  const active = () => {
    if (m.status !== 'active') throw new Error('MEETING_ENDED');
  };
  switch (command.type) {
    case 'ingest':
    case 'ask': {
      active();
      const text = limited.parse(p.text);
      const kind =
        command.type === 'ask'
          ? 'request'
          : z.enum(['manual', 'replay', 'microphone', 'system_audio']).parse(p.kind);
      if (kind === 'microphone' || kind === 'system_audio') {
        if (p.epoch !== m.epoch || m.capture !== 'capturing') throw new Error('CAPTURE_EXPIRED');
      } else if (
        command.type !== 'ask' &&
        ((m.mode === 'replay' && kind !== 'replay') || (m.mode !== 'replay' && kind === 'replay'))
      )
        throw new Error('SOURCE_MISMATCH');
      const segmentId =
        typeof p.segmentId === 'string'
          ? z
              .string()
              .regex(/^[\w-]{1,100}$/)
              .parse(p.segmentId)
          : uid();
      const existing = m.segments.find((s) => s.id === segmentId);
      if (existing) {
        if (existing.text !== text || existing.kind !== kind)
          throw new Error('IDEMPOTENCY_CONFLICT');
        return { schedule: false, result: existing };
      }
      const segment: Segment = {
        id: segmentId,
        rev: 1,
        text,
        kind,
        epoch: m.epoch,
        channel: typeof p.channel === 'string' ? p.channel.slice(0, 100) : kind,
        order: m.segments.length + 1,
        receivedAt: new Date().toISOString(),
        speaker: null,
        identity: 'unknown' as const,
        identityBasis: null,
        synthetic: kind === 'replay',
      };
      m.segments.push(segment);
      m.inputVersion++;
      schedule = true;
      result = segment;
      break;
    }
    case 'correct': {
      const s = m.segments.filter((s) => s.id === p.segmentId).at(-1);
      if (!s) throw new Error('SOURCE_NOT_FOUND');
      if (s.rev !== p.baseRevision) throw new Error('REV_CONFLICT');
      const text = limited.parse(p.text);
      const speaker = z
        .string()
        .max(100)
        .nullable()
        .parse(p.speaker ?? null);
      const basis = speaker ? limited.parse(p.basis) : null;
      m.segments.push({
        ...s,
        rev: s.rev + 1,
        text,
        speaker,
        identity: speaker ? 'user_mapped' : 'unknown',
        identityBasis: basis,
        receivedAt: new Date().toISOString(),
      });
      m.inputVersion++;
      schedule = true;
      break;
    }
    case 'language':
      m.outputLocale = Locale.parse(p.locale);
      m.languageRevision++;
      schedule = m.segments.length > 0;
      break;
    case 'retry':
      schedule = m.segments.length > 0;
      break;
    case 'captureStart':
      active();
      if (!['microphone', 'online'].includes(m.mode)) throw new Error('NOT_AUDIO_MEETING');
      if (m.capture === 'capturing' || m.capture === 'starting')
        throw new Error('ALREADY_CAPTURING');
      m.epoch++;
      m.capture = 'starting';
      m.captureError = null;
      break;
    case 'captureReady':
      active();
      if (p.epoch !== m.epoch || m.capture !== 'starting') throw new Error('CAPTURE_EXPIRED');
      m.capture = 'capturing';
      break;
    case 'captureError':
      if (p.epoch !== m.epoch || m.status === 'ended') return { schedule: false, result: null };
      m.epoch++;
      m.capture = 'input_error';
      m.captureError = z
        .string()
        .max(100)
        .regex(/^[A-Z0-9_]+$/)
        .parse(p.code);
      break;
    case 'pause':
      active();
      m.epoch++;
      m.capture = 'paused';
      break;
    case 'end':
      if (m.status === 'ended') return { schedule: false, result: null };
      m.status = 'ended';
      m.capture = 'stopped';
      m.epoch++;
      m.endedAt = new Date().toISOString();
      break;
    case 'scenario': {
      const a = m.artifacts.find((a) => a.id === p.artifactId && a.rev === p.artifactRev);
      if (!a) throw new Error('ARTIFACT_NOT_FOUND');
      const formula = a.formulas.find((f) => f.id === p.formulaId);
      if (!formula) throw new Error('FORMULA_NOT_FOUND');
      const values = z.record(z.string(), z.number().finite().nullable()).parse(p.values);
      const value = calculate(formula, values);
      const scenario = {
        id: uid(),
        artifactId: a.id,
        artifactRev: a.rev,
        formula: structuredClone(formula),
        values,
        result: value,
        baseInputVersion: a.inputVersion,
        createdAt: new Date().toISOString(),
      };
      m.scenarios.push(scenario);
      result = scenario;
      break;
    }
    case 'decision': {
      const a = m.artifacts.find((a) => a.id === p.artifactId && a.rev === p.artifactRev);
      if (!a) throw new Error('ARTIFACT_NOT_FOUND');
      const scope = z.enum(['personal', 'meeting']).parse(p.scope);
      const basis = limited.parse(p.basis);
      const participants = z
        .string()
        .max(500)
        .parse(p.participants || '');
      const sourceIds = z.array(z.string()).parse(p.sourceIds || []);
      const sources = m.segments
        .filter(
          (s) =>
            sourceIds.includes(s.id) && !m.segments.some((t) => t.id === s.id && t.rev > s.rev),
        )
        .map((s) => ({ id: s.id, rev: s.rev }));
      if (scope === 'meeting') {
        if (!participants.trim()) throw new Error('DECISION_SCOPE_REQUIRED');
        validateRefs(sources, m, true);
        if (a.inputVersion !== m.inputVersion) throw new Error('SOURCE_SUPERSEDED');
      }
      const decision = {
        id: uid(),
        scope,
        artifact: structuredClone(a),
        basis,
        participants,
        sources,
        createdAt: new Date().toISOString(),
      };
      m.decisions.push(decision);
      result = decision;
      break;
    }
    default:
      throw new Error('INVALID_COMMAND');
  }
  m.revision++;
  if (schedule) {
    m.error = null;
    m.processing = 'idle';
  }
  return { schedule, result };
}
