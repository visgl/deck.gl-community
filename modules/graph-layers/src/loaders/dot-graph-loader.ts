// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {LoaderOptions, LoaderWithParser} from '@loaders.gl/loader-utils';

import {createGraphFromData} from '../graph/create-graph-from-data';
import type {Graph} from '../graph/graph';
import type {ArrowGraphData} from '../graph-data/arrow-graph-data';
import {ArrowGraphDataBuilder} from '../graph-data/arrow-graph-data-builder';

// __VERSION__ is injected by babel-plugin-version-inline
// @ts-ignore TS2304: Cannot find name '__VERSION__'.
const VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'latest';

type DotAttributeMap = Record<string, unknown>;

type ParsedNode = {
  id: string;
  attributes: DotAttributeMap;
  subgraphs: Set<string>;
};

type ParsedEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  directed: boolean;
  attributes: DotAttributeMap;
  subgraphs: string[];
};

type ParsedSubgraph = {
  id: string;
  attributes: DotAttributeMap;
  parentId?: string | null;
};

type DotParseResult = {
  id?: string;
  directed: boolean;
  strict: boolean;
  graphAttributes: DotAttributeMap;
  nodes: Map<string, ParsedNode>;
  edges: ParsedEdge[];
  subgraphs: Map<string, ParsedSubgraph>;
};

export type DotGraphLoaderOptions = {
  version?: number;
};

export type DotGraphLoaderContextOptions = LoaderOptions & {
  dot?: DotGraphLoaderOptions;
};

export type DotGraphLoaderMetadata = {
  id?: string;
  directed: boolean;
  strict: boolean;
  attributes: DotAttributeMap;
  subgraphs: ParsedSubgraph[];
};

export type DotGraphLoaderResult = {
  graph: Graph;
  data: ArrowGraphData;
  metadata: DotGraphLoaderMetadata;
};

export const DOTGraphLoader = {
  dataType: null as unknown as DotGraphLoaderResult,
  batchType: null as never,

  name: 'DOT Graph',
  id: 'dot-graph',
  module: 'graph-layers',
  version: VERSION,
  worker: false,
  extensions: ['dot'],
  mimeTypes: ['text/vnd.graphviz', 'text/x-graphviz', 'application/vnd.graphviz'],
  text: true,
  options: {
    dot: {
      version: 0
    }
  },
  parse: (arrayBuffer: ArrayBuffer, options?: DotGraphLoaderContextOptions) => {
    const text = new TextDecoder().decode(arrayBuffer);
    return Promise.resolve(DOTGraphLoader.parseTextSync(text, options));
  },
  parseTextSync: (text: string, options?: DotGraphLoaderContextOptions) => {
    const parseOptions = {...DOTGraphLoader.options.dot, ...options?.dot};
    return loadDotGraph(text, parseOptions);
  }
} as const satisfies LoaderWithParser<DotGraphLoaderResult, never, DotGraphLoaderContextOptions>;

export function loadDotGraph(dot: string, options: DotGraphLoaderOptions = {}): DotGraphLoaderResult {
  const parsed = parseDot(dot);
  const {data, metadata} = buildArrowGraphData(parsed, options);
  const graph = createGraphFromData(data);
  return {graph, data, metadata};
}

export function parseDotToArrowGraphData(
  dot: string,
  options: DotGraphLoaderOptions = {}
): {data: ArrowGraphData; metadata: DotGraphLoaderMetadata} {
  const parsed = parseDot(dot);
  return buildArrowGraphData(parsed, options);
}

