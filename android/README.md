# Tractor Hisab Android
Android host for https://tractor-hishob.onrender.com/. Existing Express routes, session cookies and PostgreSQL remain on Render. No database credentials are included in the APK.

## Get an APK
Open the pull request's Build Android APK check (or Actions > Build Android APK). After it passes, download Tractor-Hisab-Android-APK from Artifacts, unzip it, and install app-debug.apk on your phone. Android may ask you to allow installation from the browser/file manager.
This is a debug APK for testing and direct sharing. A Play Store release needs a release signing key and an AAB; do not use the debug artifact as a production store release. CI debug signing keys may change between builds, so uninstalling may be needed before reinstalling, which clears local pending/offline data. Sync all pending entries first.

## Android Studio
Open the android directory as a project. Use JDK 17 and Android SDK 35. Sync Gradle, then Run on a phone or emulator (Android 6+). Android Studio can build APK(s). For a CLI build, install Gradle 8.9 and run gradle assembleDebug lintDebug in this directory.

## Native behavior
- Persistent first-party session cookies and web local storage.
- Contact selection uses Android's single-contact phone-number picker; no broad contacts permission.
- Existing PDF and JSON blob downloads open Android's Save file picker; no storage permission.
- WhatsApp, UPI, telephone and external web links open their appropriate apps.
- Back closes the current sheet, returns the owner to Home, then exits.
- HTTPS only; native messages accept only the configured origin and main frame.
- Retry screen for failed top-level navigation.
- Marathi app label and a tractor icon.

The app hosts the live website. Internet is needed for first launch, server operations and PDFs. Existing service-worker and outbox offline behavior must be checked on actual devices; no additional offline guarantee is made. Website updates appear without rebuilding the APK, subject to existing service-worker caching. A current Android System WebView is required for contact and download integration.

## Verify on a real phone
Login and restart; add a farmer using the contact picker; cancel the picker; record and sync work/payment; download owner/farmer PDFs and JSON export; open WhatsApp; close a sheet with Back; test airplane-mode behavior and reconnection; rotate while a picker is open. Pickers pending during activity recreation may need to be opened again. Confirm existing owner data and balances.

Build validation is performed by the included GitHub Actions workflow. Device flows have not yet been verified.
