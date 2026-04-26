import React from 'react';
import styles from './styled.module.css';

export const Banner = props => <section {...props} className={styles.banner} />;
export const Container = props => <div {...props} className={styles.container} />;
export const BannerContainer = props => <div {...props} className={styles.bannerContainer} />;
export const HeroExampleContainer = props => <div {...props} className={styles.heroExampleContainer} />;
export const Section = props => <section {...props} className={styles.section} />;
export const ProjectName = props => <h1 {...props} className={styles.projectName} />;
export const GetStartedLink = props => <a {...props} className={styles.getStartedLink} />;