function buildArrowGraphData(
  parsed: DotParseResult,
  options: DotGraphLoaderOptions
): {data: ArrowGraphData; metadata: DotGraphLoaderMetadata} {
  const builder = new ArrowGraphDataBuilder({version: options.version});

  const subgraphDescriptors = new Map<string, ParsedSubgraph>();
  for (const [id, subgraph] of parsed.subgraphs.entries()) {
    subgraphDescriptors.set(id, {
      id,
      attributes: {...subgraph.attributes},
      parentId: subgraph.parentId
    });
  }

  for (const node of parsed.nodes.values()) {
    const attributes: DotAttributeMap = {...node.attributes};
    if (node.subgraphs.size > 0) {
      attributes.subgraphs = Array.from(node.subgraphs, (id) => describeSubgraph(id, subgraphDescriptors));
    }
    builder.addNode({
      id: node.id,
      attributes
    });
  }

  parsed.edges.forEach((edge) => {
    const attributes: DotAttributeMap = {...edge.attributes};
    if (edge.subgraphs.length > 0) {
      attributes.subgraphs = edge.subgraphs.map((id) => describeSubgraph(id, subgraphDescriptors));
    }
    builder.addEdge({
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      directed: edge.directed,
      attributes
    });
  });

  const metadata: DotGraphLoaderMetadata = {
    id: parsed.id,
    directed: parsed.directed,
    strict: parsed.strict,
    attributes: {...parsed.graphAttributes},
    subgraphs: Array.from(parsed.subgraphs.values(), (subgraph) => ({
      id: subgraph.id,
      attributes: {...subgraph.attributes},
      parentId: subgraph.parentId
    }))
  };

  return {data: builder.finish(), metadata};
}

function describeSubgraph(
  id: string,
  descriptors: Map<string, ParsedSubgraph>
): {id: string; attributes: DotAttributeMap; parentId?: string | null} {
  const subgraph = descriptors.get(id);
  if (!subgraph) {
    return {id, attributes: {}};
  }
  return {
    id,
    attributes: {...subgraph.attributes},
    parentId: subgraph.parentId
  };
}

type TokenType =
  | 'identifier'
  | 'string'
  | 'html'
  | 'arrow'
  | 'lbrace'
  | 'rbrace'
  | 'lbrack'
  | 'rbrack'
  | 'equals'
  | 'comma'
  | 'semicolon';

type Token = {
  type: TokenType;
  value: string;
};

type ScopeContext = {
  id?: string;
  nodeDefaults: DotAttributeMap;
  edgeDefaults: DotAttributeMap;
  graphAttributes: DotAttributeMap;
};

class DotParser {
  private readonly tokens: Token[];
  private position = 0;
  private readonly result: DotParseResult = {
    directed: false,
    strict: false,
    graphAttributes: {},
    nodes: new Map(),
    edges: [],
    subgraphs: new Map()
  };

  private readonly scopes: ScopeContext[] = [
    {nodeDefaults: {}, edgeDefaults: {}, graphAttributes: {}}
  ];

