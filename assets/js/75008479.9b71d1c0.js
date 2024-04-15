"use strict";(self.webpackChunkproject_website=self.webpackChunkproject_website||[]).push([[7855],{5680:(e,t,a)=>{a.d(t,{xA:()=>y,yg:()=>u});var n=a(6540);function r(e,t,a){return t in e?Object.defineProperty(e,t,{value:a,enumerable:!0,configurable:!0,writable:!0}):e[t]=a,e}function l(e,t){var a=Object.keys(e);if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e);t&&(n=n.filter((function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable}))),a.push.apply(a,n)}return a}function i(e){for(var t=1;t<arguments.length;t++){var a=null!=arguments[t]?arguments[t]:{};t%2?l(Object(a),!0).forEach((function(t){r(e,t,a[t])})):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(a)):l(Object(a)).forEach((function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(a,t))}))}return e}function o(e,t){if(null==e)return{};var a,n,r=function(e,t){if(null==e)return{};var a,n,r={},l=Object.keys(e);for(n=0;n<l.length;n++)a=l[n],t.indexOf(a)>=0||(r[a]=e[a]);return r}(e,t);if(Object.getOwnPropertySymbols){var l=Object.getOwnPropertySymbols(e);for(n=0;n<l.length;n++)a=l[n],t.indexOf(a)>=0||Object.prototype.propertyIsEnumerable.call(e,a)&&(r[a]=e[a])}return r}var d=n.createContext({}),p=function(e){var t=n.useContext(d),a=t;return e&&(a="function"==typeof e?e(t):i(i({},t),e)),a},y=function(e){var t=p(e.components);return n.createElement(d.Provider,{value:t},e.children)},g="mdxType",s={inlineCode:"code",wrapper:function(e){var t=e.children;return n.createElement(n.Fragment,{},t)}},c=n.forwardRef((function(e,t){var a=e.components,r=e.mdxType,l=e.originalType,d=e.parentName,y=o(e,["components","mdxType","originalType","parentName"]),g=p(a),c=r,u=g["".concat(d,".").concat(c)]||g[c]||s[c]||l;return a?n.createElement(u,i(i({ref:t},y),{},{components:a})):n.createElement(u,i({ref:t},y))}));function u(e,t){var a=arguments,r=t&&t.mdxType;if("string"==typeof e||r){var l=a.length,i=new Array(l);i[0]=c;var o={};for(var d in t)hasOwnProperty.call(t,d)&&(o[d]=t[d]);o.originalType=e,o[g]="string"==typeof e?e:r,i[1]=o;for(var p=2;p<l;p++)i[p]=a[p];return n.createElement.apply(null,i)}return n.createElement.apply(null,a)}c.displayName="MDXCreateElement"},2280:(e,t,a)=>{a.r(t),a.d(t,{assets:()=>d,contentTitle:()=>i,default:()=>s,frontMatter:()=>l,metadata:()=>o,toc:()=>p});var n=a(8168),r=(a(6540),a(5680));const l={},i="Overview",o={unversionedId:"modules/editable-layers/README",id:"modules/editable-layers/README",title:"Overview",description:"Provides editable and interactive map overlay layers, built using the power of deck.gl.",source:"@site/../docs/modules/editable-layers/README.md",sourceDirName:"modules/editable-layers",slug:"/modules/editable-layers/",permalink:"/deck.gl-community/docs/modules/editable-layers/",draft:!1,editUrl:"https://github.com/visgl/deck.gl-community/tree/master/website/../docs/modules/editable-layers/README.md",tags:[],version:"current",frontMatter:{},sidebar:"tutorialSidebar",previous:{title:"DataDrivenTile3DLayer",permalink:"/deck.gl-community/docs/modules/layers/api-reference/data-driven-tile-3d-layer"},next:{title:"Developer Guide",permalink:"/deck.gl-community/docs/modules/editable-layers/developer-guide/get-started"}},d={},p=[{value:"History",id:"history",level:2},{value:"What&#39;s New",id:"whats-new",level:2},{value:"editable-layers v9.0",id:"editable-layers-v90",level:3},{value:"editable-layers v0.0.1",id:"editable-layers-v001",level:3}],y={toc:p},g="wrapper";function s(e){let{components:t,...a}=e;return(0,r.yg)(g,(0,n.A)({},y,a,{components:t,mdxType:"MDXLayout"}),(0,r.yg)("h1",{id:"overview"},"Overview"),(0,r.yg)("p",null,"Provides editable and interactive map overlay layers, built using the power of ",(0,r.yg)("a",{parentName:"p",href:"https://deck.gl/"},"deck.gl"),"."),(0,r.yg)("h2",{id:"history"},"History"),(0,r.yg)("p",null,"A fork of @nebula.gl. nebula.gl is an important part of the deck.gl ecosystem but the repository has lacked maintainers for several years and the repository no longer accepts external contributions."),(0,r.yg)("h2",{id:"whats-new"},"What's New"),(0,r.yg)("p",null,"This page contains highlights of each ",(0,r.yg)("inlineCode",{parentName:"p"},"editable-layers")," release."),(0,r.yg)("h3",{id:"editable-layers-v90"},"editable-layers v9.0"),(0,r.yg)("ul",null,(0,r.yg)("li",{parentName:"ul"},"The code has been updated to work with deck.gl v9. "),(0,r.yg)("li",{parentName:"ul"},"The module structure has been simplified via the module mapping in the table below.")),(0,r.yg)("table",null,(0,r.yg)("thead",{parentName:"table"},(0,r.yg)("tr",{parentName:"thead"},(0,r.yg)("th",{parentName:"tr",align:null},"@deck.gl-community/editable-layers module"),(0,r.yg)("th",{parentName:"tr",align:null},"Description"),(0,r.yg)("th",{parentName:"tr",align:null},"deck.gl-community module"))),(0,r.yg)("tbody",{parentName:"table"},(0,r.yg)("tr",{parentName:"tbody"},(0,r.yg)("td",{parentName:"tr",align:null},"nebula.gl"),(0,r.yg)("td",{parentName:"tr",align:null},"The core module"),(0,r.yg)("td",{parentName:"tr",align:null},"=> ",(0,r.yg)("inlineCode",{parentName:"td"},"@deck.gl-community/editable-layers"))),(0,r.yg)("tr",{parentName:"tbody"},(0,r.yg)("td",{parentName:"tr",align:null},(0,r.yg)("inlineCode",{parentName:"td"},"@nebula.gl/edit-modes")),(0,r.yg)("td",{parentName:"tr",align:null},"Optional edit modes"),(0,r.yg)("td",{parentName:"tr",align:null},"=> ",(0,r.yg)("inlineCode",{parentName:"td"},"@deck.gl-community/editable-layers"))),(0,r.yg)("tr",{parentName:"tbody"},(0,r.yg)("td",{parentName:"tr",align:null},(0,r.yg)("inlineCode",{parentName:"td"},"@nebula.gl/layers")),(0,r.yg)("td",{parentName:"tr",align:null},"The actual layers"),(0,r.yg)("td",{parentName:"tr",align:null},"=> ",(0,r.yg)("inlineCode",{parentName:"td"},"@deck.gl-community/editable-layers"))),(0,r.yg)("tr",{parentName:"tbody"},(0,r.yg)("td",{parentName:"tr",align:null},(0,r.yg)("inlineCode",{parentName:"td"},"@nebula.gl/overlays")),(0,r.yg)("td",{parentName:"tr",align:null},"React overlays"),(0,r.yg)("td",{parentName:"tr",align:null},"=> ",(0,r.yg)("inlineCode",{parentName:"td"},"@deck.gl-community/react"))),(0,r.yg)("tr",{parentName:"tbody"},(0,r.yg)("td",{parentName:"tr",align:null},(0,r.yg)("inlineCode",{parentName:"td"},"@nebula.gl/editor")),(0,r.yg)("td",{parentName:"tr",align:null},"React wrappers"),(0,r.yg)("td",{parentName:"tr",align:null},"=> ",(0,r.yg)("inlineCode",{parentName:"td"},"@deck.gl-community/react-editable-layers"))),(0,r.yg)("tr",{parentName:"tbody"},(0,r.yg)("td",{parentName:"tr",align:null},(0,r.yg)("inlineCode",{parentName:"td"},"react-map-gl-draw")),(0,r.yg)("td",{parentName:"tr",align:null},"Non-deck-wrapper"),(0,r.yg)("td",{parentName:"tr",align:null},"=> NOT FORKED")))),(0,r.yg)("h3",{id:"editable-layers-v001"},"editable-layers v0.0.1"),(0,r.yg)("p",null,"Release date: TBD"),(0,r.yg)("ul",null,(0,r.yg)("li",{parentName:"ul"},"new ",(0,r.yg)("inlineCode",{parentName:"li"},"DrawRectangleFromCenterMode"),". User can draw a new rectangular ",(0,r.yg)("inlineCode",{parentName:"li"},"Polygon")," feature by clicking the center, then along a corner of the rectangle."),(0,r.yg)("li",{parentName:"ul"},(0,r.yg)("inlineCode",{parentName:"li"},"screenSpace")," option can be provided in the ",(0,r.yg)("inlineCode",{parentName:"li"},"modeConfig")," of Translate mode so the features will be translated without distortion in screen space."),(0,r.yg)("li",{parentName:"ul"},(0,r.yg)("inlineCode",{parentName:"li"},"lockRectangles")," option can be provided in the ",(0,r.yg)("inlineCode",{parentName:"li"},"modeConfig")," object for ModifyMode, so the features with ",(0,r.yg)("inlineCode",{parentName:"li"},"properties.shape === 'Rectangle'")," will preserve rectangular shape."),(0,r.yg)("li",{parentName:"ul"},(0,r.yg)("inlineCode",{parentName:"li"},"pickingLineWidthExtraPixels")," property to specify additional line width in pixels for picking. Can be useful when ",(0,r.yg)("inlineCode",{parentName:"li"},"EditableGeojsonLayer")," is over a deck.gl layer and precise picking is problematic, and when usage of ",(0,r.yg)("inlineCode",{parentName:"li"},"pickingDepth")," introduces performance issues.")))}s.isMDXComponent=!0}}]);