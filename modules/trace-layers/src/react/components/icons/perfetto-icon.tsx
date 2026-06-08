import {PERFETTO_ICON_DATA_URL} from '../../../trace/index';
import {cn} from '../ui';

import type {ComponentProps} from 'react';

/** Renders the shared Perfetto icon asset as an image element. */
export function PerfettoIcon(props: ComponentProps<'img'>) {
  const {className, ...restProps} = props;

  return (
    <img
      alt=""
      aria-hidden
      src={PERFETTO_ICON_DATA_URL}
      {...restProps}
      className={cn('block overflow-visible object-contain align-middle', className)}
    />
  );
}
