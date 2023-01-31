import * as React from 'react';
import {cleanup, fireEvent, render} from '@testing-library/react';
import LongPressButton from '../long-press-button';

// NOTE: this line is important! It will cleanup the jsdom properly.
afterEach(cleanup);

describe('LongPressButton', () => {
  it('should record pressing ▲', () => {
    const onClick = jest.fn();
    const {getByText} = render(
      <LongPressButton onClick={onClick}>{'▲'}</LongPressButton>
    );
    fireEvent.mouseDown(getByText('▲'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
