import {View} from '@deck.gl/core';

/** CSS-like length accepted by the view layout builder. */
export type ViewLayoutLength = number | string;

/** Insets applied inside an allocated child rectangle before compiling its contents. */
export type ViewLayoutInsets = {
  /** Top inset in pixels. */
  top?: number;
  /** Right inset in pixels. */
  right?: number;
  /** Bottom inset in pixels. */
  bottom?: number;
  /** Left inset in pixels. */
  left?: number;
};

/** A raw deck.gl view or nested layout item allowed inside `children`. */
export type ViewLayoutChild = ViewLayoutItem | View | null | false | undefined;

/** Common layout metadata shared by every authored layout item. */
export type ViewLayoutBaseProps = {
  /** Optional width expression resolved against the current parent bounds. */
  width?: ViewLayoutLength;
  /** Optional height expression resolved against the current parent bounds. */
  height?: ViewLayoutLength;
  /** Optional insets applied after parent layout allocation. */
  inset?: ViewLayoutInsets;
};

/** One horizontal layout container that splits width among its children. */
export type ViewLayoutRowProps = ViewLayoutBaseProps & {
  /** Discriminator for horizontal stack layout. */
  type: 'row';
  /** Ordered child items or raw deck views. */
  children: readonly ViewLayoutChild[];
};

/** One vertical layout container that splits height among its children. */
export type ViewLayoutColumnProps = ViewLayoutBaseProps & {
  /** Discriminator for vertical stack layout. */
  type: 'column';
  /** Ordered child items or raw deck views. */
  children: readonly ViewLayoutChild[];
};

/** One overlay container that gives each child the same parent bounds. */
export type ViewLayoutOverlayProps = ViewLayoutBaseProps & {
  /** Discriminator for overlay layout. */
  type: 'overlay';
  /** Ordered child items or raw deck views. */
  children: readonly ViewLayoutChild[];
};

/** One wrapped raw deck view with optional layout-only overrides. */
export type ViewLayoutViewProps = ViewLayoutBaseProps & {
  /** Discriminator for a wrapped raw deck view. */
  type: 'view';
  /** Underlying deck.gl view instance to compile. */
  view: View;
};

/** One empty slot used to reserve fixed space in a stack. */
export type ViewLayoutSpacerProps = ViewLayoutBaseProps & {
  /** Discriminator for an empty spacer item. */
  type: 'spacer';
};

/** Discriminated union accepted by the `ViewLayoutItem` constructor. */
export type ViewLayoutItemProps =
  | ViewLayoutRowProps
  | ViewLayoutColumnProps
  | ViewLayoutOverlayProps
  | ViewLayoutViewProps
  | ViewLayoutSpacerProps;

/**
 * Thin runtime wrapper around one discriminated-union layout node.
 */
export class ViewLayoutItem {
  /** Validated props backing this layout node. */
  readonly props: ViewLayoutItemProps;

  /**
   * Creates one validated layout item from discriminated-union props.
   *
   * @param props - Layout item props keyed by `type`.
   */
  constructor(props: ViewLayoutItemProps) {
    assertViewLayoutItemProps(props);
    this.props = props;
  }
}

/**
 * Validates one discriminated-union prop object before storing it on a layout item.
 *
 * @param props - Candidate layout props passed to the constructor.
 */
function assertViewLayoutItemProps(props: ViewLayoutItemProps): void {
  if (!props || typeof props !== 'object') {
    throw new Error('ViewLayoutItem props must be an object.');
  }

  switch (props.type) {
    case 'row':
    case 'column':
    case 'overlay':
      if (!Array.isArray(props.children)) {
        throw new Error(`ViewLayoutItem "${props.type}" requires a children array.`);
      }
      break;
    case 'view':
      if (!(props.view instanceof View)) {
        throw new Error('ViewLayoutItem "view" requires a deck.gl View instance.');
      }
      break;
    case 'spacer':
      break;
    default: {
      const exhaustiveCheck: never = props;
      throw new Error(`Unsupported view layout item: ${String(exhaustiveCheck)}`);
    }
  }
}
