import {terser} from 'rollup-plugin-terser';

const config = (file, plugins = []) => ({
  input: 'src/index.js',
  output: {
    name: 'deckgl-mapbox-style',
    format: 'umd',
    indent: false,
    file
  },
  plugins
});

export default [
  config('dist/deckgl-mapbox-style.js'),
  config('dist/deckgl-mapbox-style.min.js', [terser()])
];
