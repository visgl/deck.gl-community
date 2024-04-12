"""
Generate colormap PNG files
Requires rio-tiler v2
"""

from pathlib import Path

import click
import imageio
import numpy as np
from rio_tiler.cmap import cmap_list
from rio_tiler.colormap import get_colormap, make_lut


@click.command()
@click.option(
    '-o',
    '--out-dir',
    required=True,
    help='Directory to output files to',
    type=click.Path(writable=True))
@click.option(
    '-h',
    '--img-height',
    default=10,
    type=int,
    show_default=True,
    help='Height of PNG in pixels')
def main(out_dir, img_height):
    """Create PNG images from rio-tiler colormaps
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(exist_ok=True, parents=True)

    for cmap_name in cmap_list:
        arr = make_lut(get_colormap(cmap_name))

        # Add axis
        arr = arr[np.newaxis, ...]

        # Make n pixels high
        arr = np.vstack([arr] * img_height)

        # Write to image
        imageio.imwrite(out_dir / f'{cmap_name}.png', arr)


if __name__ == '__main__':
    main()
