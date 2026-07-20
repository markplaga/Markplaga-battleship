# Battleship: Deep Command

A responsive browser Battleship game with a cinematic 3D command-board interface.

## Game modes

- **Solo Command:** play against a hunt-and-target computer opponent.
- **Online Battle:** create a private six-character room code and play from separate devices.

## Features

- Standard 10×10 Battleship rules and five-vessel fleet
- Manual or randomized ship placement
- Mobile-friendly perspective board and touch controls
- Hit, miss, sunk, victory, and defeat effects
- Server-validated online turns and hidden opponent fleets
- Expiring private rooms stored with Netlify Blobs

## Local development

```bash
npm install
npm run dev
```

The online mode uses a Netlify Function at `/api/room`, so run the project with Netlify Dev rather than a plain static file server.

## Deployment

The project is configured for Netlify. The static site is published from `public`, and the multiplayer API lives in `netlify/functions/room.ts`.

```bash
npm run deploy
```
