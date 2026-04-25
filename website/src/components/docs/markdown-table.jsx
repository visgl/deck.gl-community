import React from 'react';
import clsx from 'clsx';

export function MarkdownTable({className, children, ...tableProps}) {
  return (
    <div className="docs-markdown-table">
      <table {...tableProps} className={clsx('docs-markdown-table__table', className)}>
        {children}
      </table>
    </div>
  );
}
