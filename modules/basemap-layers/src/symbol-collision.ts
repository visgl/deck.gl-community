/** How one part of a symbol, its text or its icon, takes part in label collision. */
export type SymbolPartCollision = {
  /**
   * The part is drawn only where its symbol wins the collision test. Otherwise it is drawn
   * whatever it collides with.
   */
  tested: boolean;
  /** The part's box hides lower-priority symbols. Otherwise it hides nothing. */
  blocks: boolean;
};

/** The placement-related layout of a symbol style layer, evaluated at one zoom. */
export type SymbolCollisionLayout = {
  hasText: boolean;
  hasIcon: boolean;
  textAllowOverlap: boolean;
  iconAllowOverlap: boolean;
  textIgnorePlacement: boolean;
  iconIgnorePlacement: boolean;
  textOptional: boolean;
  iconOptional: boolean;
};

/**
 * Decides, from a style layer's placement properties, which parts of its symbols are tested for
 * collision and which hide other symbols, following MapLibre's placement rules:
 *
 * - `*-allow-overlap` places the part even where it collides;
 * - `*-ignore-placement` lets other symbols be placed over the part;
 * - a part that the other part depends on (the other part is not `*-optional`) is placed only when
 *   that other part is placed too, so an icon and its text are shown or hidden as one unit unless
 *   one of them is optional or both allow overlap.
 *
 * A symbol's text and icon share one collision test here, at the symbol's anchor, so a part
 * placed without its optional partner is only possible when that part allows overlap. A layer
 * without text has its text part tested and not blocking: the text sublayer then only marks
 * each symbol's anchor for the collision test.
 */
export function getSymbolCollision(layout: SymbolCollisionLayout): {
  text: SymbolPartCollision;
  icon: SymbolPartCollision;
} {
  const {hasText, hasIcon, textOptional, iconOptional} = layout;
  // Whether each part is placed when it collides, before the parts are combined.
  let textAlwaysPlaced = layout.textAllowOverlap;
  let iconAlwaysPlaced = layout.iconAllowOverlap;
  const iconWithoutText = !hasText || textOptional;
  const textWithoutIcon = !hasIcon || iconOptional;
  if (!iconWithoutText && !textWithoutIcon) {
    textAlwaysPlaced = iconAlwaysPlaced = textAlwaysPlaced && iconAlwaysPlaced;
  } else if (!textWithoutIcon) {
    textAlwaysPlaced = textAlwaysPlaced && iconAlwaysPlaced;
  } else if (!iconWithoutText) {
    iconAlwaysPlaced = iconAlwaysPlaced && textAlwaysPlaced;
  }
  return {
    text: {
      tested: !hasText || !textAlwaysPlaced,
      blocks: hasText && !layout.textIgnorePlacement
    },
    icon: {
      tested: !iconAlwaysPlaced,
      blocks: hasIcon && !layout.iconIgnorePlacement
    }
  };
}
