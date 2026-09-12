import { z } from 'zod';
import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { Proposal, type Meeting } from '../contracts/model';
import type { EvidenceRequest } from '../contracts/workflow';

const State = Annotation.Root({
  proposal: Annotation<Proposal | null>(),
  repair: Annotation<string | undefined>(),
  route: Annotation<'done' | 'evidence' | 'repair'>(),
});
export type WorkflowPorts = {
  context: Meeting;
  interpret: (repair?: string) => Promise<unknown>;
  validate: (proposal: Proposal) => void;
  evidence: (request: EvidenceRequest) => Promise<void>;
  remaining: () => number;
};
/** Durable jobs own budgets and replay. Graph nodes have no automatic retry policy. */
function createWorkflow(ports: WorkflowPorts, personal: boolean) {
  return new StateGraph(State)
    .addNode('interpret', async (state) => {
      try {
        return { proposal: Proposal.parse(await ports.interpret(state.repair)), repair: undefined };
      } catch (error) {
        if (
          ports.remaining() <= 0 ||
          (!(error instanceof z.ZodError) && !(error instanceof SyntaxError))
        )
          throw error;
        return {
          proposal: null,
          repair:
            error instanceof z.ZodError
              ? 'INVALID_PROPOSAL: ' +
                error.issues
                  .slice(0, 8)
                  .map((i) => `${i.path.join('.')}: ${i.message}`)
                  .join('; ')
                  .slice(0, 1600)
              : 'INVALID_PROPOSAL: return valid JSON matching the supplied schema',
        };
      }
    })
    .addNode('validate', (state) => {
      const p = state.proposal!;
      if (p.action === 'request_clarification' && !ports.context.toolObservations?.length) {
        p.evidenceRequest = {
          kind: 'search_meeting',
          query: p.clarification?.question ?? p.focus,
          refs: [],
          cursor: 0,
          limit: 10,
          formulaId: '',
          overrides: {},
        };
        p.objects = [];
        p.relations = [];
        p.artifact = null;
        p.plan = null;
        p.patch = null;
        p.intentPreparation = null;
      }
      if (p.evidenceRequest) {
        if (
          p.objects.length ||
          p.relations.length ||
          p.artifact ||
          p.plan ||
          p.patch ||
          p.intentPreparation?.intents.length
        )
          throw new Error('EVIDENCE_WITH_WRITES');
        if (ports.remaining() <= 0) throw new Error('WORKFLOW_BUDGET_LIMIT');
        return { route: 'evidence' as const };
      }
      try {
        ports.validate(p);
        return { route: 'done' as const };
      } catch (e) {
        if (ports.remaining() <= 0) throw e;
        return {
          route: 'repair' as const,
          repair: e instanceof Error ? e.message : 'INVALID_PROPOSAL',
        };
      }
    })
    .addNode('evidence', async (state) => {
      await ports.evidence(state.proposal!.evidenceRequest!);
      return { proposal: null };
    })
    .addNode('prepareRepair', (state) => ({ proposal: null, repair: state.repair }))
    .addEdge(START, 'interpret')
    .addConditionalEdges('interpret', (s) => (s.proposal ? 'validate' : 'prepareRepair'), {
      validate: 'validate',
      prepareRepair: 'prepareRepair',
    })
    .addConditionalEdges('validate', (s) => s.route, {
      done: END,
      evidence: 'evidence',
      repair: 'prepareRepair',
    })
    .addEdge('evidence', 'interpret')
    .addEdge('prepareRepair', 'interpret')
    .compile({ name: personal ? 'personal-exploration' : 'meeting-understanding' });
}
export async function runWorkflow(ports: WorkflowPorts, personal = false) {
  const result = await createWorkflow(ports, personal).invoke(
    { proposal: null, route: 'done' },
    { recursionLimit: 24 },
  );
  if (!result.proposal) throw new Error('INVALID_PROPOSAL');
  return result.proposal;
}
