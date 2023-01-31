# Experimental Layouts

<style>
.bg-white {
  background: #aaa;
  color: #ededed;
}
.layout-card {
  background: white;
  cursor: pointer;
  position: relative;
  width: 250px;
  height: 250px;
  display: inline-block;
  line-height: 0;
}
.layout-card img {
  transition: opacity .4s;
}
.layout-card>div:after {
  font-size: 0.833em;
  content: attr(data-name);
  padding: 5%;
  left: 0;
  width: 80%;
  height: 80%;
  margin: 10%;
  top: 0;
  left: 0;
  border: solid 2px;
  border-image-slice: 2;
  box-sizing: border-box;
}
.layout-card>div:before {
  content: attr(data-title);
  font-size: 1.4em;
  font-weight: 100;
  width: 100%;
  padding: 12%;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
}
.layout-card>div:after,
.layout-card>div:before {
  display: block;
  z-index: 1;
  position: absolute;
  transition: opacity .4s;
  opacity: 0;
  text-align: center;
  pointer-events: none;
  box-sizing: border-box;
  line-height: 1.5;
}
.layout-card>div:hover img {
  opacity: 0.2;
}
.layout-card>div:hover:before,
.layout-card>div:hover:after {
  opacity: 1;
}
</style>

<div style="display: flex; flex-wrap: wrap;">
  <div class="layout-card">
    <div class="bg-white" data-title="Cola">
      <a href="/storybook/?path=/story/experimental-layouts--cola-js">
        <img src="/gatsby/images/layouts/cola.png">
      </a>
    </div>
  </div>

  <div class="layout-card">
    <div class="bg-white" data-title="Hive Plot">
      <a href="/storybook/?path=/story/experimental-layouts--hive-plot">
        <img src="/gatsby/images/layouts/hive-plot.png">
      </a>
    </div>
  </div>

  <div class="layout-card">
    <div class="bg-white" data-title="MultiGraph">
      <a href="/storybook/?path=/story/experimental-layouts--multigraph">
        <img src="/gatsby/images/layouts/multi-graph.png">
      </a>
    </div>
  </div>
  <div class="layout-card">
    <div class="bg-white" data-title="ngraph">
      <a href="/storybook/?path=/story/experimental-layouts--ngraph">
        <img src="/gatsby/images/layouts/ngraph.png">
      </a>
    </div>
  </div>
  <div class="layout-card">
    <div class="bg-white" data-title="Radial">
      <a href="/storybook/?path=/story/experimental-layouts--radial-layout">
        <img src="/gatsby/images/layouts/radial.png">
      </a>
    </div>
  </div>
  <div class="layout-card">
    <div class="bg-white" data-title="Viz.js">
      <a href="/storybook/?path=/story/experimental-layouts--viz-js">
        <img src="/gatsby/images/layouts/vizjs.png">
      </a>
    </div>
  </div>
</div>
