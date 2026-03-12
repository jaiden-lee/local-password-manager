# Local Password Manager

This repository now contains the phase-1 Chromium extension prototype and a scaffold for the later Windows desktop components.

## Current status

- Working MV3 browser extension prototype in `src/extension`
- Storage versioning, URL rule matching, selector capture, demo account fill, OAuth detection, and debug UI
- Future .NET vault, security, and desktop interfaces scaffolded in `src/dotnet`

## Development

Install dependencies:

```bash
npm install
```

Build the extension:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Load the extension in Chrome or Edge:

1. Run `npm run build`
2. Open `chrome://extensions` or `edge://extensions`
3. Enable Developer Mode
4. Click `Load unpacked`
5. Select the repository `dist` directory

## Prototype flow

1. Navigate to a login page.
2. Open the extension popup.
3. Save the current page as a site rule if it has not been saved yet.
4. Click `Map Fields` and then select the username and password inputs on the page.
5. Choose a demo account and click `Fill Selected Account`.

The prototype does not use real credentials, passkeys, or Windows Hello yet. It fills demo values stored in extension-local storage.

## Windows/Desktop scaffold

The desktop-side .NET projects are included as source scaffolding only. The current environment does not have the .NET SDK installed, so those projects were not compiled here.
