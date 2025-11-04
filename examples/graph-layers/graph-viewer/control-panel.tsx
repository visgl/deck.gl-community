// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import type {ReactNode} from 'react';
import type {GraphLayerProps} from '@deck.gl-community/graph-layers';
import {D3DagLayout} from '@deck.gl-community/graph-layers';

export type LayoutType =
  | 'd3-force-layout'
  | 'gpu-force-layout'
  | 'simple-layout'
  | 'radial-layout'
  | 'hive-plot-layout'
  | 'force-multi-graph-layout'
  | 'd3-dag-layout';

export type ExampleStyles = NonNullable<GraphLayerProps['stylesheet']>;

export type ExampleDefinition = {
  name: string;
  description: string;
  data: () => {nodes: unknown[]; edges: unknown[]};
  /** First listed layout is the default */
  layouts: LayoutType[];
  layoutDescriptions: Record<LayoutType, string>;
  style: ExampleStyles;
  getLayoutOptions?: (
    layout: LayoutType,
    data: {nodes: unknown[]; edges: unknown[]}
  ) => Record<string, unknown> | undefined;
};

type ControlPanelProps = {
  examples: ExampleDefinition[];
  defaultExample?: ExampleDefinition;
  onExampleChange: (example: ExampleDefinition, layout: LayoutType) => void;
  children?: ReactNode;
  layoutOptions?: Record<string, unknown>;
  onLayoutOptionsApply?: (layout: LayoutType, options: Record<string, unknown>) => void;
};

const LAYOUT_LABELS: Record<LayoutType, string> = {
  'd3-force-layout': 'D3 Force Layout',
  'gpu-force-layout': 'GPU Force Layout',
  'simple-layout': 'Simple Layout',
  'radial-layout': 'Radial Layout',
  'hive-plot-layout': 'Hive Plot Layout',
  'force-multi-graph-layout': 'Force Multi-Graph Layout',
  'd3-dag-layout': 'D3 DAG Layout',
};

type DagLayoutFormState = {
  layout: 'sugiyama' | 'grid' | 'zherebko';
  layering: 'simplex' | 'longestPath' | 'topological';
  decross: 'twoLayer' | 'opt' | 'dfs';
  coord: 'simplex' | 'greedy' | 'quad' | 'center' | 'topological';
  orientation: 'TB' | 'BT' | 'LR' | 'RL';
  dagBuilder: 'graph' | 'connect' | 'stratify';
  centerX: boolean;
  centerY: boolean;
  nodeWidth: number;
  nodeHeight: number;
  gapX: number;
  gapY: number;
  separationX: number;
  separationY: number;
};

type DagSelectKey = 'layout' | 'layering' | 'decross' | 'coord' | 'orientation' | 'dagBuilder';
type DagNumericKey =
  | 'nodeWidth'
  | 'nodeHeight'
  | 'gapX'
  | 'gapY'
  | 'separationX'
  | 'separationY';

const DAG_DEFAULT_OPTIONS = D3DagLayout.defaultOptions;

function normalizeTuple(value: unknown, fallback: readonly [number, number]): readonly [number, number] {
  if (Array.isArray(value) && value.length >= 2) {
    const [first, second] = value;
    const firstNumber = Number(first);
    const secondNumber = Number(second);

    if (Number.isFinite(firstNumber) && Number.isFinite(secondNumber)) {
      return [firstNumber, secondNumber];
    }
  }

  return fallback;
}

function createDagFormState(options?: Record<string, unknown>): DagLayoutFormState {
  const merged = {...DAG_DEFAULT_OPTIONS, ...(options ?? {})};
  const center = merged.center;
  const centerX =
    typeof center === 'boolean'
      ? center
      : typeof center === 'object' && center !== null && 'x' in center
      ? Boolean((center as {x?: boolean}).x)
      : true;
  const centerY =
    typeof center === 'boolean'
      ? center
      : typeof center === 'object' && center !== null && 'y' in center
      ? Boolean((center as {y?: boolean}).y)
      : true;

  const nodeSize = normalizeTuple(merged.nodeSize, DAG_DEFAULT_OPTIONS.nodeSize);
  const gap = normalizeTuple(merged.gap, DAG_DEFAULT_OPTIONS.gap);
  const separation = normalizeTuple(merged.separation, DAG_DEFAULT_OPTIONS.separation);

  return {
    layout: (merged.layout ?? DAG_DEFAULT_OPTIONS.layout) as DagLayoutFormState['layout'],
    layering: (merged.layering ?? DAG_DEFAULT_OPTIONS.layering) as DagLayoutFormState['layering'],
    decross: (merged.decross ?? DAG_DEFAULT_OPTIONS.decross) as DagLayoutFormState['decross'],
    coord: (merged.coord ?? DAG_DEFAULT_OPTIONS.coord) as DagLayoutFormState['coord'],
    orientation: (merged.orientation ?? DAG_DEFAULT_OPTIONS.orientation) as DagLayoutFormState['orientation'],
    dagBuilder: (merged.dagBuilder ?? DAG_DEFAULT_OPTIONS.dagBuilder) as DagLayoutFormState['dagBuilder'],
    centerX,
    centerY,
    nodeWidth: nodeSize[0],
    nodeHeight: nodeSize[1],
    gapX: gap[0],
    gapY: gap[1],
    separationX: separation[0],
    separationY: separation[1]
  };
}

