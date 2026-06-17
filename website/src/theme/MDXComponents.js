import React from 'react';
import MDXComponents from '@theme-original/MDXComponents';
import {MarkdownTable} from '../components/docs/markdown-table';

export default {
  ...MDXComponents,
  table: (props) => <MarkdownTable {...props} />
};
