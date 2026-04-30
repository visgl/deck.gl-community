# DocumentationLinksPanel

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`DocumentationLinksPanel` renders a compact list of documentation and resource
links. It is useful in help modals, sidebars, and other panel containers.

## Usage

```ts
import {
  DocumentationLinksPanel,
  type DocumentationLinkItem,
  type DocumentationLinksPanelProps
} from '@deck.gl-community/panels';

const links: DocumentationLinkItem[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    href: 'https://example.com/docs/getting-started',
    description: 'Open the main integration guide.',
    badge: 'Guide'
  },
  {
    kind: 'spacer',
    id: 'reference-spacer'
  },
  {
    id: 'api-reference',
    title: 'API reference',
    href: 'https://example.com/docs/api',
    description: 'Open the full API reference.'
  }
];

const panel = new DocumentationLinksPanel({links});
```

## Types

```ts
type DocumentationLink = {
  kind?: 'link';
  id: string;
  title: string;
  href: string;
  description?: string;
  badge?: string;
};

type DocumentationLinkSpacer = {
  kind: 'spacer';
  id: string;
};

type DocumentationLinkItem = DocumentationLink | DocumentationLinkSpacer;

type DocumentationLinksPanelProps = {
  links?: readonly DocumentationLinkItem[];
  theme?: 'inherit' | 'light' | 'dark' | 'invert';
};
```

## Remarks

- Links open in a new browser tab with `rel="noreferrer"`.
- Spacer items add visual separation between groups.
- Empty and introductory text is generic so callers can use this panel in open
  source packages and application-specific projects.
