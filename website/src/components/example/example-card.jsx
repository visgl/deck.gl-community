import React, {useState} from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import styles from './example-card.module.css';

export default function ExampleCard({item, category, description, getThumbnail}) {
  const imageUrl = useBaseUrl(getThumbnail(item));
  const [imageFailed, setImageFailed] = useState(false);
  const metadata = item.customProps || {};
  const tags = metadata.tags || [];

  return (
    <a className={styles.card} href={item.href}>
      <div className={styles.poster}>
        {!imageFailed ? (
          <img
            className={styles.image}
            src={imageUrl}
            alt=""
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className={styles.fallback} aria-hidden="true">
            <span>{item.label}</span>
          </div>
        )}
        <div className={styles.posterShade} />
        <span className={styles.category}>{category}</span>
        <span className={styles.openIcon} aria-hidden="true">
          ↗
        </span>
      </div>
      <div className={styles.content}>
        <h3 className={styles.title}>{item.label}</h3>
        {description ? <p className={styles.description}>{description}</p> : null}
        <div className={styles.metadata} aria-label="Example details">
          {metadata.difficulty ? <span>{formatLabel(metadata.difficulty)}</span> : null}
          {metadata.backend ? <span>{formatLabel(metadata.backend)}</span> : null}
          {tags.slice(0, 2).map(tag => <span key={tag}>{formatLabel(tag)}</span>)}
        </div>
      </div>
    </a>
  );
}

function formatLabel(value) {
  return value
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
