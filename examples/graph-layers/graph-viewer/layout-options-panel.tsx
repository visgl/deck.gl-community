// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useCallback, useEffect, useState} from 'react';
import type {
  LayoutType,
  DagLayoutFormState,
  ForceLayoutFormState,
  ForceLayoutNumericKey,
  ForceMultiGraphLayoutFormState,
  RadialLayoutFormState,
  HivePlotLayoutFormState
} from './layout-options';
import {
  createDagFormState,
  mapDagFormStateToOptions,
  createForceLayoutFormState,
  mapForceLayoutFormStateToOptions,
  createForceMultiGraphFormState,
  mapForceMultiGraphFormStateToOptions,
  createRadialLayoutFormState,
  mapRadialLayoutFormStateToOptions,
  createHivePlotLayoutFormState,
  mapHivePlotLayoutFormStateToOptions,
  D3_FORCE_DEFAULT_OPTIONS,
  GPU_FORCE_DEFAULT_OPTIONS,
  FORCE_LAYOUT_PROP_DESCRIPTIONS,
  FORCE_MULTI_GRAPH_PROP_DESCRIPTIONS,
  RADIAL_LAYOUT_PROP_DESCRIPTIONS,
  HIVE_PLOT_PROP_DESCRIPTIONS,
  DAG_LAYOUT_PROP_DESCRIPTIONS
} from './layout-options';
import {PropsForm} from './props-form';

type LayoutOptionsPanelProps = {
  layout?: LayoutType;
  appliedOptions?: Record<string, unknown>;
  onApply?: (layout: LayoutType, options: Record<string, unknown>) => void;
};

const DETAILS_STYLE: React.CSSProperties = {
  borderTop: '1px solid #e2e8f0',
  paddingTop: '0.75rem',
  fontSize: '0.8125rem'
};

const SUMMARY_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: '0.875rem',
  fontWeight: 600,
  color: '#0f172a',
  cursor: 'pointer'
};

const DESCRIPTION_STYLE: React.CSSProperties = {
  margin: '0.5rem 0',
  fontSize: '0.8125rem',
  color: '#475569'
};

type LayoutOptionsDetailsProps = {
  children: React.ReactNode;
  description?: React.ReactNode;
  defaultOpen?: boolean;
};

function LayoutOptionsDetails({children, description, defaultOpen}: LayoutOptionsDetailsProps) {
  const [isOpen, setIsOpen] = useState(Boolean(defaultOpen));

  useEffect(() => {
    setIsOpen(Boolean(defaultOpen));
  }, [defaultOpen]);

  const handleToggle = useCallback((event: React.SyntheticEvent<HTMLDetailsElement>) => {
    setIsOpen(event.currentTarget.open);
  }, []);

  return (
    <details open={isOpen} onToggle={handleToggle} style={DETAILS_STYLE}>
      <summary style={SUMMARY_STYLE}>Layout options</summary>
      {description
        ? typeof description === 'string'
          ? (
              <p style={DESCRIPTION_STYLE}>{description}</p>
            )
          : (
              description
            )
        : null}
      {children}
    </details>
  );
}

function DagLayoutOptionsSection({
  appliedOptions,
  onApply
}: {
  appliedOptions?: Record<string, unknown>;
  onApply?: (options: Record<string, unknown>) => void;
}) {
  const [formState, setFormState] = useState<DagLayoutFormState>(() =>
    createDagFormState(appliedOptions)
  );

  useEffect(() => {
    setFormState(createDagFormState(appliedOptions));
  }, [appliedOptions]);

  const handleChange = useCallback(
    <K extends keyof typeof DAG_LAYOUT_PROP_DESCRIPTIONS>(key: K, value: DagLayoutFormState[K]) => {
      setFormState((current) => {
        const nextState = {
          ...current,
          [key]: value
        } as DagLayoutFormState;

        if (onApply) {
          onApply(mapDagFormStateToOptions(nextState));
        }

        return nextState;
      });
    },
    [onApply]
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
      <PropsForm
        descriptions={DAG_LAYOUT_PROP_DESCRIPTIONS}
        values={formState}
        onChange={handleChange}
      />
    </section>
  );
}

