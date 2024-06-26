import React from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {Banner, BannerContainer, HeroExampleContainer, ProjectName, GetStartedLink} from './styled';

export default function renderPage({HeroExample, children}) {
  const {siteConfig} = useDocusaurusContext();

  // Note: The Layout "wrapper" component adds header and footer etc
  return (
    <>
      <Banner>
        <HeroExampleContainer>{HeroExample && <HeroExample />}</HeroExampleContainer>
        <BannerContainer>
          <ProjectName>{siteConfig.title}</ProjectName>
          <p>{siteConfig.tagline}</p>
          <GetStartedLink href="./docs">GET STARTED</GetStartedLink>
        </BannerContainer>
      </Banner>
      {children}
    </>
  );
}
