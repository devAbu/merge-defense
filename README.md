# Merge Defense

Offline tower-defense game for Android. Buy units, merge identical ones into stronger ones, defend the path.

- Game: `www/` (HTML canvas, works offline)
- Difficulties: Easy / Normal / Hard
- Maps: Classic / Zigzag / Spiral
- The APK is built automatically by GitHub Actions (`.github/workflows/build-apk.yml`)
- Download `merge-defense.apk` from **Releases** and install it on an Android phone
- `keystore/debug.keystore` is a fixed DEBUG key (so new versions install over old ones). Not for the Play Store.
- Balance test: `npm run sim` (`node tools/sim.js [runs] [simple|smart|both] [map|all]`)
