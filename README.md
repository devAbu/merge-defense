# Merge Defense

Offline tower-defense igra za Android. Kupuj vojnike, spajaj iste u jače, brani put.

- Igra: `www/` (HTML canvas, bez interneta)
- Težine: Lagano / Srednje / Teško
- APK se gradi automatski preko GitHub Actions (`.github/workflows/build-apk.yml`)
- Skini `merge-defense.apk` iz **Releases** i instaliraj na telefon
- `keystore/debug.keystore` je fiksni DEBUG ključ (da se nove verzije instaliraju preko starih). Nije za Play Store.
- Balans test: `npm run sim`