  private subgraphCounter = 0;
  private edgeCounter = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): DotParseResult {
    this.parseGraph();
    return this.result;
  }

  private parseGraph(): void {
    const strictToken = this.peek();
    if (strictToken && isKeyword(strictToken, 'strict')) {
      this.consume();
      this.result.strict = true;
    }

    const typeToken = this.peek();
    if (!typeToken || !isGraphType(typeToken)) {
      throw new Error('DOT graph must start with graph or digraph keyword.');
    }
    this.consume();
    this.result.directed = isKeyword(typeToken, 'digraph');

    const idToken = this.peek();
    if (idToken && isIdentifierLike(idToken)) {
      if (!isStructuralToken(idToken)) {
        this.result.id = parseIdentifierValue(this.consume());
      }
    }

    this.expect('lbrace');
    while (!this.match('rbrace')) {
      if (!this.parseStatement()) {
        break;
      }
    }
    this.result.graphAttributes = {...this.scopes[0].graphAttributes};
  }

  private parseStatement(): boolean {
    if (this.consumeSemicolonIfPresent()) {
      return true;
    }

    const token = this.peek();
    if (!token) {
      return false;
    }

    if (this.tryParseSubgraphStatement(token)) {
      return true;
    }

    if (this.tryParseKeywordStatement(token)) {
      return true;
    }

    if (this.tryParseAssignmentStatement(token)) {
      return true;
    }

    if (isIdentifierLike(token)) {
      this.parseNodeOrEdgeStatement();
      this.consumeOptionalSemicolon();
      return true;
    }

    throw new Error(`Unexpected token: ${token.value}`);
  }

  private consumeSemicolonIfPresent(): boolean {
    const next = this.peek();
    if (next?.type === 'semicolon') {
      this.consume();
      return true;
    }
    return false;
  }

  private tryParseSubgraphStatement(token: Token): boolean {
    if (token.type !== 'lbrace' && !isKeyword(token, 'subgraph')) {
      return false;
    }
    this.parseSubgraph();
    return true;
  }

  private tryParseKeywordStatement(token: Token): boolean {
    if (!(isKeyword(token, 'graph') || isKeyword(token, 'node') || isKeyword(token, 'edge'))) {
      return false;
    }

    this.consume();
    const attrs = this.parseAttributeList();

    if (isKeyword(token, 'graph')) {
      Object.assign(this.currentScope().graphAttributes, attrs);
    } else if (isKeyword(token, 'node')) {
      Object.assign(this.currentScope().nodeDefaults, attrs);
    } else {
      Object.assign(this.currentScope().edgeDefaults, attrs);
    }

    this.consumeOptionalSemicolon();
    return true;
  }

  private tryParseAssignmentStatement(token: Token): boolean {
    if (!isIdentifierLike(token)) {
      return false;
    }
    const next = this.peek(1);
    if (next?.type !== 'equals') {
      return false;
    }

    const key = parseIdentifierValue(this.consume());
    this.consume();
    const valueToken = this.consume();
    const value = parseAttributeValue(valueToken);
    this.currentScope().graphAttributes[key] = value;
    this.consumeOptionalSemicolon();
    return true;
  }

  private parseNodeOrEdgeStatement(): void {
    const first = parseIdentifierValue(this.consume());
    const references: string[] = [first];
    const operators: string[] = [];

    let operatorToken = this.match('arrow');
    while (operatorToken) {
      operators.push(operatorToken.value);
      const referenceToken = this.consume();
      if (!isIdentifierLike(referenceToken)) {
        throw new Error('Expected node identifier in edge statement.');
      }
      references.push(parseIdentifierValue(referenceToken));
      operatorToken = this.match('arrow');
    }

    if (operators.length === 0) {
      const attrs = this.parseAttributeList();
      this.addNode(first, attrs);
      return;
    }

    const attrs = this.parseAttributeList();
    this.addEdgeChain(references, operators, attrs);
  }

  private addNode(id: string, attrs: DotAttributeMap): void {
    const membership = this.getCurrentSubgraphChain();
    const node = this.ensureNode(id, membership);
    node.attributes = {...node.attributes, ...attrs};
  }

  private addEdgeChain(nodes: string[], operators: string[], attrs: DotAttributeMap): void {
    const membership = this.getCurrentSubgraphChain();
    const defaults = this.currentScope().edgeDefaults;
    const attributes = {...defaults, ...attrs};

    for (let index = 0; index < nodes.length - 1; index++) {
      const sourceId = nodes[index];
      const targetId = nodes[index + 1];
      const operator = operators[index];
      const directed = operator === '->';

      const edgeId = deriveEdgeId(attributes, sourceId, targetId, ++this.edgeCounter);
      const edgeAttributes = {...attributes};
      this.ensureNode(sourceId, membership);
      this.ensureNode(targetId, membership);

      const directedOverride = deriveDirectedFlag(edgeAttributes, directed);
      this.result.edges.push({
        id: edgeId,
        sourceId,
        targetId,
        directed: directedOverride,
        attributes: edgeAttributes,
        subgraphs: membership
      });
    }
  }

  private parseSubgraph(): void {
    let idToken = this.peek();
    let subgraphId: string;

    if (idToken && isKeyword(idToken, 'subgraph')) {
      this.consume();
      idToken = this.peek();
    }

    if (idToken && isIdentifierLike(idToken) && idToken.type !== 'lbrace') {
      subgraphId = parseIdentifierValue(this.consume());
    } else {
      subgraphId = `subgraph_${++this.subgraphCounter}`;
    }

    this.expect('lbrace');
    const parentId = this.findCurrentSubgraphId();
    const context: ScopeContext = {
      id: subgraphId,
      nodeDefaults: {...this.currentScope().nodeDefaults},
      edgeDefaults: {...this.currentScope().edgeDefaults},
      graphAttributes: {}
    };
    this.scopes.push(context);
    this.result.subgraphs.set(subgraphId, {id: subgraphId, attributes: context.graphAttributes, parentId});

    let shouldContinue = true;
    while (shouldContinue) {
      if (this.match('rbrace')) {
        break;
      }
      shouldContinue = this.parseStatement();
    }

    this.scopes.pop();
  }

  private parseAttributeList(): DotAttributeMap {
    const attributes: DotAttributeMap = {};
    while (this.match('lbrack')) {
      while (!this.match('rbrack')) {
        const keyToken = this.consume();
        if (!isIdentifierLike(keyToken)) {
          throw new Error('Expected attribute name.');
        }
        const key = parseIdentifierValue(keyToken);
        let value: unknown = true;
        if (this.match('equals')) {
          const valueToken = this.consume();
          value = parseAttributeValue(valueToken);
        }
        attributes[key] = value;
        if (this.peek()?.type === 'comma' || this.peek()?.type === 'semicolon') {
          this.consume();
        }
      }
    }
    return attributes;
  }

  private ensureNode(id: string, membership: string[]): ParsedNode {
    let node = this.result.nodes.get(id);
    if (!node) {
      const defaults = this.currentScope().nodeDefaults;
      node = {id, attributes: {...defaults}, subgraphs: new Set()};
      this.result.nodes.set(id, node);
    }
    if (node) {
      membership.forEach((subgraphId) => node.subgraphs.add(subgraphId));
    }
    return node;
  }

  private getCurrentSubgraphChain(): string[] {
    const chain: string[] = [];
    for (const scope of this.scopes) {
      if (scope.id) {
        chain.push(scope.id);
      }
    }
    return chain;
  }

  private findCurrentSubgraphId(): string | undefined {
    for (let index = this.scopes.length - 1; index >= 0; index--) {
      const scope = this.scopes[index];
      if (scope.id) {
        return scope.id;
      }
    }
    return undefined;
  }

  private currentScope(): ScopeContext {
    return this.scopes[this.scopes.length - 1];
  }

  private consumeOptionalSemicolon(): void {
    const next = this.peek();
    if (next?.type === 'semicolon') {
      this.consume();
    }
  }

  private expect(type: TokenType): Token {
    const token = this.consume();
    if (!token || token.type !== type) {
      throw new Error(`Expected token ${type}.`);
    }
    return token;
  }

  private consume(): Token {
    const token = this.tokens[this.position];
    if (!token) {
      throw new Error('Unexpected end of DOT input.');
    }
    this.position++;
    return token;
  }

  private match(type: TokenType): Token | null {
    const token = this.peek();
    if (token && token.type === type) {
      this.position++;
      return token;
    }
    return null;
  }

  private peek(offset = 0): Token | null {
    return this.tokens[this.position + offset] ?? null;
  }
}

