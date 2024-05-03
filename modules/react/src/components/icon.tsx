import * as React from 'react';
import 'boxicons';

export function Icon(props) {
  // @ts-expect-error TODO
  return <box-icon color="currentColor" {...props} />;
}
