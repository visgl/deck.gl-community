import React from 'react';
import styles from './styled.module.css';

const expandedClassName = expanded => (expanded ? styles.expanded : styles.collapsed);

export const PanelContainer = props => <div {...props} className={styles.panelContainer} />;
export const PanelTitle = props => <div {...props} className={styles.panelTitle} />;
export const PanelExpander = ({$expanded, ...props}) => (
  <div {...props} className={`${styles.panelExpander} ${expandedClassName($expanded)}`} />
);
export const PanelContent = ({$expanded, ...props}) => (
  <div {...props} className={`${styles.panelContent} ${expandedClassName($expanded)}`} />
);
export const SourceLink = ({$expanded, ...props}) => (
  <a {...props} className={`${styles.sourceLink} ${expandedClassName($expanded)}`} />
);
