# GitHub Skyline

Turn a year of GitHub activity into an engraved, 3D-printable desk sculpture. Choose architectural towers or a flowing contour relief, explore the model in 3D, and download print-ready files. Everything runs in your browser.

GitHub Skyline is an independent project. It is not affiliated with or endorsed by GitHub.

## Use the studio

1. Choose where the activity comes from.
   - **Repository**: paste a public repository URL or `owner/repo`. The studio reads default-branch commits from GitHub's public API and groups them by UTC committer date. Add a username to count one contributor.
   - **Profile**: enter a handle and year. An independent open-source service, `github-contributions-api.jogruber.de`, looks up GitHub's public contribution calendar and receives the handle and year. To ask nobody but GitHub, or if that service is down, open **Bring the calendar in yourself**: save the calendar page the studio links to as HTML and choose the saved file.
   - **Local file**: a CSV headed `date,count`, or JSON such as `{"year":2025,"days":{"2025-01-14":4}}`. Use one calendar year per file.
2. Pick **Architecture** or **Contour relief**, a finish, and the base inscription (up to 24 characters plus the year).
3. Download the STL, a two-colour 3MF, a PNG of the current view, or a print kit with separate files and a print guide.

For a private repository, export daily counts from a full local checkout and import the file. Change the year in the command to the one you want. Dates use each commit's own time zone:

```sh
git log --pretty=%cs | grep '^2025-' | sort | uniq -c | awk 'BEGIN {print "date,count"} {print $2 "," $1}' > activity.csv
```

GitHub's anonymous API limit of 60 requests an hour applies to repository lookups. A repository with more than 5,000 commits in the chosen year is too large to read this way; the studio reports that, and the local export above handles it.

## Print specification

The assembled piece is 179 × 37 mm and up to 26.4 mm high. The combined STL takes 175.5 × 78 mm of bed space. Use PLA with a 0.4 mm nozzle and 0.2 mm layers, at 100% scale with each part flat on the bed. For two colours, print charcoal through Z 6.4 mm and then switch to the tower colour. The end cap lifts off so next year's section can join on.

## Run it locally

Requires Node 20 or later. There are no packages to install.

```sh
npm test         # unit tests and the publish checks
npm run check    # publish checks only
npm run serve    # serves site/ on 127.0.0.1:4173
npm run publish-site   # checks, tests, then publishes site/
```

## How it is published

`site/` is the whole website. `npm run publish-site` runs the publish checks and the tests, then copies `site/` to the `gh-pages` branch, which GitHub Pages serves as it is. Pushing to `main` does not change the live site. See [SECURITY.md](SECURITY.md) for how the site is locked down.

## Fonts

DM Sans and Cormorant Garamond are included under the SIL Open Font License. The licence texts are in `site/fonts/`.
