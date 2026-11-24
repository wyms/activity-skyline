# Security

## Reporting a problem

Please report a suspected vulnerability privately through this repository's **Security** tab, using **Report a vulnerability**. Please do not open a public issue for it.

## How the site is built

- The site is static files served by GitHub Pages. There is no server code, database, account, cookie or analytics.
- It has no third-party scripts, styles, fonts or packages. Everything it runs is in `site/`.
- The only network request it makes is to GitHub's public API (`api.github.com`) when you load a repository. The request carries no credentials and no referrer.
- Files you choose (activity files, a saved calendar page) are read in your browser and are not uploaded.
- A content security policy allows scripts, styles, fonts and images from the site itself and nothing else, forbids inline code, and turns on Trusted Types so the page cannot build HTML from text.
- The saved calendar page is read as plain text. It is never parsed into a document or added to the page.
- The site refuses to run inside another site's frame.

`node tools/check.mjs` enforces these rules and runs on every push before anything is published.

## Limits

GitHub Pages does not let a site set its own response headers, so the content policy is delivered in the page itself. All project sites under one GitHub account share an origin; this site stores nothing in the browser.
