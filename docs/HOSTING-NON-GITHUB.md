# Hosting games without GitHub

Afterglow can play games hosted on any HTTPS static host. GitHub is no longer required for the game files.

## Quick setup

1. Make sure you have permission to redistribute the game and keep its required licence/credits.
2. Upload the game's complete built folder to a static host such as Cloudflare Pages, Netlify, GitLab Pages, or another HTTPS web host. Keep the folder structure and relative asset paths intact.
3. Find the public URL of the game's HTML entrypoint, for example `https://my-game.pages.dev/index.html`.
4. Add a game entry to the root `games.json`:

```json
{
  "id": "my-game",
  "title": "My Game",
  "category": "Arcade",
  "creator": "Game creator",
  "license": "MIT",
  "mode": "hosted",
  "hostedUrl": "https://my-game.pages.dev/index.html",
  "verified": true,
  "embeddable": true,
  "emoji": "🎮",
  "glow": "#69c9e8",
  "shade": "#183d52",
  "desc": "A short description of the game."
}
```

5. Commit the catalogue change. Afterglow will load the hosted URL in its game frame, and **Open tab** will open the same URL directly.

## Embedding restrictions

- Set `"embeddable": true` only if the host permits the game to appear in an iframe. The host must not block framing with `X-Frame-Options` or a restrictive `Content-Security-Policy: frame-ancestors`.
- If the host blocks embedding, set `"embeddable": false`. Afterglow will show an **Open tab** option instead.
- Use HTTPS URLs. HTTP game hosts are not accepted.
- This method does not copy files into GitHub Pages. The game remains hosted by the provider you chose.
- Keep assets, audio, fonts and scripts on that host where possible; check browser console errors if relative asset paths break.

## When to use each mode

- `local`: fetched from a verified, redistributable GitHub repository during the Pages build.
- `bundled`: files already stored inside this repository.
- `hosted`: files hosted on a separate HTTPS provider; set `hostedUrl`.
- `external`: link to the game's official website, without embedding it.
