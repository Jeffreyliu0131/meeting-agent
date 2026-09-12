import type { CollectionDigest } from '../domain/collection-digest';

/**
 * The exact object serialised into a model request.
 *
 * `aliasMap` and `aliasRefs` are deliberately absent: they are host bookkeeping
 * that carries real meeting and object ids, and the model must never see them.
 * The rest is already alias-only, so this function is the single place where
 * "what the model may know about a collection" is defined.
 */
export function collectionPayload(digest: CollectionDigest) {
  return {
    collection: digest.collection,
    meetings: digest.meetings.map(({ alias, label, date, state, gaps }) => ({
      alias,
      label,
      date,
      state,
      gaps,
    })),
    // `alias` is stripped: the model cites a decision through its sources, and
    // handing it an object-shaped alias invites INVALID_OBJECT.
    decisions: digest.decisions.map(({ alias, ...rest }) => rest),
    open: digest.open,
    disputes: digest.disputes,
    omitted: digest.omitted,
  };
}
