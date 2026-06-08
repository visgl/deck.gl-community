/**
 * A simple animation engine for deck.gl layers
 */
import {type Layer} from '@deck.gl/core';

export type AnimationFrame<LayerT extends Layer> = {
  /** The prop values to transition to */
  props: Partial<LayerT['props']>;
  /** The duration in milliseconds to execute the transition */
  duration: number;
  /** The pause before start. @default 0 */
  delay?: number;
  /** The easing function that defines the transition curve. @default linear */
  easing?: (t: number) => number;
};
export type AnimationFramesGroup<LayerT extends Layer> = {
  /**
   * How to schedule the child frames.
   * sequence: each frame is started after the previous frame ends.
   * concurrence: all frames are started together.
   * stagger: each frame is started one-by-one, at a fixed interval
   */
  type: 'sequence' | 'concurrence' | 'stagger';
  /**
   * Optional delay in milliseconds.
   * In `sequence` mode, delay refers to the wait after a step ends and before starting the next step.
   * In `concurrence` mode, delay refers to the wait before starting all steps together.
   * In `stagger` mode, delay refers to the interval between starting steps
   */
  delay?: number;

  frames: (AnimationFramesGroup<LayerT> | AnimationFrame<LayerT>)[];
};

export type AnimationExtensionOptions<LayerT extends Layer> = {
  frames: AnimationFramesGroup<LayerT>;
  repeat?: number;
  repeatType?: 'loop' | 'reverse';
  repeatDelay?: number;
};

type ResolvedAnimationFrame<LayerT extends Layer> = {
  /** Assigned at start time */
  from: Partial<LayerT['props']> | undefined;
  /** Provided by user */
  to: Partial<LayerT['props']>;
  /** Calculated start time of this frame if the whole animation starts at 0 */
  start: number;
  /** Calculated end time of this frame if the whole animation starts at 0 */
  end: number;
  /** Easing function */
  easing: (t: number) => number;
};

export type AnimationState<LayerT extends Layer> = {
  // timestamp at which the current iteration started
  start: number;
  // timestamp at which the current iteration will ended
  end: number;
  // true if the end state has not been fully committed
  inProgress: boolean;
  // iterations completed
  iterations: number;
  // frames to execute
  frames: ResolvedAnimationFrame<LayerT>[];
};

const LINEAR_EASING = (t: number) => t;

type ResolvedFramesResult<LayerT extends Layer> = {
  frames: ResolvedAnimationFrame<LayerT>[];
  duration: number;
};

function resolveFramesGroup<LayerT extends Layer = Layer>(
  group: AnimationFramesGroup<LayerT> | AnimationFrame<LayerT>,
  baseStart: number
): ResolvedFramesResult<LayerT> {
  if ('props' in group) {
    const delay = group.delay ?? 0;
    const start = baseStart + delay;
    const end = start + group.duration;
    return {
      frames: [
        {
          from: undefined,
          to: group.props,
          start,
          end,
          easing: group.easing ?? LINEAR_EASING
        }
      ],
      duration: delay + group.duration
    };
  }

  const delay = group.delay ?? 0;
  const frames: ResolvedAnimationFrame<LayerT>[] = [];

  if (group.type === 'sequence') {
    let current = baseStart;
    for (let i = 0; i < group.frames.length; i += 1) {
      const child = group.frames[i]!;
      const childResult = resolveFramesGroup(child, current);
      frames.push(...childResult.frames);
      current += childResult.duration;
      if (i < group.frames.length - 1) current += delay;
    }
    return {frames, duration: Math.max(0, current - baseStart)};
  }

  if (group.type === 'concurrence') {
    const start = baseStart + delay;
    let maxDuration = 0;
    for (const child of group.frames) {
      const childResult = resolveFramesGroup(child, start);
      frames.push(...childResult.frames);
      if (childResult.duration > maxDuration) maxDuration = childResult.duration;
    }
    return {frames, duration: delay + maxDuration};
  }

  let maxEnd = baseStart;
  for (let i = 0; i < group.frames.length; i += 1) {
    const child = group.frames[i]!;
    const childResult = resolveFramesGroup(child, baseStart + i * delay);
    frames.push(...childResult.frames);
    const childEnd = baseStart + i * delay + childResult.duration;
    if (childEnd > maxEnd) maxEnd = childEnd;
  }

  frames.sort((f1, f2) => f1.end - f2.end);

  return {frames, duration: Math.max(0, maxEnd - baseStart)};
}

function getFramesDuration<LayerT extends Layer = Layer>(
  frames: ResolvedAnimationFrame<LayerT>[]
): number {
  let maxEnd = 0;
  for (const frame of frames) {
    if (frame.end > maxEnd) maxEnd = frame.end;
  }
  return maxEnd;
}

