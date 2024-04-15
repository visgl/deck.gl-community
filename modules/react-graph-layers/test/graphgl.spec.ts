import * as React from 'react';
import {afterEach, describe, it, expect, vi} from 'vitest';
import {cleanup, fireEvent, render} from '@testing-library/react';
import {GraphGL} from '../src/graph-gl';

// NOTE: this line is important! It will clean up the jsdom properly.
afterEach(cleanup);

// const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('GrapGL', () => {
  it('should exist ▲', async () => {
    // const onClick = vi.fn();
    // const {getByText} = render(<LongPressButton onClick={onClick}>{'▲'}</LongPressButton>);
    // fireEvent.mouseDown(getByText('▲'));
    // await sleep(150); // await long press
    expect(GraphGL).not.toBeNull();
  });
});
