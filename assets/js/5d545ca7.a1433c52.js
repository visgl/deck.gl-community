"use strict";(self.webpackChunkproject_website=self.webpackChunkproject_website||[]).push([[3263],{5680:(e,r,t)=>{t.d(r,{xA:()=>p,yg:()=>y});var a=t(6540);function n(e,r,t){return r in e?Object.defineProperty(e,r,{value:t,enumerable:!0,configurable:!0,writable:!0}):e[r]=t,e}function o(e,r){var t=Object.keys(e);if(Object.getOwnPropertySymbols){var a=Object.getOwnPropertySymbols(e);r&&(a=a.filter((function(r){return Object.getOwnPropertyDescriptor(e,r).enumerable}))),t.push.apply(t,a)}return t}function i(e){for(var r=1;r<arguments.length;r++){var t=null!=arguments[r]?arguments[r]:{};r%2?o(Object(t),!0).forEach((function(r){n(e,r,t[r])})):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(t)):o(Object(t)).forEach((function(r){Object.defineProperty(e,r,Object.getOwnPropertyDescriptor(t,r))}))}return e}function l(e,r){if(null==e)return{};var t,a,n=function(e,r){if(null==e)return{};var t,a,n={},o=Object.keys(e);for(a=0;a<o.length;a++)t=o[a],r.indexOf(t)>=0||(n[t]=e[t]);return n}(e,r);if(Object.getOwnPropertySymbols){var o=Object.getOwnPropertySymbols(e);for(a=0;a<o.length;a++)t=o[a],r.indexOf(t)>=0||Object.prototype.propertyIsEnumerable.call(e,t)&&(n[t]=e[t])}return n}var d=a.createContext({}),c=function(e){var r=a.useContext(d),t=r;return e&&(t="function"==typeof e?e(r):i(i({},r),e)),t},p=function(e){var r=c(e.components);return a.createElement(d.Provider,{value:r},e.children)},s="mdxType",g={inlineCode:"code",wrapper:function(e){var r=e.children;return a.createElement(a.Fragment,{},r)}},u=a.forwardRef((function(e,r){var t=e.components,n=e.mdxType,o=e.originalType,d=e.parentName,p=l(e,["components","mdxType","originalType","parentName"]),s=c(t),u=n,y=s["".concat(d,".").concat(u)]||s[u]||g[u]||o;return t?a.createElement(y,i(i({ref:r},p),{},{components:t})):a.createElement(y,i({ref:r},p))}));function y(e,r){var t=arguments,n=r&&r.mdxType;if("string"==typeof e||n){var o=t.length,i=new Array(o);i[0]=u;var l={};for(var d in r)hasOwnProperty.call(r,d)&&(l[d]=r[d]);l.originalType=e,l[s]="string"==typeof e?e:n,i[1]=l;for(var c=2;c<o;c++)i[c]=t[c];return a.createElement.apply(null,i)}return a.createElement.apply(null,t)}u.displayName="MDXCreateElement"},9032:(e,r,t)=>{t.r(r),t.d(r,{assets:()=>d,contentTitle:()=>i,default:()=>g,frontMatter:()=>o,metadata:()=>l,toc:()=>c});var a=t(8168),n=(t(6540),t(5680));const o={},i="GraphGL (React)",l={unversionedId:"modules/react-graph-layers/api-reference/graphgl",id:"modules/react-graph-layers/api-reference/graphgl",title:"GraphGL (React)",description:"Usage",source:"@site/../docs/modules/react-graph-layers/api-reference/graphgl.md",sourceDirName:"modules/react-graph-layers/api-reference",slug:"/modules/react-graph-layers/api-reference/graphgl",permalink:"/deck.gl-community/docs/modules/react-graph-layers/api-reference/graphgl",draft:!1,editUrl:"https://github.com/visgl/deck.gl-community/tree/master/website/../docs/modules/react-graph-layers/api-reference/graphgl.md",tags:[],version:"current",frontMatter:{},sidebar:"tutorialSidebar",previous:{title:"Overview",permalink:"/deck.gl-community/docs/modules/react-graph-layers/"},next:{title:"Viewport (React)",permalink:"/deck.gl-community/docs/modules/react-graph-layers/api-reference/viewport"}},d={},c=[{value:"Usage",id:"usage",level:3},{value:"<code>graph</code> (Graph, required)",id:"graph-graph-required",level:3},{value:"<code>layout</code> (Layout, required)",id:"layout-layout-required",level:3},{value:"<code>initialViewState</code> (Object, optional)",id:"initialviewstate-object-optional",level:3},{value:"<code>nodeStyle</code> (Array, required)",id:"nodestyle-array-required",level:3},{value:"<code>nodeEvents</code> (Object, optional)",id:"nodeevents-object-optional",level:3},{value:"<code>edgeStyle</code> (Object | Array, required)",id:"edgestyle-object--array-required",level:3},{value:"<code>edgeEvents</code> (Object, optional)",id:"edgeevents-object-optional",level:3}],p={toc:c},s="wrapper";function g(e){let{components:r,...t}=e;return(0,n.yg)(s,(0,a.A)({},p,t,{components:r,mdxType:"MDXLayout"}),(0,n.yg)("h1",{id:"graphgl-react"},"GraphGL (React)"),(0,n.yg)("p",{align:"center"},(0,n.yg)("img",{src:"/gatsby/images/graph.png",height:"200"})),(0,n.yg)("h3",{id:"usage"},"Usage"),(0,n.yg)("pre",null,(0,n.yg)("code",{parentName:"pre",className:"language-js"},"import GraphGL, {JSONLoader, NODE_TYPE, D3ForceLayout} from 'react-graph-layers';\n\nconst App = ({data}) => {\n  const graph = JSONLoader({\n    json: data,\n    nodeParser: (node) => ({id: node.id}),\n    edgeParser: (edge) => ({\n      id: edge.id,\n      sourceId: edge.sourceId,\n      targetId: edge.targetId,\n      directed: true\n    })\n  });\n  return (\n    <GraphGL\n      graph={graph}\n      layout={new D3ForceLayout()}\n      nodeStyle={[\n        {\n          type: NODE_TYPE.CIRCLE,\n          radius: 10,\n          fill: 'blue',\n          opacity: 1\n        }\n      ]}\n      edgeStyle={{\n        stroke: 'black',\n        strokeWidth: 2\n      }}\n      enableDragging\n    />\n  );\n};\n")),(0,n.yg)("h3",{id:"graph-graph-required"},(0,n.yg)("inlineCode",{parentName:"h3"},"graph")," (Graph, required)"),(0,n.yg)("p",null,"The graph data will need to be processed through JSONLoader and converted into ",(0,n.yg)("inlineCode",{parentName:"p"},"Graph")," object. The expected data should be an object includes two arrays: ",(0,n.yg)("inlineCode",{parentName:"p"},"nodes")," and ",(0,n.yg)("inlineCode",{parentName:"p"},"edges"),". Each node require an unique ",(0,n.yg)("inlineCode",{parentName:"p"},"id"),". Each edge should have ",(0,n.yg)("inlineCode",{parentName:"p"},"id")," as edge ID, ",(0,n.yg)("inlineCode",{parentName:"p"},"sourceId")," as the ID of the source node, and ",(0,n.yg)("inlineCode",{parentName:"p"},"targetId")," as the ID of the target node. For example:"),(0,n.yg)("pre",null,(0,n.yg)("code",{parentName:"pre",className:"language-js"},"const data = {\n  nodes: [{id: '1'}, {id: '2'}, {id: '3'}],\n  edges: [\n    {id: 'e1', sourceId: '1', targetId: '2'},\n    {id: 'e2', sourceId: '1', targetId: '3'},\n    {id: 'e3', sourceId: '2', targetId: '3'}\n  ]\n};\n")),(0,n.yg)("p",null,"Then, you can convert the data into ",(0,n.yg)("inlineCode",{parentName:"p"},"Graph")," by ",(0,n.yg)("inlineCode",{parentName:"p"},"JSONLoader"),":"),(0,n.yg)("pre",null,(0,n.yg)("code",{parentName:"pre",className:"language-js"},"import {JSONLoader} from 'react-graph-layers';\nconst graph = JSONLoader({json: data});\n")),(0,n.yg)("h3",{id:"layout-layout-required"},(0,n.yg)("inlineCode",{parentName:"h3"},"layout")," (Layout, required)"),(0,n.yg)("p",null,"Use one of the layouts provided by react-graph-layers or create a new custom layout class by following the instruction. For more detail, please see the Layout docs/api-reference/layout section."),(0,n.yg)("h3",{id:"initialviewstate-object-optional"},(0,n.yg)("inlineCode",{parentName:"h3"},"initialViewState")," (Object, optional)"),(0,n.yg)("p",null,"For more detail, please see /docs/api-reference/viewport."),(0,n.yg)("h3",{id:"nodestyle-array-required"},(0,n.yg)("inlineCode",{parentName:"h3"},"nodeStyle")," (Array, required)"),(0,n.yg)("p",null,"A node is made of a set of layers. nodeStyle is a set of style objects to describe the style for each layer.\nFor more detail, please see the (explanation of nodeStyle](docs/api-reference/node-style)."),(0,n.yg)("h3",{id:"nodeevents-object-optional"},(0,n.yg)("inlineCode",{parentName:"h3"},"nodeEvents")," (Object, optional)"),(0,n.yg)("p",null,"For more detail, please see the interactions reference /docs/api-reference/interactions."),(0,n.yg)("h3",{id:"edgestyle-object--array-required"},(0,n.yg)("inlineCode",{parentName:"h3"},"edgeStyle")," (Object | Array, required)"),(0,n.yg)("p",null,"For more detail, please see the explanation of edgeStyle docs/api-reference/edge-style"),(0,n.yg)("h3",{id:"edgeevents-object-optional"},(0,n.yg)("inlineCode",{parentName:"h3"},"edgeEvents")," (Object, optional)"),(0,n.yg)("p",null,"For more detail, please see api-reference interactions docs/api-reference/interactions."))}g.isMDXComponent=!0}}]);