function dagStatesEqual(a: DagLayoutFormState, b: DagLayoutFormState): boolean {
  return (
    a.layout === b.layout &&
    a.layering === b.layering &&
    a.decross === b.decross &&
    a.coord === b.coord &&
    a.orientation === b.orientation &&
    a.dagBuilder === b.dagBuilder &&
    a.centerX === b.centerX &&
    a.centerY === b.centerY &&
    a.nodeWidth === b.nodeWidth &&
    a.nodeHeight === b.nodeHeight &&
    a.gapX === b.gapX &&
    a.gapY === b.gapY &&
    a.separationX === b.separationX &&
    a.separationY === b.separationY
  );
}

function mapDagFormStateToOptions(state: DagLayoutFormState): Record<string, unknown> {
  const centerOption =
    state.centerX === state.centerY
      ? state.centerX
      : ({
          x: state.centerX,
          y: state.centerY
        } as const);

  return {
    layout: state.layout,
    layering: state.layering,
    decross: state.decross,
    coord: state.coord,
    orientation: state.orientation,
    dagBuilder: state.dagBuilder,
    center: centerOption,
    nodeSize: [state.nodeWidth, state.nodeHeight],
    gap: [state.gapX, state.gapY],
    separation: [state.separationX, state.separationY]
  };
}

