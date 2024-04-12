# Colormaps

`deck.gl-raster` includes some public colormaps in the Github repository. These
generally come from [`rio-tiler`][rio-tiler], which were themselves mostly
derived from Matplotlib. A few custom colormaps that are commonly-used with
raster data are included.

To use them, you can load the PNG via the jsdelivr CDN, e.g.:

```
https://cdn.jsdelivr.net/gh/kylebarron/deck.gl-raster/assets/colormaps/{colormap_name}.png
```

Note that the colormap name below must be **lower case** in the URL, e.g. for
the yellow-orange-red colormap, use:

```
https://cdn.jsdelivr.net/gh/kylebarron/deck.gl-raster/assets/colormaps/ylorrd.png
```

The image you load should look like:

![](https://cdn.jsdelivr.net/gh/kylebarron/deck.gl-raster/assets/colormaps/ylorrd.png)

## Included Colormaps

![](https://cdn.jsdelivr.net/gh/cogeotiff/rio-tiler@master/docs/img/custom.png)
![](https://cdn.jsdelivr.net/gh/cogeotiff/rio-tiler@master/docs/img/perceptually_uniform_sequential.png)
![](https://cdn.jsdelivr.net/gh/cogeotiff/rio-tiler@master/docs/img/sequential.png)
![](<https://cdn.jsdelivr.net/gh/cogeotiff/rio-tiler@master/docs/img/sequential_(2).png>)
![](https://cdn.jsdelivr.net/gh/cogeotiff/rio-tiler@master/docs/img/diverging.png)
![](https://cdn.jsdelivr.net/gh/cogeotiff/rio-tiler@master/docs/img/cyclic.png)
![](https://cdn.jsdelivr.net/gh/cogeotiff/rio-tiler@master/docs/img/qualitative.png)
![](https://cdn.jsdelivr.net/gh/cogeotiff/rio-tiler@master/docs/img/miscellaneous.png)

### Referencess

- Matplotlib: https://matplotlib.org/3.1.0/tutorials/colors/colormaps.html
- cfastie: http://publiclab.org/notes/cfastie/08-26-2014/new-ndvi-colormap
- rplumbo: https://github.com/cogeotiff/rio-tiler/pull/90
- schwarzwald: http://soliton.vm.bytemark.co.uk/pub/cpt-city/wkp/schwarzwald/tn/wiki-schwarzwald-cont.png.index.html

[rio-tiler]: https://github.com/cogeotiff/rio-tiler
