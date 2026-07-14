# Item Manager

Item Manager is a local item library manager with tags, cover images, and a dark themed interface. It can run in a browser or as a Windows Electron application.

## Features

- Local Node.js server
- Browser based item management UI
- JSON backed item and tag storage
- Cover image upload support

## Getting Started

Install dependencies:

```bash
npm install
```

Start the server:

```bash
npm start
```

Then open the local address printed by the server in your browser.

## Electron (Windows)

Launch the desktop app during development:

```bash
npm run electron
```

Create a portable Windows build:

```bash
npm run dist
```

The build is written to `release/`. Its archive is stored in a `data/` folder beside the generated `.exe`; an existing folder is never overwritten. The initial `data/` folder from this project is copied there on first launch, so `items.json`, `tags.json`, `settings.json`, and cover images remain portable with the application.