function DagLayoutOptionsSection({
  appliedOptions,
  onApply
}: {
  appliedOptions?: Record<string, unknown>;
  onApply?: (options: Record<string, unknown>) => void;
}) {
  const appliedState = useMemo(() => createDagFormState(appliedOptions), [appliedOptions]);
  const [formState, setFormState] = useState<DagLayoutFormState>(appliedState);

  useEffect(() => {
    setFormState(createDagFormState(appliedOptions));
  }, [appliedOptions]);

  const handleSelectChange = useCallback(
    <K extends DagSelectKey>(key: K) => {
      return (event: React.ChangeEvent<HTMLSelectElement>) => {
        const value = event.target.value as DagLayoutFormState[K];
        setFormState((current) => ({
          ...current,
          [key]: value
        }));
      };
    },
    []
  );

  const handleNumberChange = useCallback(
    <K extends DagNumericKey>(key: K) => {
      return (event: React.ChangeEvent<HTMLInputElement>) => {
        const numericValue = Number(event.target.value);
        setFormState((current) => ({
          ...current,
          [key]: Number.isFinite(numericValue)
            ? (numericValue as DagLayoutFormState[K])
            : current[key]
        }));
      };
    },
    []
  );

  const handleCheckboxChange = useCallback(<K extends 'centerX' | 'centerY'>(key: K) => {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
      setFormState((current) => ({
        ...current,
        [key]: event.target.checked
      }));
    };
  }, []);

  const isDirty = useMemo(() => !dagStatesEqual(formState, appliedState), [formState, appliedState]);

  const handleApply = useCallback(() => {
    if (!onApply) {
      return;
    }
    onApply(mapDagFormStateToOptions(formState));
  }, [formState, onApply]);

  const fieldLabelStyle: React.CSSProperties = useMemo(
    () => ({
      display: 'flex',
      flexDirection: 'column',
      gap: '0.25rem',
      fontSize: '0.8125rem'
    }),
    []
  );

  const selectStyle: React.CSSProperties = useMemo(
    () => ({
      fontFamily: 'inherit',
      fontSize: '0.8125rem',
      padding: '0.375rem 0.5rem',
      borderRadius: '0.375rem',
      border: '1px solid #cbd5f5',
      backgroundColor: '#ffffff',
      color: '#0f172a'
    }),
    []
  );

  const inputStyle: React.CSSProperties = useMemo(
    () => ({
      fontFamily: 'inherit',
      fontSize: '0.8125rem',
      padding: '0.375rem 0.5rem',
      borderRadius: '0.375rem',
      border: '1px solid #cbd5f5',
      color: '#0f172a',
      backgroundColor: '#ffffff'
    }),
    []
  );

  return (
    <section
      style={{
        borderTop: '1px solid #e2e8f0',
        paddingTop: '0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        fontSize: '0.875rem',
        color: '#334155'
      }}
    >
      <div style={{display: 'flex', flexDirection: 'column', gap: '0.75rem'}}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '0.75rem'
          }}
        >
          <label style={fieldLabelStyle}>
            Layout operator
            <select value={formState.layout} onChange={handleSelectChange('layout')} style={selectStyle}>
              <option value="sugiyama">Sugiyama</option>
              <option value="grid">Grid</option>
              <option value="zherebko">Zherebko</option>
            </select>
          </label>
          <label style={fieldLabelStyle}>
            Layering
            <select value={formState.layering} onChange={handleSelectChange('layering')} style={selectStyle}>
              <option value="topological">Topological</option>
              <option value="longestPath">Longest path</option>
              <option value="simplex">Simplex</option>
            </select>
          </label>
          <label style={fieldLabelStyle}>
            Decross
            <select value={formState.decross} onChange={handleSelectChange('decross')} style={selectStyle}>
              <option value="twoLayer">Two layer</option>
              <option value="opt">Opt</option>
              <option value="dfs">DFS</option>
            </select>
          </label>
          <label style={fieldLabelStyle}>
            Coordinate assignment
            <select value={formState.coord} onChange={handleSelectChange('coord')} style={selectStyle}>
              <option value="greedy">Greedy</option>
              <option value="simplex">Simplex</option>
              <option value="quad">Quad</option>
              <option value="center">Center</option>
              <option value="topological">Topological</option>
            </select>
          </label>
          <label style={fieldLabelStyle}>
            Orientation
            <select
              value={formState.orientation}
              onChange={handleSelectChange('orientation')}
              style={selectStyle}
            >
              <option value="TB">Top to bottom</option>
              <option value="BT">Bottom to top</option>
              <option value="LR">Left to right</option>
              <option value="RL">Right to left</option>
            </select>
          </label>
          <label style={fieldLabelStyle}>
            DAG builder
            <select value={formState.dagBuilder} onChange={handleSelectChange('dagBuilder')} style={selectStyle}>
              <option value="graph">Graph</option>
              <option value="connect">Connect</option>
              <option value="stratify">Stratify</option>
            </select>
          </label>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '0.75rem'
          }}
        >
          <label style={fieldLabelStyle}>
            Node width
            <input
              type="number"
              value={formState.nodeWidth}
              onChange={handleNumberChange('nodeWidth')}
              style={inputStyle}
            />
          </label>
          <label style={fieldLabelStyle}>
            Node height
            <input
              type="number"
              value={formState.nodeHeight}
              onChange={handleNumberChange('nodeHeight')}
              style={inputStyle}
            />
          </label>
          <label style={fieldLabelStyle}>
            Gap X
            <input
              type="number"
              value={formState.gapX}
              onChange={handleNumberChange('gapX')}
              style={inputStyle}
            />
          </label>
          <label style={fieldLabelStyle}>
            Gap Y
            <input
              type="number"
              value={formState.gapY}
              onChange={handleNumberChange('gapY')}
              style={inputStyle}
            />
          </label>
          <label style={fieldLabelStyle}>
            Separation X
            <input
              type="number"
              value={formState.separationX}
              onChange={handleNumberChange('separationX')}
              style={inputStyle}
            />
          </label>
          <label style={fieldLabelStyle}>
            Separation Y
            <input
              type="number"
              value={formState.separationY}
              onChange={handleNumberChange('separationY')}
              style={inputStyle}
            />
          </label>
        </div>
        <div style={{display: 'flex', gap: '1rem'}}>
          <label style={{display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem'}}>
            <input
              type="checkbox"
              checked={formState.centerX}
              onChange={handleCheckboxChange('centerX')}
              style={{width: '1rem', height: '1rem'}}
            />
            Center horizontally
          </label>
          <label style={{display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem'}}>
            <input
              type="checkbox"
              checked={formState.centerY}
              onChange={handleCheckboxChange('centerY')}
              style={{width: '1rem', height: '1rem'}}
            />
            Center vertically
          </label>
        </div>
      </div>
      <div style={{display: 'flex', justifyContent: 'flex-end'}}>
        <button
          type="button"
          onClick={handleApply}
          disabled={!isDirty}
          style={{
            border: '1px solid #2563eb',
            background: isDirty ? '#2563eb' : '#94a3b8',
            color: '#ffffff',
            borderRadius: '0.5rem',
            padding: '0.375rem 0.75rem',
            fontSize: '0.8125rem',
            fontWeight: 600,
            cursor: isDirty ? 'pointer' : 'not-allowed',
            transition: 'background 120ms ease-in-out'
          }}
        >
          Apply layout options
        </button>
      </div>
    </section>
  );
}

function LayoutOptionsSection({
  layout,
  appliedOptions,
  onApply
}: {
  layout?: LayoutType;
  appliedOptions?: Record<string, unknown>;
  onApply?: (layout: LayoutType, options: Record<string, unknown>) => void;
}) {
  if (!layout) {
    return null;
  }

  if (layout === 'd3-dag-layout') {
    return (
      <div>
        <h3 style={{margin: '0 0 0.5rem', fontSize: '0.875rem', fontWeight: 600, color: '#0f172a'}}>
          Layout options
        </h3>
        <p style={{margin: '0 0 0.5rem', fontSize: '0.8125rem', color: '#475569'}}>
          Tune the D3 DAG layout operators and spacing before applying the configuration to the canvas.
        </p>
        <DagLayoutOptionsSection
          appliedOptions={appliedOptions}
          onApply={onApply ? (options) => onApply(layout, options) : undefined}
        />
      </div>
    );
  }

  return (
    <section
      style={{
        borderTop: '1px solid #e2e8f0',
        paddingTop: '0.75rem',
        fontSize: '0.8125rem',
        color: '#475569'
      }}
    >
      <h3 style={{margin: '0 0 0.5rem', fontSize: '0.875rem', fontWeight: 600, color: '#0f172a'}}>
        Layout options
      </h3>
      <p style={{margin: 0}}>
        This layout does not expose configurable options in the control panel yet.
      </p>
    </section>
  );
}

export function ControlPanel({
  examples,
  defaultExample,
  onExampleChange,
  children,
  layoutOptions,
  onLayoutOptionsApply
}: ControlPanelProps) {
  const resolveExampleIndex = useCallback(
    (example?: ExampleDefinition) => {
      if (!example) {
        return 0;
      }

      const index = examples.findIndex((candidate) => candidate === example);
      return index === -1 ? 0 : index;
    },
    [examples]
  );

  const [selectedExampleIndex, setSelectedExampleIndex] = useState(() =>
    resolveExampleIndex(defaultExample)
  );
  const selectedExample = examples[selectedExampleIndex];
  const availableLayouts = selectedExample?.layouts ?? [];
  const [selectedLayout, setSelectedLayout] = useState<LayoutType | undefined>(
    availableLayouts[0]
  );
  const [areChildrenCollapsed, setAreChildrenCollapsed] = useState(false);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);

  useEffect(() => {
    if (!availableLayouts.length) {
      setSelectedLayout(undefined);
      return;
    }

    setSelectedLayout((currentLayout) =>
      currentLayout && availableLayouts.includes(currentLayout)
        ? currentLayout
        : availableLayouts[0]
    );
  }, [availableLayouts]);

  useEffect(() => {
    if (selectedExample && selectedLayout) {
      onExampleChange(selectedExample, selectedLayout);
    }
  }, [selectedExample, selectedLayout, onExampleChange]);

  const handleExampleChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const index = Number(event.target.value);
      setSelectedExampleIndex(Number.isNaN(index) ? 0 : index);
    },
    []
  );

  useEffect(() => {
    setSelectedExampleIndex((currentIndex) => {
      const nextIndex = resolveExampleIndex(defaultExample);
      return currentIndex === nextIndex ? currentIndex : nextIndex;
    });
  }, [defaultExample, resolveExampleIndex]);

  const handleLayoutChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedLayout(event.target.value as LayoutType);
  }, []);

  const datasetDescription = selectedExample?.description;

  const layoutDescription = useMemo(() => {
    if (!selectedExample || !selectedLayout) {
      return undefined;
    }

    return selectedExample.layoutDescriptions[selectedLayout];
  }, [selectedExample, selectedLayout]);

  const styleJson = useMemo(() => {
    const styles = selectedExample?.style;
    if (!styles) {
      return '';
    }

    return JSON.stringify(
      styles,
      (_key, value) => (typeof value === 'function' ? value.toString() : value),
      2
    );
  }, [selectedExample]);

  const toggleChildrenCollapsed = useCallback(() => {
    setAreChildrenCollapsed((value) => !value);
  }, []);

  const togglePanelCollapsed = useCallback(() => {
    setIsPanelCollapsed((value) => !value);
  }, []);

  if (!examples.length) {
    return null;
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        padding: '0.5rem 0 1rem',
        fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif'
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gridAutoRows: 'auto',
          columnGap: '0.75rem',
          rowGap: '0.75rem',
          alignItems: 'center'
        }}
      >
        <label
          htmlFor="graph-viewer-example"
          style={{fontSize: '0.875rem', fontWeight: 600, color: '#0f172a'}}
        >
          Dataset
        </label>
        <select
          id="graph-viewer-example"
          value={selectedExampleIndex}
          onChange={handleExampleChange}
          style={{
            fontFamily: 'inherit',
            fontSize: '0.875rem',
            padding: '0.375rem 0.5rem',
            borderRadius: '0.375rem',
            border: '1px solid #cbd5f5',
            backgroundColor: '#ffffff',
            color: '#0f172a'
          }}
        >
          {examples.map((example, index) => (
            <option key={example.name} value={index}>
              {example.name}
            </option>
          ))}
        </select>
        <label htmlFor="graph-viewer-layout" style={{fontSize: '0.875rem', fontWeight: 600, color: '#0f172a'}}>
          Layout
        </label>
        <select
          id="graph-viewer-layout"
          value={selectedLayout}
          onChange={handleLayoutChange}
          disabled={!availableLayouts.length}
          style={{
            fontFamily: 'inherit',
            fontSize: '0.875rem',
            padding: '0.375rem 0.5rem',
            borderRadius: '0.375rem',
            border: '1px solid #cbd5f5',
            backgroundColor: '#ffffff',
            color: '#0f172a'
          }}
        >
          {availableLayouts.map((layout) => (
            <option key={layout} value={layout}>
              {LAYOUT_LABELS[layout] ?? layout}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        onClick={togglePanelCollapsed}
        style={{
          alignSelf: 'flex-start',
          fontSize: '0.8125rem',
          fontWeight: 600,
          border: '1px solid #cbd5f5',
          background: '#f8fafc',
          color: '#0f172a',
          borderRadius: '0.5rem',
          padding: '0.25rem 0.5rem',
          cursor: 'pointer'
        }}
      >
        {isPanelCollapsed ? 'Show control panel sections' : 'Hide control panel sections'}
      </button>
      {!isPanelCollapsed ? (
        <>
          {datasetDescription ? (
            <section style={{fontSize: '0.875rem', lineHeight: 1.5, color: '#334155'}}>
              <h3 style={{margin: '0 0 0.25rem', fontSize: '0.875rem', fontWeight: 600, color: '#0f172a'}}>
                Dataset overview
              </h3>
              <p style={{margin: 0}}>{datasetDescription}</p>
            </section>
          ) : null}
          <LayoutOptionsSection
            layout={selectedLayout}
            appliedOptions={layoutOptions}
            onApply={onLayoutOptionsApply}
          />
          {children ? (
            <section
              style={{
                borderTop: '1px solid #e2e8f0',
                paddingTop: '0.75rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem'
              }}
            >
              <button
                type="button"
                onClick={toggleChildrenCollapsed}
                style={{
                  alignSelf: 'flex-start',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  border: '1px solid #cbd5f5',
                  background: '#f8fafc',
                  color: '#0f172a',
                  borderRadius: '0.5rem',
                  padding: '0.25rem 0.5rem',
                  cursor: 'pointer'
                }}
              >
                {areChildrenCollapsed ? 'Expand details' : 'Collapse details'}
              </button>
              {!areChildrenCollapsed ? <div>{children}</div> : null}
            </section>
          ) : null}
          {layoutDescription ? (
            <section style={{fontSize: '0.875rem', lineHeight: 1.5, color: '#334155'}}>
              <h3 style={{margin: '0 0 0.25rem', fontSize: '0.875rem', fontWeight: 600, color: '#0f172a'}}>
                Layout overview
              </h3>
              <p style={{margin: 0}}>{layoutDescription}</p>
            </section>
          ) : null}
          <section style={{display: 'flex', flexDirection: 'column', fontSize: '0.75rem', gap: '0.25rem'}}>
            <h3 style={{margin: 0, fontSize: '0.875rem', fontWeight: 600, color: '#0f172a'}}>
              Stylesheet JSON
            </h3>
            <pre
              style={{
                margin: 0,
                padding: '0.75rem',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '0.5rem',
                fontSize: '0.75rem',
                lineHeight: 1.4,
                maxHeight: '16rem',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                fontFamily:
                  'SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
              }}
            >
              {styleJson || '// No style defined for this example'}
            </pre>
          </section>
        </>
      ) : null}
    </div>
  );
}
