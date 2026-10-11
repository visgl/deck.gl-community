import {createExample} from './example';

const example = createExample(document.getElementById('example'));
window.addEventListener('pagehide', () => example.finalize());
