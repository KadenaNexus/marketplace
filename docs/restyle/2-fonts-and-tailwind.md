# Fonts and Tailwind config

## index.html (inside <head>, replace any Inter font link)
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700&family=Instrument+Sans:wght@400;500;600&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet">
```
IBM Plex Sans Arabic is for the Arabic version of the landing page (Instrument Sans has no Arabic glyphs).

## src/index.css (add once, anywhere after the token blocks)
```css
[dir="rtl"], [dir="rtl"] .font-sans, [dir="rtl"] .font-display { font-family: "IBM Plex Sans Arabic", "Instrument Sans", system-ui, sans-serif; }
[dir="rtl"] h1 { letter-spacing: 0; }
```
The landing component uses Tailwind's logical utilities (`ps-`, `pe-`, `border-e`, `text-start`), which need Tailwind 3.3 or newer.

## index.html meta (replace the existing title/description/og tags)
```html
<title>Kadena P2P Marketplace | Kadena Nexus</title>
<meta name="description" content="Trade KDA person to person. The seller's KDA is held in a Pact escrow contract on Chainweb until the buyer's payment is confirmed. No sign-up and no platform fee." />
<meta name="author" content="Kadena Nexus" />
<meta property="og:title" content="Kadena P2P Marketplace" />
<meta property="og:description" content="Trade KDA person to person, with the coins held in a Pact escrow contract." />
<meta property="og:url" content="https://marketplace.kadena.ws/" />
<meta name="twitter:site" content="@KadenaNexus" />
```

## tailwind.config.(ts|js) – theme.extend.fontFamily
```js
fontFamily: {
  sans: ['var(--font-sans)'],
  display: ['var(--font-display)'],
  mono: ['var(--font-mono)'],
},
```
If fontFamily already maps `sans` to "Inter", replace it. `font-display` is new and is
used by the new landing page and for page headings.
