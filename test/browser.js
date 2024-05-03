import test from 'tape';
import {configure} from '@math.gl/core';

configure({debug: true});

// @ts-expect-error TODO TS2339: Property 'browserTestDriver_finish' does not exist on type 'Window & typeof globalThis'
test.onFinish(window.browserTestDriver_finish);
// @ts-expect-error TODO TS2339: Property 'browserTestDriver_fail' does not exist on type 'Window & typeof globalThis'
test.onFailure(window.browserTestDriver_fail);

// import './modules';
