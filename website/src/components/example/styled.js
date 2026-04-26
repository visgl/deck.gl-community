import React from 'react';
import styles from './styled.module.css';

export const ExampleHeader = props => <div {...props} className={styles.exampleHeader} />;
export const MainExamples = props => <main {...props} className={styles.mainExamples} />;
export const ExamplesGroup = props => <main {...props} className={styles.examplesGroup} />;
export const ExampleCard = props => <a {...props} className={styles.exampleCard} />;
export const ExampleTitle = props => <div {...props} className={styles.exampleTitle} />;
