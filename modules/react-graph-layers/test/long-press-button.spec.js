import * as React from 'react';
import {cleanup, fireEvent, render} from '@testing-library/react';
import LongPressButton from '../src/components/long-press-button.jsx';

// NOTE: this line is important! It will clean up the jsdom properly.
afterEach(cleanup);

describe('LongPressButton', () => {
  it('should record pressing ▲', () => {
    const onClick = jest.fn();
    const {getByText} = render(<LongPressButton onClick={onClick}>{'▲'}</LongPressButton>);
    fireEvent.mouseDown(getByText('▲'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
