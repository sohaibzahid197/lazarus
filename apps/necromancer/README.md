# Necromancer

Necromancer is the Android app that turns an old Android phone into the Lazarus SMS gateway. It receives SMS, asks `@lazarus/brain` for a reply, and sends the reply back by SMS. A foreground service keeps the gateway running, and it starts again after a reboot.

The target phone is a Xiaomi phone on Android 15 (HyperOS). The app is installed as a sideloaded debug APK. There is no Play Store release.

## Requirements

- Node.js on your `PATH`. The build uses it to export the STOP keywords from `@lazarus/brain` (see below).
- JDK 17 and the Android SDK (compile SDK 35 or later).
- `adb` and a phone with USB debugging turned on.
- A free Gemini API key from Google AI Studio. You enter it in the app, not in a file.

## Build the debug APK

Install dependencies first:

```sh
cd apps/necromancer
npm install
```

Then build:

```sh
cd android && ./gradlew assembleDebug
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. The JavaScript bundle is built into the APK, so the phone does not need Metro.

### STOP keyword export

The phone checks for STOP with a native fallback when the app cannot start its JavaScript task. That check uses the STOP keywords exported by `@lazarus/brain`, so there is only one keyword list.

The `generateStopAliases` Gradle task runs `packages/brain/scripts/export-stop-aliases.ts` before assets are merged. It writes `android/app/build/generated/lazarus/assets/stop_aliases.json`, which is packed into the APK and never committed. If Gradle cannot find `node`, pass its path:

```sh
./gradlew assembleDebug -PnodeExecutable=/path/to/node
```

To run the export by hand:

```sh
cd packages/brain
npm run export:stop-aliases -- --out /tmp/stop_aliases.json
```

## Install on the phone

With the phone connected over USB, from `apps/necromancer/android`:

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

`-r` keeps the app data, so the Stop_List, settings and AI key survive a reinstall.

## Set up the phone (HyperOS)

Open the app. It shows a permission screen and then a setup screen with these steps, in this order:

1. **Allow restricted settings.** Android blocks SMS permissions for sideloaded apps until you allow them. Open **Settings > Apps > Manage apps > Necromancer**, tap the **⋮** menu and choose **Allow restricted settings**.
2. **Grant SMS and notification permissions.** Allow receiving SMS, sending SMS and notifications. The app explains each one before Android asks.
3. **Save the AI key.** Paste your Gemini free-tier key and tap save. The key is stored encrypted on the phone and shown masked after saving. Without a key, questions get a short "try later" reply. HELP, STOP and START still work.
4. **Turn on Autostart.** Open **Settings > Apps > Manage apps > Necromancer > Autostart** and turn it on, so the gateway starts after a reboot.
5. **Set battery to "No restrictions".** Open **Settings > Apps > Manage apps > Necromancer > Battery saver** and choose **No restrictions**, so HyperOS does not stop the gateway.
6. **Lock the app in recent apps.** Open the recent apps view, press and hold the Necromancer card and tap the lock icon, so HyperOS does not clear it.

Tap each step in the app to open the right settings page. Steps 4 and 6 cannot be checked by the app, so mark them done yourself. When all six are done, the app opens the main screen. The heartbeat shows ALIVE when the gateway is running, or SLEEPING with the reason.

## Tests

```sh
cd apps/necromancer && npx jest
cd packages/brain && npm test
```

## Known limitations

- **Replies can take longer than 30 seconds during radio failures.** Replies are sent one at a time. When the phone has no service or the radio fails, a send can wait up to the 60-second Send_Timeout and then the 30-second retry wait. Later replies wait behind it, so they can arrive more than 30 seconds after the message was received.
- **Fallback STOP detection while paused can miss unusual text.** When the gateway is paused and Android refuses to start the app's JavaScript task, a simple native check decides whether a message is STOP. It uses the same STOP keywords as the command router but not its full text cleanup. A STOP written in unusual characters, such as fullwidth letters (`ＳＴＯＰ`), can be missed in this case.
- **Unlogged paused messages.** In that same fallback case, a message that is not a STOP is dropped without an activity entry. The main screen counters do not include it.
