# Battleship: Deep Command

A responsive browser Battleship game with a cinematic 3D command-board interface.

## Game modes

- **Solo Command:** play against a hunt-and-target computer opponent entirely in the browser.
- **Online Battle:** create a private six-character room code and play from separate devices.

## Features

- Standard 10×10 Battleship rules and five-vessel fleet
- Manual or randomized ship placement
- Mobile-friendly perspective board and touch controls
- Hit, miss, sunk, victory, and defeat effects
- Server-validated online turns and hidden opponent fleets
- Private player tokens stored only in the browser session
- Reconnection after a refresh in the same browser tab
- Expiring private rooms stored with Netlify Blobs
- Automated JavaScript, TypeScript, game-logic, and asset checks

## Architecture

The project uses a split deployment:

- **GitHub Pages** hosts the static game interface from `public/`.
- **Netlify** hosts the multiplayer API in `netlify/functions/room.ts` and stores room state with Netlify Blobs.

The production Pages client automatically uses:

```text
https://battleship-deep-command.netlify.app/api/room
```

For another frontend host, define `window.BATTLESHIP_API_ORIGIN` before loading `public/js/online.js`.

## Local development

Requirements: Node.js 20 or newer.

```bash
npm install
npm run dev
```

Netlify Dev serves the static files and the `/api/room` function together.

## Validation

Run the full project check before deployment:

```bash
npm run check
```

That command performs:

- syntax checks for every browser JavaScript file
- strict TypeScript checking for the Netlify Function
- automated Battleship rules and static-asset tests

## Deploy the multiplayer backend

Link the repository to the Netlify project and deploy:

```bash
npm run deploy
```

The Netlify site must be available at `https://battleship-deep-command.netlify.app` for online play from the GitHub Pages build. The function allows requests from `https://markplaga.github.io` and the local Netlify Dev origins.

## Deploy the frontend to GitHub Pages

The workflow in `.github/workflows/pages.yml` validates the project and publishes `public/` on every push to `main`.

In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**. The expected site URL is:

```text
https://markplaga.github.io/Markplaga-battleship/
```

## Known operational limitation

Netlify Blobs uses last-write-wins storage. The server validates fleets, player tokens, turns, duplicate shots, and victory conditions, but it does not provide database-level transactional locking for two requests arriving at the exact same moment. For a casual private-room game this is acceptable; a large public matchmaking service should use a transactional database and rate limiting.