function parseDot(input: string): DotParseResult {
  const parser = new DotParser(tokenize(input));
  return parser.parse();
}

const IDENTIFIER_TERMINATORS = new Set(['{', '}', '[', ']', '=', ';', ',', '"', '<', '#']);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const {token, nextIndex} = readNextToken(input, index);
    if (nextIndex <= index) {
      throw new Error(`Tokenizer did not advance at position ${index}.`);
    }
    if (token) {
      tokens.push(token);
    }
    index = nextIndex;
  }

  return tokens;
}

function readNextToken(input: string, index: number): {token: Token | null; nextIndex: number} {
  if (index >= input.length) {
    return {token: null, nextIndex: input.length};
  }

  const char = input[index];

  if (isWhitespace(char)) {
    return {token: null, nextIndex: index + 1};
  }

  const commentEnd = skipComment(input, index);
  if (commentEnd !== null) {
    return {token: null, nextIndex: commentEnd};
  }

  const arrowToken = readArrowToken(input, index);
  if (arrowToken) {
    return arrowToken;
  }

  const punctuation = readPunctuationToken(char);
  if (punctuation) {
    return {token: punctuation, nextIndex: index + 1};
  }

  if (char === '"') {
    const {value, nextIndex} = readQuotedString(input, index + 1);
    return {token: {type: 'string', value}, nextIndex};
  }

  if (char === '<') {
    const {value, nextIndex} = readHtmlString(input, index + 1);
    return {token: {type: 'html', value}, nextIndex};
  }

  const identifier = readIdentifier(input, index);
  if (identifier.value) {
    return {
      token: {type: 'identifier', value: identifier.value},
      nextIndex: identifier.nextIndex
    };
  }

  throw new Error(`Unexpected token at position ${index}.`);
}

