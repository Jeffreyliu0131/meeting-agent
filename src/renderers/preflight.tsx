import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Artifact, ArtifactRevision } from '../contracts/model';
import { ArtifactView } from './ArtifactView';
export function preflightMarkup(artifact: Artifact) {
  return renderToStaticMarkup(
    <ArtifactView artifact={artifact as ArtifactRevision} locale="en" onSources={() => {}} />,
  );
}
