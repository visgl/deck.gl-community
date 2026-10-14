import {expect, it} from 'vitest';
import {getVegaTooltip} from '../src/vega-tooltip';

it('formats declarative tooltips as safe text and suppresses absent or exited marks', () => {
  expect(getVegaTooltip({object: {tooltip: {Location: 0, Longitude: -35}}})).toEqual({
    text: 'Location: 0\nLongitude: -35'
  });
  expect(getVegaTooltip({object: {tooltip: '<b>literal</b>'}})).toEqual({text: '<b>literal</b>'});
  expect(getVegaTooltip({object: {tooltip: 0}})).toEqual({text: '0'});
  for (const tooltip of [undefined, null, false, '']) {
    expect(getVegaTooltip({object: {tooltip}})).toBeNull();
  }
  expect(getVegaTooltip({object: {tooltip: 'Exited', isEmpty: true}})).toBeNull();
  expect(getVegaTooltip({})).toBeNull();
});