function ForceLayoutOptionsSection({
  appliedOptions,
  onApply,
  defaults
}: {
  appliedOptions?: Record<string, unknown>;
  onApply?: (options: Record<string, unknown>) => void;
  defaults: Record<ForceLayoutNumericKey, number>;
}) {
  const [formState, setFormState] = useState<ForceLayoutFormState>(() =>
    createForceLayoutFormState(appliedOptions, defaults)
  );

  useEffect(() => {
    setFormState(createForceLayoutFormState(appliedOptions, defaults));
  }, [appliedOptions, defaults]);

  const handleChange = useCallback(
    <K extends keyof typeof FORCE_LAYOUT_PROP_DESCRIPTIONS>(key: K, value: ForceLayoutFormState[K]) => {
      setFormState((current) => {
        const nextState = {
          ...current,
          [key]: value
        } as ForceLayoutFormState;

        if (onApply) {
          onApply(mapForceLayoutFormStateToOptions(nextState));
        }

        return nextState;
      });
    },
    [onApply]
  );

  return (
    <PropsForm
      descriptions={FORCE_LAYOUT_PROP_DESCRIPTIONS}
      values={formState}
      onChange={handleChange}
    />
  );
}

function ForceMultiGraphLayoutOptionsSection({
  appliedOptions,
  onApply
}: {
  appliedOptions?: Record<string, unknown>;
  onApply?: (options: Record<string, unknown>) => void;
}) {
  const [formState, setFormState] = useState<ForceMultiGraphLayoutFormState>(() =>
    createForceMultiGraphFormState(appliedOptions)
  );

  useEffect(() => {
    setFormState(createForceMultiGraphFormState(appliedOptions));
  }, [appliedOptions]);

  const handleChange = useCallback(
    <K extends keyof typeof FORCE_MULTI_GRAPH_PROP_DESCRIPTIONS>(
      key: K,
      value: ForceMultiGraphLayoutFormState[K]
    ) => {
      setFormState((current) => {
        const nextState = {
          ...current,
          [key]: value
        } as ForceMultiGraphLayoutFormState;

        if (onApply) {
          onApply(mapForceMultiGraphFormStateToOptions(nextState));
        }

        return nextState;
      });
    },
    [onApply]
  );

  return (
    <PropsForm
      descriptions={FORCE_MULTI_GRAPH_PROP_DESCRIPTIONS}
      values={formState}
      onChange={handleChange}
    />
  );
}

function RadialLayoutOptionsSection({
  appliedOptions,
  onApply
}: {
  appliedOptions?: Record<string, unknown>;
  onApply?: (options: Record<string, unknown>) => void;
}) {
  const [formState, setFormState] = useState<RadialLayoutFormState>(() =>
    createRadialLayoutFormState(appliedOptions)
  );

  useEffect(() => {
    setFormState(createRadialLayoutFormState(appliedOptions));
  }, [appliedOptions]);

  const handleChange = useCallback(
    <K extends keyof typeof RADIAL_LAYOUT_PROP_DESCRIPTIONS>(key: K, value: RadialLayoutFormState[K]) => {
      setFormState((current) => {
        const nextState = {
          ...current,
          [key]: value
        } as RadialLayoutFormState;

        if (onApply) {
          onApply(mapRadialLayoutFormStateToOptions(nextState));
        }

        return nextState;
      });
    },
    [onApply]
  );

  return (
    <PropsForm
      descriptions={RADIAL_LAYOUT_PROP_DESCRIPTIONS}
      values={formState}
      onChange={handleChange}
    />
  );
}

