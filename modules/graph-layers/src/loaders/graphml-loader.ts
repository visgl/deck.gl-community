// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {XMLParser} from 'fast-xml-parser';

import type {GraphData, GraphEdgeData, GraphNodeData} from '../graph-data/graph-data';
import {createTabularGraphFromData} from '../graph/create-tabular-graph-from-data';
import type {TabularGraph} from '../graph/tabular-graph';

const XML_ATTRIBUTE_PREFIX = '@_';
const XML_TEXT_KEY = '#text';

type GraphMLDomain = 'all' | 'node' | 'edge' | 'graph';

type GraphMLAttributeType = 'boolean' | 'int' | 'long' | 'float' | 'double' | 'string';

type GraphMLKeyDefinition = {
  id: string;
  name: string;
  domain: GraphMLDomain;
  type: GraphMLAttributeType;
  defaultValue?: unknown;
};

type GraphMLObject = Record<string, unknown> & {
  [XML_TEXT_KEY]?: string;
};

const graphmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: XML_ATTRIBUTE_PREFIX,
  textNodeName: XML_TEXT_KEY,
  trimValues: true,
  parseAttributeValue: false,
  parseTagValue: false,
  allowBooleanAttributes: true
});

export type GraphMLInput = string | ArrayBuffer | Uint8Array;

export function loadGraphML(graphml: GraphMLInput): TabularGraph {
  const data = parseGraphML(graphml);
  return createTabularGraphFromData(data);
}

export function parseGraphML(graphml: GraphMLInput): GraphData {
  const xmlText = decodeGraphML(graphml);
  const document = graphmlParser.parse(xmlText) as GraphMLObject;
  const graphmlRoot = getGraphMLRoot(document);
  if (!graphmlRoot) {
    throw new Error('GraphML document does not contain a <graphml> element.');
  }

  const graphElement = getGraphElement(graphmlRoot);
  if (!graphElement) {
    throw new Error('GraphML document does not contain a <graph> element.');
  }

  const keyDefinitions = collectKeyDefinitions(graphmlRoot, graphElement);
  const defaultDirected = parseEdgeDefault(graphElement[`${XML_ATTRIBUTE_PREFIX}edgedefault`]);

  const nodes = normalizeArray(graphElement.node).map((node) => parseNode(node, keyDefinitions));
  const edges = normalizeArray(graphElement.edge).map((edge, index) =>
    parseEdge(edge, index, keyDefinitions, defaultDirected)
  );

  const filteredNodes = nodes.filter((node): node is GraphNodeData => Boolean(node));
  const filteredEdges = edges.filter((edge): edge is GraphEdgeData => Boolean(edge));

  return {
    type: 'graph-data',
    nodes: filteredNodes,
    edges: filteredEdges
  } satisfies GraphData;
}

function decodeGraphML(graphml: GraphMLInput): string {
  if (typeof graphml === 'string') {
    return graphml;
  }

  if (graphml instanceof Uint8Array) {
    return new TextDecoder().decode(graphml);
  }

  if (graphml instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(graphml));
  }

  throw new Error('Unsupported GraphML input. Expected a string, ArrayBuffer, or Uint8Array.');
}

function getGraphMLRoot(document: GraphMLObject): GraphMLObject | null {
  const root = document.graphml;
  if (isObject(root)) {
    return root;
  }

  const namespacedKey = Object.keys(document).find((key) => key.endsWith(':graphml'));
  if (namespacedKey) {
    const namespacedRoot = document[namespacedKey];
    if (isObject(namespacedRoot)) {
      return namespacedRoot;
    }
  }

  return null;
}

function getGraphElement(graphmlRoot: GraphMLObject): GraphMLObject | null {
  const graph = graphmlRoot.graph;
  if (!graph) {
    return null;
  }

  if (Array.isArray(graph)) {
    const firstGraph = graph.find((entry) => isObject(entry));
    return isObject(firstGraph) ? firstGraph : null;
  }

  return isObject(graph) ? graph : null;
}

function collectKeyDefinitions(
  graphmlRoot: GraphMLObject,
  graphElement: GraphMLObject
): Map<string, GraphMLKeyDefinition> {
  const keys = new Map<string, GraphMLKeyDefinition>();

  for (const candidate of [...normalizeArray(graphmlRoot.key), ...normalizeArray(graphElement.key)]) {
    if (isObject(candidate)) {
      const id = String(candidate[`${XML_ATTRIBUTE_PREFIX}id`] ?? '').trim();
      if (id) {
        const domain = normalizeDomain(candidate[`${XML_ATTRIBUTE_PREFIX}for`]);
        const name = String(candidate[`${XML_ATTRIBUTE_PREFIX}attr.name`] ?? id).trim();
        const type = normalizeType(candidate[`${XML_ATTRIBUTE_PREFIX}attr.type`]);
        const defaultNode = candidate.default ?? null;
        const defaultValue = defaultNode !== null ? castDataValue(defaultNode, type) : undefined;

        keys.set(id, {id, domain, name, type, defaultValue});
      }
    }
  }

  return keys;
}

