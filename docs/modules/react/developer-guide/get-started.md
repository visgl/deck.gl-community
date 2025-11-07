# Get Started

## Overlays

The overlay layers are based on HTML and rendered by the browser. You can use them
for complicated objects that follow map points. They are less performant
but more flexible. For more details see [Using Html Overlays](/docs/modules/react/api-reference/overlays/html-overlay)

HTML overlays are very easy to use and take advantage of [react's architecture](https://reactjs.org/docs/).

```jsx
<HtmlOverlay>
  <HtmlOverlayItem coordinates={coordinates}>{title}</HtmlOverlayItem>
</HtmlOverlay>
```

Checkout the Unesco World Heritage example.

See Also

- [Html Overlay](/docs/modules/react/api-reference/overlays/html-overlay)
- [Html Overlay Item](/docs/modules/react/api-reference/overlays/html-overlay-item)