function skipComment(input: string, index: number): number | null {
  const char = input[index];
  if (char === '/') {
    const next = input[index + 1];
    if (next === '/') {
      return skipLineComment(input, index + 2);
    }
    if (next === '*') {
      return skipBlockComment(input, index + 2);
    }
    return null;
  }

  if (char === '#') {
    return skipLineComment(input, index + 1);
  }

  return null;
}

function skipLineComment(input: string, startIndex: number): number {
  let cursor = startIndex;
  while (cursor < input.length && !isLineBreak(input[cursor])) {
    cursor++;
  }
  return cursor;
}

function skipBlockComment(input: string, startIndex: number): number {
  let cursor = startIndex;
  while (cursor < input.length) {
    if (input[cursor] === '*' && input[cursor + 1] === '/') {
      return cursor + 2;
    }
    cursor++;
  }
  throw new Error('Unterminated block comment in DOT source.');
}

function readArrowToken(input: string, index: number): {token: Token; nextIndex: number} | null {
  const next = input[index + 1];
  if (input[index] === '-' && next === '-') {
    return {token: {type: 'arrow', value: '--'}, nextIndex: index + 2};
  }
  if (input[index] === '-' && next === '>') {
    return {token: {type: 'arrow', value: '->'}, nextIndex: index + 2};
  }
  return null;
}

function readPunctuationToken(char: string): Token | null {
  switch (char) {
    case '{':
      return {type: 'lbrace', value: char};
    case '}':
      return {type: 'rbrace', value: char};
    case '[':
      return {type: 'lbrack', value: char};
    case ']':
      return {type: 'rbrack', value: char};
    case '=':
      return {type: 'equals', value: char};
    case ',':
      return {type: 'comma', value: char};
    case ';':
      return {type: 'semicolon', value: char};
    default:
      return null;
  }
}

function readQuotedString(input: string, startIndex: number): {value: string; nextIndex: number} {
  let value = '';
  let index = startIndex;
  while (index < input.length) {
    const char = input[index];
    if (char === '"') {
      return {value, nextIndex: index + 1};
    }
    if (char === '\\') {
      const escape = readEscapedCharacter(input, index + 1);
      value += escape.value;
      index = escape.nextIndex;
    } else {
      value += char;
      index++;
    }
  }
  throw new Error('Unterminated string literal in DOT source.');
}