function parseNode(
  node: unknown,
  keyDefinitions: Map<string, GraphMLKeyDefinition>
): GraphNodeData | null {
  if (!isObject(node)) {
    return null;
  }

  const id = node[`${XML_ATTRIBUTE_PREFIX}id`];
  if (typeof id !== 'string' && typeof id !== 'number') {
    return null;
  }

  const attributes = buildAttributeBag('node', node.data, keyDefinitions);

  const graphNode: GraphNodeData = {
    type: 'graph-node-data',
    id,
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined
  };

  const label = attributes.label;
  if (typeof label === 'string') {
    graphNode.label = label;
  }

  return graphNode;
}

function parseEdge(
  edge: unknown,
  index: number,
  keyDefinitions: Map<string, GraphMLKeyDefinition>,
  defaultDirected: boolean
): GraphEdgeData | null {
  if (!isObject(edge)) {
    return null;
  }

  const sourceId = edge[`${XML_ATTRIBUTE_PREFIX}source`];
  const targetId = edge[`${XML_ATTRIBUTE_PREFIX}target`];
  if (typeof sourceId !== 'string' && typeof sourceId !== 'number') {
    return null;
  }
  if (typeof targetId !== 'string' && typeof targetId !== 'number') {
    return null;
  }

  const rawId = edge[`${XML_ATTRIBUTE_PREFIX}id`];
  const id =
    typeof rawId === 'string' || typeof rawId === 'number' ? rawId : `edge-${index}`;
  const directed = parseDirected(edge[`${XML_ATTRIBUTE_PREFIX}directed`], defaultDirected);
  const attributes = buildAttributeBag('edge', edge.data, keyDefinitions);

  const graphEdge: GraphEdgeData = {
    type: 'graph-edge-data',
    id,
    sourceId,
    targetId,
    directed,
    attributes: Object.keys(attributes).length > 0 ? attributes : undefined
  };

  const label = attributes.label;
  if (typeof label === 'string') {
    graphEdge.label = label;
  }

  return graphEdge;
}

function buildAttributeBag(
  domain: GraphMLDomain,
  data: unknown,
  keyDefinitions: Map<string, GraphMLKeyDefinition>
): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};

  for (const key of keyDefinitions.values()) {
    if (key.domain === 'all' || key.domain === domain) {
      if (key.defaultValue !== undefined) {
        attributes[key.name] = key.defaultValue;
      }
    }
  }

  for (const entry of normalizeArray(data)) {
    assignAttributeFromDataEntry(entry, keyDefinitions, attributes);
  }

  return attributes;
}

function assignAttributeFromDataEntry(
  entry: unknown,
  keyDefinitions: Map<string, GraphMLKeyDefinition>,
  attributes: Record<string, unknown>
): void {
  if (!isObject(entry)) {
    return;
  }

  const keyId = entry[`${XML_ATTRIBUTE_PREFIX}key`];
  if (typeof keyId !== 'string') {
    return;
  }

  const definition = keyDefinitions.get(keyId);
  const attributeName = definition?.name ?? keyId;
  const value = castDataValue(entry, definition?.type ?? 'string');
  if (value !== undefined) {
    attributes[attributeName] = value;
  }
}

function castDataValue(value: unknown, type: GraphMLAttributeType): unknown {
  if (value === null || typeof value === 'undefined') {
    return undefined;
  }

  const text = extractTextContent(value);
  if (text === undefined) {
    return undefined;
  }

  if (type === 'boolean') {
    return parseBoolean(text);
  }
  if (type === 'int' || type === 'long') {
    const parsed = Number.parseInt(text, 10);
    return Number.isNaN(parsed) ? text : parsed;
  }
  if (type === 'float' || type === 'double') {
    const parsed = Number.parseFloat(text);
    return Number.isNaN(parsed) ? text : parsed;
  }
  return text;
}

function extractTextContent(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return extractTextContent(value[0]);
  }

  if (isObject(value)) {
    const text = value[XML_TEXT_KEY];
    if (typeof text === 'string') {
      return text;
    }

    const nonAttributeEntries = Object.entries(value).filter(
      ([key]) => !key.startsWith(XML_ATTRIBUTE_PREFIX)
    );
    if (nonAttributeEntries.length === 0) {
      return undefined;
    }
    return JSON.stringify(Object.fromEntries(nonAttributeEntries));
  }

  return undefined;
}

function normalizeArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function isObject(value: unknown): value is GraphMLObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeDomain(value: unknown): GraphMLDomain {
  if (typeof value !== 'string') {
    return 'all';
  }

  const lower = value.toLowerCase();
  if (lower === 'node' || lower === 'edge' || lower === 'graph' || lower === 'all') {
    return lower;
  }
  return 'all';
}

function normalizeType(value: unknown): GraphMLAttributeType {
  if (typeof value !== 'string') {
    return 'string';
  }

  const lower = value.toLowerCase();
  if (lower === 'boolean' || lower === 'int' || lower === 'long' || lower === 'float' || lower === 'double') {
    return lower;
  }
  return 'string';
}

function parseEdgeDefault(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  return value.toLowerCase() !== 'undirected';
}

function parseDirected(value: unknown, defaultDirected: boolean): boolean {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'directed') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'undirected') {
      return false;
    }
  }
  return defaultDirected;
}

function parseBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'y') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'n') {
    return false;
  }
  return Boolean(value);
}

