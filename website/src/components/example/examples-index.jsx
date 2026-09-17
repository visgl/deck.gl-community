import React, {useMemo, useState} from 'react';
// Note: `useDocsSidebar()` is internal API and may change in a future release.
import {useDocsSidebar, useDocsVersion} from '@docusaurus/plugin-content-docs/client';

import ExampleCard from './example-card';
import styles from './examples-index.module.css';

export default function ExamplesIndex({getThumbnail}) {
  const sidebar = useDocsSidebar();
  const {docs} = useDocsVersion();
  const [query, setQuery] = useState('');
  const catalog = useMemo(() => buildCatalog(sidebar.items, docs), [docs, sidebar.items]);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredCatalog = catalog.filter(item => {
    if (!normalizedQuery) return true;
    return [item.label, item.category, item.description].join(' ').toLowerCase().includes(normalizedQuery);
  });

  return (
    <main className={styles.mainExamples}>
      <div className={styles.controls}>
        <div>
          <p className={styles.eyebrow}>Explore examples</p>
          <p className={styles.introduction}>Search by example name, package, or technique.</p>
        </div>
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search examples…"
          aria-label="Search examples"
        />
      </div>

      <p className={styles.resultsSummary} aria-live="polite">
        Showing {filteredCatalog.length} of {catalog.length} examples
      </p>

      {groupByCategory(filteredCatalog).map(([category, items]) => (
        <section className={styles.exampleSection} key={category}>
          <div className={styles.sectionHeading}>
            <h2>{category}</h2>
            <span>{items.length}</span>
          </div>
          <div className={styles.examplesGroup}>
            {items.map(item => (
              <ExampleCard
                key={item.href || item.docId || item.label}
                item={item}
                category={category}
                description={item.description}
                getThumbnail={getThumbnail}
              />
            ))}
          </div>
        </section>
      ))}

      {filteredCatalog.length === 0 ? (
        <div className={styles.emptyState}>No examples match your search.</div>
      ) : null}
    </main>
  );
}

function buildCatalog(items, docs, parentCategory = 'Examples') {
  return items.flatMap(item => {
    if (item.type === 'category') return buildCatalog(item.items, docs, item.label);
    if (item.docId === 'index' || !item.href) return [];
    return [{
      ...item,
      category: parentCategory,
      description: item.docId ? docs[item.docId]?.description || '' : ''
    }];
  });
}

function groupByCategory(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.category)) groups.set(item.category, []);
    groups.get(item.category).push(item);
  }
  return [...groups.entries()];
}
