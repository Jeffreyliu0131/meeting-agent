import React, { useEffect, useState } from 'react';
import { RelationshipGraph } from './RelationshipGraph';
import type { ArtifactRevision, Block, Ref, Locale } from '../contracts/model';
import { translator } from '../ui/i18n';
const csp =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'";
export function Markup({ block }: { block: Extract<Block, { markup: string }> }) {
  const css = `*{box-sizing:border-box}body{margin:16px;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1D2430;background:white;overflow-wrap:anywhere}h2{font-size:22px}h3{font-size:18px}table{border-collapse:collapse;width:100%}td,th{padding:12px;text-align:left;border-bottom:1px solid #E2E6EC}svg{max-width:100%;height:auto}section{margin-bottom:20px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px}.stack{display:grid;gap:12px}.muted{color:#596575}.emphasis{font-weight:600}.callout{padding:12px;background:#F3F5F8;border-left:3px solid #607F9C}`;
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
  onAction,
}: {
  artifact: ArtifactRevision;
  locale: Locale;
  onSources: (refs: Ref[]) => void;
  onAction?: (prompt: string) => void;
}) {
  const t = translator(locale);
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
          data-block-id={block.id}
          className={`expression ${highlight.includes(block.id) ? 'expression-changed' : ''}`}
          key={block.id}
        >
          <div className="expression-heading">
            <h2>{block.title}</h2>
            <button
              className="source-link"
              onClick={() => onSources(block.sources)}
              aria-label={`${t('sources.open')}: ${block.title}`}
            >
              ↗ {t('sources.open')}
            </button>
          </div>
          <div className="provenance">
            <span>{t(block.origin)}</span>
            <span>{t(block.status)}</span>
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
                    <tr key={row.id}>
                      {row.cells.map((cell, i) => (
                        <td key={i}>
                          {cell}
                          {i === row.cells.length - 1 && (
                            <button
                              className="cite"
                              onClick={() => onSources(row.sources)}
                              aria-label={t('sources.open')}
                            >
                              ↗
                            </button>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {block.type === 'diagram' && (
            <RelationshipGraph block={block} artifact={artifact} onSources={onSources} />
          )}
          {block.type === 'timeline' && (
            <ol className="timeline">
              {block.items.map((item) => (
                <li key={item.id}>
                  <div className="time-label">{item.when}</div>
                  <div>
                    <strong>{item.label}</strong>
                    <p>{item.detail}</p>
                    <button className="source-link" onClick={() => onSources(item.sources)}>
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
                  <button className="source-link" onClick={() => onSources(v.sources)}>
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
