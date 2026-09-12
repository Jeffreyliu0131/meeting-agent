import { BookOpen } from 'lucide-react';
import { themeVariables } from '../ui/theme';
import React, { useEffect, useState } from 'react';
import { RelationshipGraph } from './RelationshipGraph';
import type { ArtifactRevision, Block, Ref, Locale } from '../contracts/model';
import { translator } from '../ui/i18n';
const csp =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'";
export function Markup({ block }: { block: Extract<Block, { markup: string }> }) {
  const css = `:root{${themeVariables}}*{box-sizing:border-box}body{margin:16px;font:15px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:var(--textPrimary);background:var(--contentSurface);overflow-wrap:anywhere}h2{font-size:17px;font-weight:600}h3{font-size:16px;font-weight:600}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:14px;text-align:left;border-bottom:1px solid var(--divider)}th{background:var(--subtleSurface)}svg{max-width:100%;height:auto}section{margin-bottom:24px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr));gap:20px}.stack{display:grid;gap:16px}.muted{color:var(--textSecondary)}.emphasis{font-weight:600}.callout{padding:16px;background:var(--accentSubtle);border-left:3px solid var(--accent);border-radius:0 8px 8px 0}`;
  return (
    <iframe
      title={block.title}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${css}</style></head><body>${block.markup}</body></html>`}
      className="generated-frame"
    />
  );
}
export function ArtifactView({
  artifact,
  locale,
  onSources,
  sourceNumbers = {},
  selectedSources,
  selectedTarget,
  onAction,
}: {
  artifact: ArtifactRevision;
  locale: Locale;
  onSources: (refs: Ref[], target?: string) => void;
  sourceNumbers?: Record<string, number>;
  selectedSources?: Ref[] | null;
  selectedTarget?: string;
  onAction?: (prompt: string) => void;
}) {
  const t = translator(locale);
  const citations = (refs: Ref[], target: string) =>
    refs.length > 0 && (
      <span className="source-citations">
        {refs.slice(0, 3).map((ref) => (
          <button
            key={`${ref.id}:${ref.rev}`}
            aria-label={t('sources.open')}
            title={`${target} · ${t('revision')} ${ref.rev}`}
            aria-pressed={
              !!selectedSources?.some(
                (selected) => selected.id === ref.id && selected.rev === ref.rev,
              ) && selectedTarget === target
            }
            onClick={() => onSources([ref], target)}
          >
            [{sourceNumbers[ref.id] ?? '…'}]
          </button>
        ))}
        {refs.length > 3 && (
          <button
            aria-label={`${t('sources.open')}: ${target}`}
            onClick={() => onSources(refs, target)}
          >
            +{refs.length - 3}
          </button>
        )}
      </span>
    );
  const [highlight, setHighlight] = useState<string[]>([]);
  useEffect(() => {
    setHighlight(artifact.changedBlockIds ?? []);
    const timer = setTimeout(() => setHighlight([]), 1800);
    return () => clearTimeout(timer);
  }, [artifact.id, artifact.rev]);
  return (
    <div className={`artifact-blocks ${artifact.layout}`}>
      {artifact.blocks.map((block) => (
        <section
          id={'block-' + block.id}
          tabIndex={-1}
          data-source-selected={
            selectedSources?.length &&
            (!selectedTarget || selectedTarget.startsWith(block.title)) &&
            block.sources.some((ref) =>
              selectedSources.some(
                (selected) => selected.id === ref.id && selected.rev === ref.rev,
              ),
            )
              ? true
              : undefined
          }
          data-block-id={block.id}
          className={`expression ${highlight.includes(block.id) ? 'expression-changed' : ''}`}
          key={block.id}
        >
          <div className="expression-heading">
            <h2>{block.title}</h2>
            {block.sources.length > 0 && (
              <button
                className="block-source-trigger text-button"
                aria-label={`${t('sources.open')}: ${block.title}`}
                title={t('sources.open')}
                onClick={() => onSources(block.sources, block.title)}
              >
                <BookOpen size={13} />
                <span>{block.sources.length}</span>
              </button>
            )}
          </div>
          <div className="provenance">
            <span>{t(block.origin)}</span>
            <span className={`semantic-state state-${block.status}`}>{t(block.status)}</span>
          </div>
          {block.type === 'actions' && (
            <div className="button-row">
              {block.items.map((item) => (
                <button key={item.id} disabled={!onAction} onClick={() => onAction?.(item.prompt)}>
                  {item.label}
                </button>
              ))}
            </div>
          )}
          {block.type === 'text' && (
            <ul className={block.items.length === 1 ? 'plain-list' : ''}>
              {block.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          )}
          {block.type === 'table' && (
            <div className="table-scroll" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    {block.columns.map((c, i) => (
                      <th key={i}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row) => (
                    <tr
                      key={row.id}
                      data-source-selected={
                        (selectedTarget === block.title + ' · ' + row.cells[0] &&
                          !!selectedSources?.length) ||
                        undefined
                      }
                    >
                      {row.cells.map((cell, i) => (
                        <td key={i}>
                          {cell}
                          {i === row.cells.length - 1 &&
                            citations(row.sources, block.title + ' · ' + row.cells[0])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {block.type === 'diagram' && (
            <RelationshipGraph
              locale={locale}
              block={block}
              artifact={artifact}
              onSources={(refs) => onSources(refs, block.title)}
            />
          )}
          {block.type === 'timeline' && (
            <ol className="timeline">
              {block.items.map((item) => (
                <li key={item.id}>
                  <div className="time-label">{item.when}</div>
                  <div>
                    <strong>{item.label}</strong>
                    <p>{item.detail}</p>
                    <button
                      className="source-link"
                      onClick={() => onSources(item.sources, item.label)}
                    >
                      {t('sources.open')}
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {block.type === 'chart' && (
            <div className="bar-chart">
              <p className="muted">{block.unit}</p>
              {block.values.map((v, i) => (
                <div className="bar-row" key={i}>
                  <span>{v.label}</span>
                  <div className="bar-track diverging">
                    <div
                      className="bar"
                      style={{
                        width: `${(Math.abs(v.value) / Math.max(...block.values.map((v) => Math.abs(v.value)), 1)) * 50}%`,
                        marginLeft: `${v.value < 0 ? 50 - (Math.abs(v.value) / Math.max(...block.values.map((v) => Math.abs(v.value)), 1)) * 50 : 50}%`,
                      }}
                    />
                  </div>
                  <button className="source-link" onClick={() => onSources(v.sources, v.label)}>
                    {v.value} {block.unit}
                  </button>
                </div>
              ))}
            </div>
          )}
          {(block.type === 'html' || block.type === 'svg') && <Markup block={block} />}
        </section>
      ))}
    </div>
  );
}