function reverseResolvedFrames<LayerT extends Layer = Layer>(
  frames: ResolvedAnimationFrame<LayerT>[]
): ResolvedAnimationFrame<LayerT>[] {
  const duration = getFramesDuration(frames);
  const reversed: ResolvedAnimationFrame<LayerT>[] = [];
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const frame = frames[i]!;
    reversed.push({
      from: undefined,
      to: frame.from ?? frame.to,
      start: duration - frame.end,
      end: duration - frame.start,
      easing: frame.easing
    });
  }
  return reversed;
}

export function resolveAnimationFrames<LayerT extends Layer = Layer>(
  time: number,
  opts: AnimationExtensionOptions<LayerT>,
  prevState?: AnimationState<LayerT>
): AnimationState<LayerT> {
  const {frames, repeat = 0, repeatType = 'loop', repeatDelay = 0} = opts;
  if (!prevState) {
    const resolved = resolveFramesGroup(frames, 0);
    return {
      start: time,
      end: time + resolved.duration,
      inProgress: true,
      iterations: 0,
      frames: resolved.frames
    };
  }

  const state = prevState;
  if (time < state.end) {
    return state;
  }

  const iterationEnd = state.end;
  const iterations = state.iterations + 1;
  if (iterations > repeat) {
    return state;
  }
  const start = iterationEnd + repeatDelay;
  if (repeatType === 'reverse' && iterations % 2 === 1) {
    const duration = state.end - state.start;
    return {
      start,
      end: start + duration,
      iterations,
      frames: reverseResolvedFrames(state.frames),
      inProgress: true
    };
  } else {
    const resolved = resolveFramesGroup(frames, 0);
    return {
      start: time,
      end: time + resolved.duration,
      inProgress: true,
      iterations,
      frames: resolved.frames
    };
  }
}

function interpolateProp<PropT extends number | number[] | string | Function | object>(
  from: PropT | undefined,
  to: PropT | undefined,
  ratio: number
): PropT | undefined {
  if (from === undefined || to === undefined) return to;
  if (typeof to === 'string' || typeof to === 'function') return to;
  if (typeof to === 'number' && typeof from === 'number') {
    return (from + (to - from) * ratio) as PropT;
  }
  if (Array.isArray(to) && Array.isArray(from)) {
    const len = to.length;
    const out = new Array(len);
    for (let i = 0; i < len; i += 1) {
      const toValue = to[i];
      const fromValue = from[i];
      out[i] =
        typeof toValue === 'number' && typeof fromValue === 'number'
          ? fromValue + (toValue - fromValue) * ratio
          : toValue;
    }
    return out as PropT;
  }
  return to;
}

export function resolveProps<LayerT extends Layer = Layer>(
  layer: LayerT,
  frames: ResolvedAnimationFrame<LayerT>[],
  timeSinceStart: number
): Partial<LayerT['props']> {
  if (timeSinceStart < 0 || frames.length === 0) return {} as LayerT['props'];

  const baseProps = layer.props as LayerT['props'];
  const nextProps: Partial<LayerT['props']> = {};
  let transitions = baseProps.transitions ? {...baseProps.transitions} : undefined;
  const updateTriggers = {...baseProps.updateTriggers};

  const getPropValue = (key: keyof LayerT['props']) =>
    Object.prototype.hasOwnProperty.call(nextProps, key) ? nextProps[key] : baseProps[key];

  for (const frame of frames) {
    if (timeSinceStart < frame.start) continue;

    const duration = frame.end - frame.start;
    if (duration <= 0) {
      Object.assign(nextProps, frame.to);
      continue;
    }

    if (frame.from === undefined) {
      const from: Partial<LayerT['props']> = {};
      for (const key of Object.keys(frame.to) as (keyof LayerT['props'])[]) {
        from[key] = getPropValue(key);
      }
      frame.from = from;
    }

    if (timeSinceStart >= frame.end) {
      Object.assign(nextProps, frame.to);
      continue;
    }

    const t = frame.easing((timeSinceStart - frame.start) / duration);
    for (const key of Object.keys(frame.to) as (keyof LayerT['props'])[]) {
      const toValue = frame.to[key];
      const fromValue = frame.from[key];
      if (
        String(key).startsWith('get') &&
        (typeof fromValue === 'function' || typeof toValue === 'function')
      ) {
        nextProps[key] = toValue as any;
        updateTriggers[key as string] = {...updateTriggers[key as string], animation: toValue};
        transitions ??= {};
        transitions[key as string] = {
          duration: frame.end - frame.start,
          easing: frame.easing
        };
      } else {
        const value = interpolateProp(fromValue as any, toValue, t);
        if (value !== undefined) {
          nextProps[key] = value;
        }
      }
    }
  }

  return nextProps;
}
