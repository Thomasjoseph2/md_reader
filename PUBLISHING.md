# Publishing to the Chrome Web Store

About 30 minutes of work, then Google reviews it (usually 1 to 3 days, sometimes longer).

## 1. Try it in your own Chrome first

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `app` folder.
4. Click the toolbar puzzle icon and pin **Markdown Folder Viewer**. Click it: the viewer opens.
5. On the extension's **Details** page, turn on **Allow access to file URLs**. Now drag any `.md` file into Chrome.

After you change any file in `app/`, click the reload arrow on the extension's card.

## 2. Make the upload zip

```bash
./build.sh
```

This makes `dist/markdown-folder-viewer-<version>.zip`.

## 3. Create a developer account (one time)

1. Go to https://chrome.google.com/webstore/devconsole and sign in with the Google account you want as the publisher.
2. Accept the agreement and pay the one-time **US $5** registration fee.
3. Turn on 2-step verification on that Google account if asked (it is required to publish).
4. In **Account**, fill in the publisher name and contact email, and verify the email.

## 4. Upload

1. In the developer console click **New item** and upload the zip from `dist/`.
2. **Store listing** tab: copy the text from `store/LISTING.md`. Upload the 128 icon, the four screenshots and the
   promo tile from `store/`.
3. **Privacy** tab: copy the single purpose, the permission justification, "No remote code" and the data answers
   from `store/LISTING.md`. Privacy policy URL:
   `https://github.com/Thomasjoseph2/md_reader/blob/main/PRIVACY.md` (the repo must be public).
4. **Distribution** tab: Public, all regions.
5. Click **Submit for review**.

When it is approved you get a public link like `https://chromewebstore.google.com/detail/<id>`. Share that link.
Microsoft Edge users can install it from the same Chrome Web Store page.

## 5. Updates

1. Change the code and test it with **Load unpacked**.
2. Raise `"version"` in `app/manifest.json` (for example 1.0.0 → 1.0.1). The store rejects a zip with the same version.
3. Run `./build.sh`, then in the developer console open the item → **Package** → **Upload new package** → **Submit**.

Users get the update automatically within a few hours.

## Optional: a web version for everyone else

Firefox and Safari users can use the same viewer as a web page. In the GitHub repo, open **Settings → Pages**, choose
**Deploy from a branch**, branch `main`, folder `/ (root)`. It goes live at `https://thomasjoseph2.github.io/md_reader/`.
