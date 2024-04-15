"use strict";(self.webpackChunkproject_website=self.webpackChunkproject_website||[]).push([[7424],{5680:(e,t,o)=>{o.d(t,{xA:()=>p,yg:()=>y});var r=o(6540);function n(e,t,o){return t in e?Object.defineProperty(e,t,{value:o,enumerable:!0,configurable:!0,writable:!0}):e[t]=o,e}function i(e,t){var o=Object.keys(e);if(Object.getOwnPropertySymbols){var r=Object.getOwnPropertySymbols(e);t&&(r=r.filter((function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable}))),o.push.apply(o,r)}return o}function a(e){for(var t=1;t<arguments.length;t++){var o=null!=arguments[t]?arguments[t]:{};t%2?i(Object(o),!0).forEach((function(t){n(e,t,o[t])})):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(o)):i(Object(o)).forEach((function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(o,t))}))}return e}function l(e,t){if(null==e)return{};var o,r,n=function(e,t){if(null==e)return{};var o,r,n={},i=Object.keys(e);for(r=0;r<i.length;r++)o=i[r],t.indexOf(o)>=0||(n[o]=e[o]);return n}(e,t);if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(e);for(r=0;r<i.length;r++)o=i[r],t.indexOf(o)>=0||Object.prototype.propertyIsEnumerable.call(e,o)&&(n[o]=e[o])}return n}var c=r.createContext({}),s=function(e){var t=r.useContext(c),o=t;return e&&(o="function"==typeof e?e(t):a(a({},t),e)),o},p=function(e){var t=s(e.components);return r.createElement(c.Provider,{value:t},e.children)},u="mdxType",d={inlineCode:"code",wrapper:function(e){var t=e.children;return r.createElement(r.Fragment,{},t)}},m=r.forwardRef((function(e,t){var o=e.components,n=e.mdxType,i=e.originalType,c=e.parentName,p=l(e,["components","mdxType","originalType","parentName"]),u=s(o),m=n,y=u["".concat(c,".").concat(m)]||u[m]||d[m]||i;return o?r.createElement(y,a(a({ref:t},p),{},{components:o})):r.createElement(y,a({ref:t},p))}));function y(e,t){var o=arguments,n=t&&t.mdxType;if("string"==typeof e||n){var i=o.length,a=new Array(i);a[0]=m;var l={};for(var c in t)hasOwnProperty.call(t,c)&&(l[c]=t[c]);l.originalType=e,l[u]="string"==typeof e?e:n,a[1]=l;for(var s=2;s<i;s++)a[s]=o[s];return r.createElement.apply(null,a)}return r.createElement.apply(null,o)}m.displayName="MDXCreateElement"},2580:(e,t,o)=>{o.r(t),o.d(t,{assets:()=>c,contentTitle:()=>a,default:()=>d,frontMatter:()=>i,metadata:()=>l,toc:()=>s});var r=o(8168),n=(o(6540),o(5680));const i={},a="Introduction",l={unversionedId:"README",id:"README",title:"Introduction",description:"This repository contains a collection of community supported modules for deck.gl, that are intended to complement the various modules already provided by the core deck.gl framework. While any module that is properly scoped and of sufficient value to the community could be a candidate for this repository, common modules type are:",source:"@site/../docs/README.md",sourceDirName:".",slug:"/",permalink:"/deck.gl-community/docs/",draft:!1,editUrl:"https://github.com/visgl/deck.gl-community/tree/master/website/../docs/README.md",tags:[],version:"current",frontMatter:{},sidebar:"tutorialSidebar",next:{title:"What's New",permalink:"/deck.gl-community/docs/whats-new"}},c={},s=[{value:"Support",id:"support",level:2},{value:"Contributing",id:"contributing",level:2},{value:"Upstreaming",id:"upstreaming",level:2}],p={toc:s},u="wrapper";function d(e){let{components:t,...o}=e;return(0,n.yg)(u,(0,r.A)({},p,o,{components:t,mdxType:"MDXLayout"}),(0,n.yg)("h1",{id:"introduction"},"Introduction"),(0,n.yg)("p",null,"This repository contains a collection of community supported modules for ",(0,n.yg)("a",{parentName:"p",href:"https://deck.gl"},"deck.gl"),", that are intended to complement the various modules already provided by the core deck.gl framework. While any module that is properly scoped and of sufficient value to the community could be a candidate for this repository, common modules type are:"),(0,n.yg)("ul",null,(0,n.yg)("li",{parentName:"ul"},"additional ",(0,n.yg)("strong",{parentName:"li"},"layer packs")," (beyond the various layer packs available in deck.gl)"),(0,n.yg)("li",{parentName:"ul"},"additional ",(0,n.yg)("strong",{parentName:"li"},"base map")," integrations (beyond the integrations supported by deck.gl)"),(0,n.yg)("li",{parentName:"ul"},"additional ",(0,n.yg)("strong",{parentName:"li"},"react")," bindings (beyond the ",(0,n.yg)("inlineCode",{parentName:"li"},"@deck.gl/react")," module).")),(0,n.yg)("h2",{id:"support"},"Support"),(0,n.yg)("p",null,"Community modules are not officially supported by the core deck.gl maintainers, but have at least some intermittent, part-time support from one or more community members."),(0,n.yg)("p",null,"Note that the continued inclusion of each module into this repository depends to a large extent on whether there is sufficient community support for the module. Modules can be removed from this repository if the core deck.gl team feels that the community is no longer able to provide sufficient support."),(0,n.yg)("p",null,"If a module was to be removed, applications can of course copy the module's source code, but will need to maintain the code on their own."),(0,n.yg)("h2",{id:"contributing"},"Contributing"),(0,n.yg)("p",null,"If you have a module that you think could fit into this repository, please start by opening a GitHub issue to start a discussion, or reach out in the OpenJS slack."),(0,n.yg)("h2",{id:"upstreaming"},"Upstreaming"),(0,n.yg)("p",null,'On rare occasions, a new component or module may be "upstreamed" into the core deck.gl repository. '),(0,n.yg)("p",null,"There is a high bar when adding new code to the main deck.gl repository. The deck.gl-community repository is sometimes used to prepare (incubate) new software components so that they are ready to be added to deck.gl. "),(0,n.yg)("p",null,"Therefore when proposing the addition of a new component (such as a new deck.gl layer),\nto the core deck.gl maintainers, it is helpful to be able to prepare the component in a monorepo environment that is similar to the deck.gl repo, complete with tests, documentation and examples. This can avoid a length and frustrating review process in the deck.gl repo."),(0,n.yg)("p",null,"To set expectations, most components in this repository will never be added to the main deck.gl repository."))}d.isMDXComponent=!0}}]);