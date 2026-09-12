import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { z } from 'zod';
import { ComponentProposal, ImpactProposal } from '../contracts/collaboration-workflow';
import type { ConflictRecord } from '../contracts/collaboration';

type ComponentPorts = {
  remaining: () => number;
  generate: (repair?: string) => Promise<unknown>;
  validate: (proposal: ComponentProposal) => void;
  trace?: (node: string) => void;
};
export async function runComponentWorkflow(ports: ComponentPorts): Promise<ComponentProposal> {
  const State = Annotation.Root({
    proposal: Annotation<ComponentProposal | null>(),
    repair: Annotation<string | undefined>(),
    route: Annotation<'done' | 'repair'>(),
  });
  const graph = new StateGraph(State)
    .addNode('assemble', async (state) => {
      ports.trace?.('assemble');
      if (ports.remaining() <= 0) throw Error('WORKFLOW_BUDGET_LIMIT');
      try {
        return {
          proposal: ComponentProposal.parse(await ports.generate(state.repair)),
          repair: undefined,
        };
      } catch (e) {
        if (!(e instanceof z.ZodError) && !(e instanceof SyntaxError)) throw e;
        if (ports.remaining() <= 0) throw Error('INVALID_COMPONENT_PROPOSAL');
        return { proposal: null, repair: 'INVALID_COMPONENT_PROPOSAL' };
      }
    })
    .addNode('validate', (state) => {
      ports.trace?.('validate');
      try {
        ports.validate(state.proposal!);
        return { route: 'done' as const };
      } catch (e) {
        if (ports.remaining() <= 0) throw e;
        return {
          route: 'repair' as const,
          repair: e instanceof Error ? e.message : 'INVALID_COMPONENT_PROPOSAL',
        };
      }
    })
    .addEdge(START, 'assemble')
    .addConditionalEdges('assemble', (s) => (s.proposal ? 'validate' : 'assemble'), {
      validate: 'validate',
      assemble: 'assemble',
    })
    .addConditionalEdges('validate', (s) => s.route, { done: END, repair: 'assemble' })
    .compile({ name: 'collaboration-component' });
  const result = await graph.invoke(
    { proposal: null, repair: undefined, route: 'done' },
    { recursionLimit: 10 },
  );
  return result.proposal!;
}
type ImpactPorts = {
  rules: () => ConflictRecord[];
  semanticNeeded: boolean;
  remaining: () => number;
  analyze: (repair?: string) => Promise<unknown>;
  validate?: (proposal: ImpactProposal) => void;
  trace?: (node: string) => void;
};
export async function runImpactWorkflow(
  ports: ImpactPorts,
): Promise<Array<ConflictRecord | ImpactProposal['conflicts'][number]>> {
  const State = Annotation.Root({
    ruleResults: Annotation<ConflictRecord[]>(),
    semantic: Annotation<ImpactProposal | null>(),
    repair: Annotation<string | undefined>(),
  });
  const graph = new StateGraph(State)
    .addNode('rules', () => {
      ports.trace?.('rules');
      return { ruleResults: ports.rules() };
    })
    .addNode('analyze', async (state) => {
      ports.trace?.('analyze');
      if (ports.remaining() <= 0) throw Error('WORKFLOW_BUDGET_LIMIT');
      try {
        const proposal = ImpactProposal.parse(await ports.analyze(state.repair));
        ports.validate?.(proposal);
        return { semantic: proposal, repair: undefined };
      } catch (e) {
        if (ports.remaining() <= 0) throw e;
        if (
          !(e instanceof z.ZodError) &&
          !(e instanceof SyntaxError) &&
          !(e instanceof Error && e.message === 'INVALID_EVIDENCE')
        )
          throw e;
        return { semantic: null, repair: 'INVALID_EVIDENCE_OR_SCHEMA' };
      }
    })
    .addEdge(START, 'rules')
    .addConditionalEdges('rules', () => (ports.semanticNeeded ? 'analyze' : 'done'), {
      analyze: 'analyze',
      done: END,
    })
    .addConditionalEdges('analyze', (s) => (s.semantic ? 'done' : 'analyze'), {
      done: END,
      analyze: 'analyze',
    })
    .compile({ name: 'collaboration-impact' });
  const r = await graph.invoke(
    { ruleResults: [], semantic: null, repair: undefined },
    { recursionLimit: 8 },
  );
  return [...r.ruleResults, ...(r.semantic?.conflicts ?? [])];
}
