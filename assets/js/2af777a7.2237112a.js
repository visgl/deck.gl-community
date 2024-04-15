"use strict";(self.webpackChunkproject_website=self.webpackChunkproject_website||[]).push([[5607],{5680:(e,t,r)=>{r.d(t,{xA:()=>u,yg:()=>y});var n=r(6540);function a(e,t,r){return t in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e}function d(e,t){var r=Object.keys(e);if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e);t&&(n=n.filter((function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable}))),r.push.apply(r,n)}return r}function l(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{};t%2?d(Object(r),!0).forEach((function(t){a(e,t,r[t])})):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):d(Object(r)).forEach((function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))}))}return e}function o(e,t){if(null==e)return{};var r,n,a=function(e,t){if(null==e)return{};var r,n,a={},d=Object.keys(e);for(n=0;n<d.length;n++)r=d[n],t.indexOf(r)>=0||(a[r]=e[r]);return a}(e,t);if(Object.getOwnPropertySymbols){var d=Object.getOwnPropertySymbols(e);for(n=0;n<d.length;n++)r=d[n],t.indexOf(r)>=0||Object.prototype.propertyIsEnumerable.call(e,r)&&(a[r]=e[r])}return a}var i=n.createContext({}),g=function(e){var t=n.useContext(i),r=t;return e&&(r="function"==typeof e?e(t):l(l({},t),e)),r},u=function(e){var t=g(e.components);return n.createElement(i.Provider,{value:t},e.children)},s="mdxType",c={inlineCode:"code",wrapper:function(e){var t=e.children;return n.createElement(n.Fragment,{},t)}},p=n.forwardRef((function(e,t){var r=e.components,a=e.mdxType,d=e.originalType,i=e.parentName,u=o(e,["components","mdxType","originalType","parentName"]),s=g(r),p=a,y=s["".concat(i,".").concat(p)]||s[p]||c[p]||d;return r?n.createElement(y,l(l({ref:t},u),{},{components:r})):n.createElement(y,l({ref:t},u))}));function y(e,t){var r=arguments,a=t&&t.mdxType;if("string"==typeof e||a){var d=r.length,l=new Array(d);l[0]=p;var o={};for(var i in t)hasOwnProperty.call(t,i)&&(o[i]=t[i]);o.originalType=e,o[s]="string"==typeof e?e:a,l[1]=o;for(var g=2;g<d;g++)l[g]=r[g];return n.createElement.apply(null,l)}return n.createElement.apply(null,r)}p.displayName="MDXCreateElement"},9373:(e,t,r)=>{r.r(t),r.d(t,{assets:()=>i,contentTitle:()=>l,default:()=>c,frontMatter:()=>d,metadata:()=>o,toc:()=>g});var n=r(8168),a=(r(6540),r(5680));const d={},l="Node Class",o={unversionedId:"modules/graph-layers/api-reference/node",id:"modules/graph-layers/api-reference/node",title:"Node Class",description:"The Node class is the base class of the node, which provides a list of basic util functions to be used through out the applications.",source:"@site/../docs/modules/graph-layers/api-reference/node.md",sourceDirName:"modules/graph-layers/api-reference",slug:"/modules/graph-layers/api-reference/node",permalink:"/deck.gl-community/docs/modules/graph-layers/api-reference/node",draft:!1,editUrl:"https://github.com/visgl/deck.gl-community/tree/master/website/../docs/modules/graph-layers/api-reference/node.md",tags:[],version:"current",frontMatter:{},sidebar:"tutorialSidebar",previous:{title:"Graph Class",permalink:"/deck.gl-community/docs/modules/graph-layers/api-reference/graph"},next:{title:"Edge Class",permalink:"/deck.gl-community/docs/modules/graph-layers/api-reference/edge"}},i={},g=[{value:"Constructor",id:"constructor",level:2},{value:"Basic Properties",id:"basic-properties",level:3},{value:"<code>id</code> (String|Number, required)",id:"id-stringnumber-required",level:5},{value:"<code>data</code> (Object, optional)",id:"data-object-optional",level:5},{value:"getConnectedEdges()",id:"getconnectededges",level:2},{value:"getDegree()",id:"getdegree",level:2},{value:"getId()",id:"getid",level:2},{value:"getInDegree()",id:"getindegree",level:2},{value:"getOutDegree()",id:"getoutdegree",level:2},{value:"getPropertyValue(key)",id:"getpropertyvaluekey",level:2},{value:"<code>key</code> (String|Number, required)",id:"key-stringnumber-required",level:5},{value:"getSiblingIds()",id:"getsiblingids",level:2},{value:"setData(data)",id:"setdatadata",level:2},{value:"<code>data</code> (Any, required)",id:"data-any-required",level:5},{value:"setDataProperty(key, value)",id:"setdatapropertykey-value",level:2},{value:"<code>key</code> (String, required)",id:"key-string-required",level:5},{value:"<code>value</code> (Any, required)",id:"value-any-required",level:5},{value:"addConnectedEdges(edges)",id:"addconnectededgesedges",level:2},{value:"removeConnectedEdges(edges)",id:"removeconnectededgesedges",level:2},{value:"clearConnectedEdges()",id:"clearconnectededges",level:2}],u={toc:g},s="wrapper";function c(e){let{components:t,...r}=e;return(0,a.yg)(s,(0,n.A)({},u,r,{components:t,mdxType:"MDXLayout"}),(0,a.yg)("h1",{id:"node-class"},"Node Class"),(0,a.yg)("p",null,"The ",(0,a.yg)("inlineCode",{parentName:"p"},"Node")," class is the base class of the node, which provides a list of basic util functions to be used through out the applications."),(0,a.yg)("h2",{id:"constructor"},"Constructor"),(0,a.yg)("pre",null,(0,a.yg)("code",{parentName:"pre",className:"language-js"},"new Node(props);\n")),(0,a.yg)("p",null,"Parameters:"),(0,a.yg)("ul",null,(0,a.yg)("li",{parentName:"ul"},(0,a.yg)("inlineCode",{parentName:"li"},"props")," (Object) - ",(0,a.yg)("inlineCode",{parentName:"li"},"Node")," properties.")),(0,a.yg)("h3",{id:"basic-properties"},"Basic Properties"),(0,a.yg)("h5",{id:"id-stringnumber-required"},(0,a.yg)("inlineCode",{parentName:"h5"},"id")," (String|Number, required)"),(0,a.yg)("p",null,"The ",(0,a.yg)("inlineCode",{parentName:"p"},"id")," must be unique among all nodes in the graph at a given time."),(0,a.yg)("h5",{id:"data-object-optional"},(0,a.yg)("inlineCode",{parentName:"h5"},"data")," (Object, optional)"),(0,a.yg)("ul",null,(0,a.yg)("li",{parentName:"ul"},"Default: ",(0,a.yg)("inlineCode",{parentName:"li"},"{}"))),(0,a.yg)("p",null,"The origin node data."),(0,a.yg)("h2",{id:"getconnectededges"},"getConnectedEdges()"),(0,a.yg)("p",null,"Return all the connected edges."),(0,a.yg)("h2",{id:"getdegree"},"getDegree()"),(0,a.yg)("p",null,"Return the degree of the node -- includes in-degree and out-degree"),(0,a.yg)("h2",{id:"getid"},"getId()"),(0,a.yg)("p",null,"Return the ID of the node."),(0,a.yg)("h2",{id:"getindegree"},"getInDegree()"),(0,a.yg)("p",null,"Return the in-degree of the node."),(0,a.yg)("h2",{id:"getoutdegree"},"getOutDegree()"),(0,a.yg)("p",null,"Return the out-degree of the node."),(0,a.yg)("h2",{id:"getpropertyvaluekey"},"getPropertyValue(key)"),(0,a.yg)("p",null,"Return of the value of the selected property key."),(0,a.yg)("h5",{id:"key-stringnumber-required"},(0,a.yg)("inlineCode",{parentName:"h5"},"key")," (String|Number, required)"),(0,a.yg)("p",null,"The property key."),(0,a.yg)("h2",{id:"getsiblingids"},"getSiblingIds()"),(0,a.yg)("p",null,"Return all the IDs of the sibling nodes."),(0,a.yg)("h2",{id:"setdatadata"},"setData(data)"),(0,a.yg)("p",null,"Set the new node data."),(0,a.yg)("h5",{id:"data-any-required"},(0,a.yg)("inlineCode",{parentName:"h5"},"data")," (Any, required)"),(0,a.yg)("p",null,"The new data of the node."),(0,a.yg)("h2",{id:"setdatapropertykey-value"},"setDataProperty(key, value)"),(0,a.yg)("p",null,"Update a data property."),(0,a.yg)("h5",{id:"key-string-required"},(0,a.yg)("inlineCode",{parentName:"h5"},"key")," (String, required)"),(0,a.yg)("p",null,"The key of the property"),(0,a.yg)("h5",{id:"value-any-required"},(0,a.yg)("inlineCode",{parentName:"h5"},"value")," (Any, required)"),(0,a.yg)("p",null,"The value of the property."),(0,a.yg)("h2",{id:"addconnectededgesedges"},"addConnectedEdges(edges)"),(0,a.yg)("p",null,"Add new connected edges to the node."),(0,a.yg)("h2",{id:"removeconnectededgesedges"},"removeConnectedEdges(edges)"),(0,a.yg)("p",null,"Remove edges from ",(0,a.yg)("inlineCode",{parentName:"p"},"this._connectedEdges")),(0,a.yg)("h2",{id:"clearconnectededges"},"clearConnectedEdges()"),(0,a.yg)("p",null,"Clear ",(0,a.yg)("inlineCode",{parentName:"p"},"this._connectedEdges")))}c.isMDXComponent=!0}}]);