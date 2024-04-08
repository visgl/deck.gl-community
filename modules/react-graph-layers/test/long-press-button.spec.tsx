import * as React from 'react';
import {afterEach, describe, it, expect, vi} from 'vitest';
import {cleanup, fireEvent, render} from '@testing-library/react';
import LongPressButton from '../src/components/long-press-button.jsx';

// NOTE: this line is important! It will clean up the jsdom properly.
afterEach(cleanup);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('LongPressButton', () => {
  it('should record pressing ▲', async () => {
    debugger;
    const onClick = vi.fn();
    const {getByText} = render(<LongPressButton onClick={onClick}>{'▲'}</LongPressButton>);
    fireEvent.mouseDown(getByText('▲'));
    await sleep(150); // await long press
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
