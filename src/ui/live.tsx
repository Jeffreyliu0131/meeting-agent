import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ArtifactRevision, Formula, Locale } from '../contracts/model';
import { ScenarioEditor } from './components';
import { translator } from './i18n';

/** Protect only a selected block; typing in the ask bar never freezes the meeting. */
export function useLiveArtifact(incoming: ArtifactRevision | undefined) {
  const [displayed, setDisplayed] = useState(incoming),
    [protectedId, setProtectedId] = useState<string | null>(null);
  useEffect(() => {
    const selection = () => {
      const s = window.getSelection();
      const anchor = s?.anchorNode;
      const element = anchor instanceof Element ? anchor : anchor?.parentElement;
      setProtectedId(
        s && !s.isCollapsed
          ? (element?.closest<HTMLElement>('[data-block-id]')?.dataset.blockId ?? null)
          : null,
      );
    };
    document.addEventListener('selectionchange', selection);
    return () => document.removeEventListener('selectionchange', selection);
  }, []);
  useLayoutEffect(() => {
    if (!incoming) {
      setDisplayed(undefined);
      return;
    }
    setDisplayed((previous) => {
      if (!previous) return incoming;
      if (previous.id !== incoming.id) return protectedId ? previous : incoming;
      const map = new Map(incoming.blocks.map((b) => [b.id, b]));
      const blocks = previous.blocks
        .flatMap((old) => {
          const next = map.get(old.id);
          map.delete(old.id);
          if (old.id === protectedId) return [old];
          return next ? [next] : [];
        })
        .concat([...map.values()]);
      const elementSources = { ...incoming.elementSources };
      if (protectedId) {
        const old = previous.blocks.find((b) => b.id === protectedId);
        for (const id of old?.objectIds ?? [])
          if (previous.elementSources?.[id]) elementSources[id] = previous.elementSources[id];
        if (old?.type === 'diagram')
          for (const e of old.edges)
            if (previous.elementSources?.[e.relationId])
              elementSources[e.relationId] = previous.elementSources[e.relationId];
      }
      return {
        ...incoming,
        elementSources,
        changedBlockIds: incoming.changedBlockIds?.filter((id) => id !== protectedId),
        blocks: incoming.updateKind === 'restructure' && !protectedId ? incoming.blocks : blocks,
      };
    });
  }, [incoming, protectedId]);
  return { artifact: displayed, protectedId };
}
type Slot = { artifact: ArtifactRevision; formula: Formula; dirty: boolean };
/** Drafts hold their exact formula revision while the rest of the page continues following. */
export function ScenarioShelf({
  artifact,
  locale,
  onSave,
}: {
  artifact: ArtifactRevision;
  locale: Locale;
  onSave: (
    artifact: ArtifactRevision,
    formula: Formula,
    values: Record<string, number | null>,
  ) => Promise<unknown>;
}) {
  const t = translator(locale),
    [slots, setSlots] = useState<Record<string, Slot>>({});
  useEffect(() => {
    setSlots((old) => {
      const next: Record<string, Slot> = {};
      for (const [key, slot] of Object.entries(old)) if (slot.dirty) next[key] = slot;
      for (const formula of artifact.formulas) {
        const key = artifact.id + ':' + formula.id;
        next[key] = old[key]?.dirty ? old[key] : { artifact, formula, dirty: false };
      }
      return next;
    });
  }, [artifact]);
  return (
    <>
      {Object.entries(slots).map(([key, slot]) => {
        const current =
          artifact.id === slot.artifact.id
            ? artifact.formulas.find((f) => f.id === slot.formula.id)
            : undefined;
        const changed =
          !current ||
          JSON.stringify({ ...current, sources: [] }) !==
            JSON.stringify({ ...slot.formula, sources: [] });
        return (
          <div key={key} className="scenario-slot">
            {slot.dirty && changed && (
              <div className="update-notice">
                {t('live.scenarioChanged')}
                <button
                  onClick={() =>
                    setSlots((old) => {
                      const next = { ...old };
                      if (current) next[key] = { artifact, formula: current, dirty: false };
                      else delete next[key];
                      return next;
                    })
                  }
                >
                  {t('live.useCurrent')}
                </button>
              </div>
            )}
            <ScenarioEditor
              key={slot.artifact.rev}
              formula={slot.formula}
              locale={locale}
              onDirty={() => setSlots((old) => ({ ...old, [key]: { ...old[key], dirty: true } }))}
              onSave={(values) => onSave(slot.artifact, slot.formula, values)}
            />
          </div>
        );
      })}
    </>
  );
}
