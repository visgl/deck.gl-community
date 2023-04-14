/* global window */
import test from 'tape';
import {_enableDOMLogging as enableDOMLogging} from '@probe.gl/test-utils';

// require('@luma.gl/debug');

let failed = false;
test.onFinish(window.browserTestDriver_finish);
test.onFailure(() => {
  failed = true;
  window.browserTestDriver_fail();
});

// tap-browser-color alternative
// enableDOMLogging({
//   getStyle: (message) => ({
//     background: failed ? '#F28E82' : '#8ECA6C',
//     position: 'absolute',
//     top: '500px',
//     width: '100%'
//   })
// });

// require('./modules');
// import '../modules/bing-maps/test';
console.log('browser')