function HivePlotLayoutOptionsSection({
  appliedOptions,
  onApply
}: {
  appliedOptions?: Record<string, unknown>;
  onApply?: (options: Record<string, unknown>) => void;
}) {
  const [formState, setFormState] = useState<HivePlotLayoutFormState>(() =>
    createHivePlotLayoutFormState(appliedOptions)
  );

  useEffect(() => {
    setFormState(createHivePlotLayoutFormState(appliedOptions));
  }, [appliedOptions]);

  const handleChange = useCallback(
    <K extends keyof typeof HIVE_PLOT_PROP_DESCRIPTIONS>(key: K, value: HivePlotLayoutFormState[K]) => {
      setFormState((current) => {
        const nextState = {
          ...current,
          [key]: value
        } as HivePlotLayoutFormState;

        if (onApply) {
          onApply(mapHivePlotLayoutFormStateToOptions(nextState));
        }

        return nextState;
      });
    },
    [onApply]
  );

  return (
    <PropsForm
      descriptions={HIVE_PLOT_PROP_DESCRIPTIONS}
      values={formState}
      onChange={handleChange}
    />
  );
}

export function LayoutOptionsPanel({
  layout,
  appliedOptions,
  onApply
}: LayoutOptionsPanelProps) {
  if (!layout) {
    return null;
  }

  const handleApply = onApply
    ? (options: Record<string, unknown>) => onApply(layout, options)
    : undefined;

  switch (layout) {
    case 'd3-dag-layout':
      return (
        <LayoutOptionsDetails
          defaultOpen
          description="Tune the D3 DAG layout operators and spacing. Changes apply immediately when adjusted."
        >
          <DagLayoutOptionsSection appliedOptions={appliedOptions} onApply={handleApply} />
        </LayoutOptionsDetails>
      );
    case 'd3-force-layout':
      return (
        <LayoutOptionsDetails description="Adjust the D3 force simulation parameters to influence node separation and stability.">
          <ForceLayoutOptionsSection
            appliedOptions={appliedOptions}
            defaults={D3_FORCE_DEFAULT_OPTIONS}
            onApply={handleApply}
          />
        </LayoutOptionsDetails>
      );
    case 'gpu-force-layout':
      return (
        <LayoutOptionsDetails description="Update the GPU-accelerated force simulation parameters. Changes restart the worker immediately.">
          <ForceLayoutOptionsSection
            appliedOptions={appliedOptions}
            defaults={GPU_FORCE_DEFAULT_OPTIONS}
            onApply={handleApply}
          />
        </LayoutOptionsDetails>
      );
    case 'force-multi-graph-layout':
      return (
        <LayoutOptionsDetails description="Configure the multi-graph force simulation used to space out parallel edges.">
          <ForceMultiGraphLayoutOptionsSection
            appliedOptions={appliedOptions}
            onApply={handleApply}
          />
        </LayoutOptionsDetails>
      );
    case 'radial-layout':
      return (
        <LayoutOptionsDetails description="Control the radius applied to each hierarchical level in the radial layout.">
          <RadialLayoutOptionsSection appliedOptions={appliedOptions} onApply={handleApply} />
        </LayoutOptionsDetails>
      );
    case 'hive-plot-layout':
      return (
        <LayoutOptionsDetails description="Adjust the inner and outer radii to fine-tune hive plot spacing.">
          <HivePlotLayoutOptionsSection appliedOptions={appliedOptions} onApply={handleApply} />
        </LayoutOptionsDetails>
      );
    case 'simple-layout':
      return (
        <LayoutOptionsDetails description="Simple layout reads node positions directly from the dataset.">
          <p style={DESCRIPTION_STYLE}>
            Update node coordinates or supply a custom nodePositionAccessor on the layout to change
            positions.
          </p>
        </LayoutOptionsDetails>
      );
    default:
      return (
        <LayoutOptionsDetails description="This layout does not expose configurable options in the control panel yet." />
      );
  }
}
