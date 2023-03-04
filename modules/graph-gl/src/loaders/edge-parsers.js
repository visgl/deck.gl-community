import {log} from '../utils/log';

export function basicEdgeParser(edge) {
  const {id, directed, sourceId, targetId} = edge;

  if (sourceId === undefined || targetId === undefined) {
    log.error('Invalid edge: sourceId or targetId is missing.')();
    return null;
  }

  return {
    id,
    directed: directed || false,
    sourceId,
    targetId
  };
}
