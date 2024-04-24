"use strict";(self.webpackChunkproject_website=self.webpackChunkproject_website||[]).push([[7424],{5680:(e,t,o)=>{o.d(t,{xA:()=>c,yg:()=>y});var n=o(6540);function r(e,t,o){return t in e?Object.defineProperty(e,t,{value:o,enumerable:!0,configurable:!0,writable:!0}):e[t]=o,e}function i(e,t){var o=Object.keys(e);if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e);t&&(n=n.filter((function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable}))),o.push.apply(o,n)}return o}function a(e){for(var t=1;t<arguments.length;t++){var o=null!=arguments[t]?arguments[t]:{};t%2?i(Object(o),!0).forEach((function(t){r(e,t,o[t])})):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(o)):i(Object(o)).forEach((function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(o,t))}))}return e}function l(e,t){if(null==e)return{};var o,n,r=function(e,t){if(null==e)return{};var o,n,r={},i=Object.keys(e);for(n=0;n<i.length;n++)o=i[n],t.indexOf(o)>=0||(r[o]=e[o]);return r}(e,t);if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(e);for(n=0;n<i.length;n++)o=i[n],t.indexOf(o)>=0||Object.prototype.propertyIsEnumerable.call(e,o)&&(r[o]=e[o])}return r}var s=n.createContext({}),u=function(e){var t=n.useContext(s),o=t;return e&&(o="function"==typeof e?e(t):a(a({},t),e)),o},c=function(e){var t=u(e.components);return n.createElement(s.Provider,{value:t},e.children)},p="mdxType",d={inlineCode:"code",wrapper:function(e){var t=e.children;return n.createElement(n.Fragment,{},t)}},m=n.forwardRef((function(e,t){var o=e.components,r=e.mdxType,i=e.originalType,s=e.parentName,c=l(e,["components","mdxType","originalType","parentName"]),p=u(o),m=r,y=p["".concat(s,".").concat(m)]||p[m]||d[m]||i;return o?n.createElement(y,a(a({ref:t},c),{},{components:o})):n.createElement(y,a({ref:t},c))}));function y(e,t){var o=arguments,r=t&&t.mdxType;if("string"==typeof e||r){var i=o.length,a=new Array(i);a[0]=m;var l={};for(var s in t)hasOwnProperty.call(t,s)&&(l[s]=t[s]);l.originalType=e,l[p]="string"==typeof e?e:r,a[1]=l;for(var u=2;u<i;u++)a[u]=o[u];return n.createElement.apply(null,a)}return n.createElement.apply(null,o)}m.displayName="MDXCreateElement"},2580:(e,t,o)=>{o.r(t),o.d(t,{assets:()=>s,contentTitle:()=>a,default:()=>d,frontMatter:()=>i,metadata:()=>l,toc:()=>u});var n=o(8168),r=(o(6540),o(5680));const i={},a="Introduction",l={unversionedId:"README",id:"README",title:"Introduction",description:"This repository contains a collection of community supported modules for deck.gl.",source:"@site/../docs/README.md",sourceDirName:".",slug:"/",permalink:"/deck.gl-community/docs/",draft:!1,editUrl:"https://github.com/visgl/deck.gl-community/tree/master/website/../docs/README.md",tags:[],version:"current",frontMatter:{},sidebar:"tutorialSidebar",next:{title:"What's New",permalink:"/deck.gl-community/docs/whats-new"}},s={},u=[{value:"Scope",id:"scope",level:2},{value:"Contributing",id:"contributing",level:2},{value:"Governance",id:"governance",level:2},{value:"Support",id:"support",level:2},{value:"Insufficient Support",id:"insufficient-support",level:2}],c={toc:u},p="wrapper";function d(e){let{components:t,...o}=e;return(0,r.yg)(p,(0,n.A)({},c,o,{components:t,mdxType:"MDXLayout"}),(0,r.yg)("h1",{id:"introduction"},"Introduction"),(0,r.yg)("p",null,"This repository contains a collection of community supported modules for ",(0,r.yg)("a",{parentName:"p",href:"https://deck.gl"},"deck.gl"),".\nIt was initially created to provide a home for a number of excellent deck.gl add-on modules that had fallen into disuse."),(0,r.yg)("h2",{id:"scope"},"Scope"),(0,r.yg)("p",null,"This repository is intended to host modules that complement the various modules already provided by the core deck.gl framework.\nWhile any module that is properly scoped and of sufficient value to the community could be a candidate for this repository,\ncommon modules type are:"),(0,r.yg)("ul",null,(0,r.yg)("li",{parentName:"ul"},"additional ",(0,r.yg)("strong",{parentName:"li"},"layer packs")," (beyond the various layer packs available in deck.gl)"),(0,r.yg)("li",{parentName:"ul"},"additional ",(0,r.yg)("strong",{parentName:"li"},"base map")," integrations (beyond the integrations supported by deck.gl)"),(0,r.yg)("li",{parentName:"ul"},"additional ",(0,r.yg)("strong",{parentName:"li"},"React bindings")," (beyond the ",(0,r.yg)("inlineCode",{parentName:"li"},"@deck.gl/react")," module).")),(0,r.yg)("h2",{id:"contributing"},"Contributing"),(0,r.yg)("p",null,"For extensions to existing modules, it is generally recommended to start a discussion before you open a PR."),(0,r.yg)("p",null,"If you have a new module that you think could fit into this repository, please start by opening a GitHub issue to start a discussion, or reach out in the OpenJS slack.\nNote that for a new module you will also be asked to asses what level of maintenance you will be able to provide over the longer term."),(0,r.yg)("h2",{id:"governance"},"Governance"),(0,r.yg)("p",null,"Final decision ultimately rest with the OpenJS Open Visualization TSC (Technical Steering Committee), but decisions are often made in the open bi-weekly meetings."),(0,r.yg)("h2",{id:"support"},"Support"),(0,r.yg)("p",null,"Community modules are not officially supported by the core deck.gl maintainers,\nbut are expected to have at least intermittent, part-time support from one or more community members."),(0,r.yg)("p",null,"Overall goals for this repo is"),(0,r.yg)("ul",null,(0,r.yg)("li",{parentName:"ul"},"All modules should support deck.gl v9 on WebGL2."),(0,r.yg)("li",{parentName:"ul"},"Modules will be expected to gradually start supporting deck.gl v9 on WebGPU "),(0,r.yg)("li",{parentName:"ul"},"Support for deck.gl v8 is a non-goal, though one or two modules may have older versions that still work.")),(0,r.yg)("h2",{id:"insufficient-support"},"Insufficient Support"),(0,r.yg)("p",null,"Note that the continued inclusion of each module into this repository depends to a large extent on whether there is sufficient community support for the module.\nModules can be removed from this repository if the core deck.gl team feels that the community is no longer able to provide sufficient support."),(0,r.yg)("p",null,"If a module was to be removed, applications can of course copy the module's source code, but will need to maintain the code on their own."))}d.isMDXComponent=!0}}]);