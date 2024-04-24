"use strict";(self.webpackChunkproject_website=self.webpackChunkproject_website||[]).push([[7359],{5680:(e,r,t)=>{t.d(r,{xA:()=>p,yg:()=>y});var n=t(6540);function a(e,r,t){return r in e?Object.defineProperty(e,r,{value:t,enumerable:!0,configurable:!0,writable:!0}):e[r]=t,e}function o(e,r){var t=Object.keys(e);if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e);r&&(n=n.filter((function(r){return Object.getOwnPropertyDescriptor(e,r).enumerable}))),t.push.apply(t,n)}return t}function l(e){for(var r=1;r<arguments.length;r++){var t=null!=arguments[r]?arguments[r]:{};r%2?o(Object(t),!0).forEach((function(r){a(e,r,t[r])})):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(t)):o(Object(t)).forEach((function(r){Object.defineProperty(e,r,Object.getOwnPropertyDescriptor(t,r))}))}return e}function i(e,r){if(null==e)return{};var t,n,a=function(e,r){if(null==e)return{};var t,n,a={},o=Object.keys(e);for(n=0;n<o.length;n++)t=o[n],r.indexOf(t)>=0||(a[t]=e[t]);return a}(e,r);if(Object.getOwnPropertySymbols){var o=Object.getOwnPropertySymbols(e);for(n=0;n<o.length;n++)t=o[n],r.indexOf(t)>=0||Object.prototype.propertyIsEnumerable.call(e,t)&&(a[t]=e[t])}return a}var c=n.createContext({}),s=function(e){var r=n.useContext(c),t=r;return e&&(t="function"==typeof e?e(r):l(l({},r),e)),t},p=function(e){var r=s(e.components);return n.createElement(c.Provider,{value:r},e.children)},u="mdxType",d={inlineCode:"code",wrapper:function(e){var r=e.children;return n.createElement(n.Fragment,{},r)}},m=n.forwardRef((function(e,r){var t=e.components,a=e.mdxType,o=e.originalType,c=e.parentName,p=i(e,["components","mdxType","originalType","parentName"]),u=s(t),m=a,y=u["".concat(c,".").concat(m)]||u[m]||d[m]||o;return t?n.createElement(y,l(l({ref:r},p),{},{components:t})):n.createElement(y,l({ref:r},p))}));function y(e,r){var t=arguments,a=r&&r.mdxType;if("string"==typeof e||a){var o=t.length,l=new Array(o);l[0]=m;var i={};for(var c in r)hasOwnProperty.call(r,c)&&(i[c]=r[c]);i.originalType=e,i[u]="string"==typeof e?e:a,l[1]=i;for(var s=2;s<o;s++)l[s]=t[s];return n.createElement.apply(null,l)}return n.createElement.apply(null,t)}m.displayName="MDXCreateElement"},4128:(e,r,t)=>{t.r(r),t.d(r,{assets:()=>c,contentTitle:()=>l,default:()=>d,frontMatter:()=>o,metadata:()=>i,toc:()=>s});var n=t(8168),a=(t(6540),t(5680));const o={},l="What's New",i={unversionedId:"whats-new",id:"whats-new",title:"What's New",description:"The detailed release notes of each module can be found in the module-specific docs section.",source:"@site/../docs/whats-new.md",sourceDirName:".",slug:"/whats-new",permalink:"/deck.gl-community/docs/whats-new",draft:!1,editUrl:"https://github.com/visgl/deck.gl-community/tree/master/website/../docs/whats-new.md",tags:[],version:"current",frontMatter:{},sidebar:"tutorialSidebar",previous:{title:"Introduction",permalink:"/deck.gl-community/docs/"},next:{title:"Upgrade Guide",permalink:"/deck.gl-community/docs/upgrade-guide"}},c={},s=[],p={toc:s},u="wrapper";function d(e){let{components:r,...t}=e;return(0,a.yg)(u,(0,n.A)({},p,t,{components:r,mdxType:"MDXLayout"}),(0,a.yg)("h1",{id:"whats-new"},"What's New"),(0,a.yg)("p",null,"The detailed release notes of each module can be found in the module-specific docs section."),(0,a.yg)("p",null,"High-level updates are "),(0,a.yg)("p",null,"April 15, 2024: ",(0,a.yg)("a",{parentName:"p",href:"/docs/modules/editable-layers"},(0,a.yg)("strong",{parentName:"a"},(0,a.yg)("inlineCode",{parentName:"strong"},"@deck.gl-community/editable-layers"))),") v9 - This new layer pack is a fork of Uber's no longer maintained ",(0,a.yg)("a",{parentName:"p",href:"https://nebula.gl"},"nebula.gl")," framework. nebula.gl has been an important part of the deck.gl ecosystem but the repository has lacked maintainers for several years and the repository no longer accepts external contributions."),(0,a.yg)("p",null,"Feb 29, 2024: ",(0,a.yg)("a",{parentName:"p",href:"/docs/modules/layers"},(0,a.yg)("strong",{parentName:"a"},(0,a.yg)("inlineCode",{parentName:"strong"},"@deck.gl-community/layers")))," v9 - deck,gl community-layers now support deck.gl v9."),(0,a.yg)("p",null,"December 22, 2023: ",(0,a.yg)("a",{parentName:"p",href:"/docs/modules/layers"},(0,a.yg)("strong",{parentName:"a"},(0,a.yg)("inlineCode",{parentName:"strong"},"@deck.gl-community/layers")))," v0 - A new module intended to containing a collection of useful community layers. Initial layers are ",(0,a.yg)("inlineCode",{parentName:"p"},"TileSourceLayer"),", ",(0,a.yg)("inlineCode",{parentName:"p"},"DataDrivenTile3DLayer"),"."),(0,a.yg)("p",null,"April 14, 2023: ",(0,a.yg)("a",{parentName:"p",href:"/docs/modules/graph-layers"},(0,a.yg)("strong",{parentName:"a"},(0,a.yg)("inlineCode",{parentName:"strong"},"@deck-graph-layers")))," - A new layer pack for rendering graphs (nodes and edges). Forked from Uber's archived ",(0,a.yg)("a",{parentName:"p",href:"https://graph.gl"},"graph.gl")," repo."))}d.isMDXComponent=!0}}]);