function readEscapedCharacter(input: string, startIndex: number): {value: string; nextIndex: number} {
  const next = input[startIndex];
  switch (next) {
    case 'n':
    case 'l':
    case 'L':
      return {value: '\n', nextIndex: startIndex + 1};
    case 't':
      return {value: '\t', nextIndex: startIndex + 1};
    case 'r':
      return {value: '\r', nextIndex: startIndex + 1};
    case '"':
      return {value: '"', nextIndex: startIndex + 1};
    case '\\':
      return {value: '\\', nextIndex: startIndex + 1};
    default: {
      if (typeof next === 'undefined') {
        throw new Error('Unterminated escape sequence in DOT source.');
      }
      return {value: next, nextIndex: startIndex + 1};
    }
  }
}

function readHtmlString(input: string, startIndex: number): {value: string; nextIndex: number} {
  let value = '<';
  let depth = 1;
  let index = startIndex;
  while (index < input.length) {
    const char = input[index];
    value += char;
    if (char === '<') {
      depth++;
    } else if (char === '>') {
      depth--;
      if (depth === 0) {
        return {value, nextIndex: index + 1};
      }
    }
    index++;
  }
  throw new Error('Unterminated HTML-like string literal in DOT source.');
}

function readIdentifier(input: string, startIndex: number): {value: string; nextIndex: number} {
  let index = startIndex;
  let value = '';
  while (index < input.length && !isIdentifierTerminator(input, index)) {
    value += input[index];
    index++;
  }
  return {value, nextIndex: index};
}

function isIdentifierTerminator(input: string, index: number): boolean {
  const char = input[index];
  if (isWhitespace(char) || IDENTIFIER_TERMINATORS.has(char)) {
    return true;
  }
  if (isArrowOperatorStart(input, index)) {
    return true;
  }
  if (isCommentStart(input, index)) {
    return true;
  }
  return false;
}

function isArrowOperatorStart(input: string, index: number): boolean {
  if (input[index] !== '-') {
    return false;
  }
  const next = input[index + 1];
  return next === '-' || next === '>';
}

function isCommentStart(input: string, index: number): boolean {
  if (input[index] !== '/') {
    return false;
  }
  const next = input[index + 1];
  return next === '/' || next === '*';
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t' || char === '\f';
}

function isLineBreak(char: string): boolean {
  return char === '\n' || char === '\r';
}

function isKeyword(token: Token, keyword: string): boolean {
  return token.type === 'identifier' && token.value.toLowerCase() === keyword.toLowerCase();
}

function isGraphType(token: Token): boolean {
  return isKeyword(token, 'graph') || isKeyword(token, 'digraph');
}

function isIdentifierLike(token: Token): boolean {
  return token.type === 'identifier' || token.type === 'string' || token.type === 'html';
}

function isStructuralToken(token: Token): boolean {
  return token.type === 'lbrace' || token.type === 'rbrace' || token.type === 'lbrack' || token.type === 'rbrack';
}

function parseIdentifierValue(token: Token): string {
  return token.value;
}

function parseAttributeValue(token: Token): unknown {
  if (token.type === 'string' || token.type === 'html') {
    return token.value;
  }
  if (token.type === 'identifier') {
    const numeric = Number(token.value);
    if (!Number.isNaN(numeric)) {
      return numeric;
    }
    return token.value;
  }
  throw new Error('Invalid attribute value in DOT input.');
}

function deriveEdgeId(
  attributes: DotAttributeMap,
  sourceId: string,
  targetId: string,
  counter: number
): string {
  const candidate = attributes.id ?? attributes.Id ?? attributes.ID;
  if (typeof candidate === 'string' || typeof candidate === 'number') {
    return String(candidate);
  }
  return `${String(sourceId)}-${String(targetId)}-${counter}`;
}

function deriveDirectedFlag(attributes: DotAttributeMap, defaultDirected: boolean): boolean {
  const candidate = attributes.directed;
  if (typeof candidate === 'boolean') {
    return candidate;
  }

  const dirAttr = attributes.dir;
  if (typeof dirAttr === 'string') {
    const normalized = dirAttr.toLowerCase();
    if (normalized === 'none') {
      return false;
    }
    return true;
  }

  return defaultDirected;
}
