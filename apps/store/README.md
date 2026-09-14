# @fitpath/store

Fjordhem, a fictional furniture shop, as static HTML — the way a real one is.

This is the deliverable that proves the widget embeds without any retailer
agreeing to anything. Each product page is an ordinary one: a gallery, a price,
an add-to-cart form, a specifications table, and one line at the bottom:

```html
<script async src="../widget/fitpath.js"></script>
```

The widget finds the product (the page's `<article>` carries
`data-fitpath-product`), puts its button after the **Add to cart** control, and
the shop's stylesheet — which makes every button a black block, every heading a
serif in brand red, and gives every input a thick red border — never touches
it. That stylesheet is opinionated on purpose: if any of it reaches the widget,
the shadow boundary has failed and the page will show it.

```bash
npm --workspace @fitpath/widget run build    # first: the store copies the widget's dist in
npm --workspace @fitpath/store run build     # writes dist/: seven pages plus widget/
npm --workspace @fitpath/store run preview   # serves dist/ at http://localhost:4173
```

The dimensions on every page are read from the engine's fixtures and the
pictures are drawn from the same box models, because a shop that could disagree
with the engine about how big a sofa is would make the fit check pointless.
The copy, the prices and the shop are fictional.
