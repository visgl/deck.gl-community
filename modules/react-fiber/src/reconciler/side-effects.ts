/**
 * @deprecated This file is deprecated and will be removed in v3.
 *
 * Layer registration is no longer needed with the new <layer> element.
 * Remove this import and use:
 *
 * import { ScatterplotLayer } from '@deck.gl/layers';
 * <layer layer={new ScatterplotLayer({ id: 'points', data })} />
 *
 * This provides better type safety, enables code-splitting, and eliminates
 * the need for manual layer registration.
 */

if (process.env.NODE_ENV === 'development') {
  console.warn(
    '@deck.gl-community/react-fiber/reconciler/side-effects is deprecated and will be removed in v3.\n' +
      'Layer registration is no longer needed. Remove this import and use:\n' +
      '  import { ScatterplotLayer } from "@deck.gl/layers";\n' +
      '  <layer layer={new ScatterplotLayer({ id: "points", data })} />\n' +
      'See migration guide for more details.'
  );
}
