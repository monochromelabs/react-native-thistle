This is a new [**React Native**](https://reactnative.dev) project, bootstrapped using [`@react-native-community/cli`](https://github.com/react-native-community/cli).

## Conversations

Open the hamburger menu to view saved chats, switch conversations, or create a
new chat. Chats, their model context, and the selected chat are saved on-device
using `react-native-encrypted-storage` (iOS Keychain / Android encrypted shared
preferences) and restored across restarts. Rebuild the native app after installing
dependencies; iOS also requires `bundle exec pod install`.

Thistle Lite includes the selected chat's previous completed questions and answers
as context for follow-up messages; other chats are never included. Within the
2048-token context window, 300 tokens are
reserved for the reply. If the input exceeds that budget, the oldest complete
exchanges are removed from model context until it fits; the visible transcript
is unchanged.

Failed requests are not saved or added to model context. Generation errors appear
below the transcript, and the composer remains available so you can retry or
shorten a message that is too long on its own.

Deleting a chat requires confirming **Delete forever** and removes its transcript
and model context from the saved library. There is no undo. Switching, creating,
and deleting chats are disabled during generation and storage operations.
Storage errors are shown explicitly with a retry action; unsaved changes stay in
memory and further chat changes are blocked until saving succeeds. Do not close
the app while a save is failing. Invalid saved data is not silently replaced.
On first launch, both `null` and `undefined` native missing-key results are
treated as an empty library; malformed stored strings still surface an error.

`react-native-encrypted-storage` 4.0.3 is archived and used here by explicit choice.
Encryption protects stored data, not unlocked app screens or device backups.
iOS Keychain data can survive app uninstall; use the in-app delete action to
remove saved chats.

# Getting Started

> **Note**: Make sure you have completed the [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) guide before proceeding.

## Step 1: Start Metro

First, you will need to run **Metro**, the JavaScript build tool for React Native.

To start the Metro dev server, run the following command from the root of your React Native project:

```sh
# Using npm
npm start

# OR using Yarn
yarn start
```

## Step 2: Build and run your app

With Metro running, open a new terminal window/pane from the root of your React Native project, and use one of the following commands to build and run your Android or iOS app:

### Android

```sh
# Using npm
npm run android

# OR using Yarn
yarn android
```

### iOS

The Thistle Lite iOS bundle identifier is `earth.thistle.thistle.lite` for both
Debug and Release. Use this identifier for the App Store Connect app record and
signing profiles.

App icons live in `ios/ThistleLite/Images.xcassets/AppIcon.appiconset`. Keep the
iPhone, iPad (including 152x152 and 167x167), and 1024x1024 App Store icons as
opaque PNGs with no alpha channel. Xcode compiles the catalog and generates the
icon references in the built app's `Info.plist`; do not add separate legacy icon
entries to the source plist. Create a new archive after changing these assets
before uploading to App Store Connect.

For iOS, remember to install CocoaPods dependencies (this only needs to be run on first clone or after updating native deps).

The first time you create a new project, run the Ruby bundler to install CocoaPods itself:

```sh
bundle install
```

Then, and every time you update your native dependencies, run:

```sh
bundle exec pod install
```

For more information, please visit [CocoaPods Getting Started guide](https://guides.cocoapods.org/using/getting-started.html).

```sh
# Using npm
npm run ios

# OR using Yarn
yarn ios
```

If everything is set up correctly, you should see your new app running in the Android Emulator, iOS Simulator, or your connected device.

This is one way to run your app — you can also build it directly from Android Studio or Xcode.

## Step 3: Modify your app

Now that you have successfully run the app, let's make changes!

Open `App.tsx` in your text editor of choice and make some changes. When you save, your app will automatically update and reflect these changes — this is powered by [Fast Refresh](https://reactnative.dev/docs/fast-refresh).

When you want to forcefully reload, for example to reset the state of your app, you can perform a full reload:

- **Android**: Press the <kbd>R</kbd> key twice or select **"Reload"** from the **Dev Menu**, accessed via <kbd>Ctrl</kbd> + <kbd>M</kbd> (Windows/Linux) or <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (macOS).
- **iOS**: Press <kbd>R</kbd> in iOS Simulator.

## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [docs](https://reactnative.dev/docs/getting-started).

# Troubleshooting

### iOS Debug link failures after a Release archive

If the linker reports missing React Native symbols such as
`facebook::react::Sealable` or `DebugStringConvertible` from `libRNSVG.a`,
check the prebuilt React Core configuration. A Release framework left in the
Pods cache without its configuration marker can be mistaken for Debug.
The accompanying SwiftUICore warning is not a reason to link that private
framework directly.

For the current React Native 0.85.0 dependency, restore the existing downloaded
Debug artifact and its marker from the example directory, with no other iOS
build running:

```sh
cd ios
tar -xzf Pods/ReactNativeCore-artifacts/reactnative-core-0.85.0-debug.tar.gz \
  -C Pods/React-Core-prebuilt
printf Debug > Pods/React-Core-prebuilt/.last_build_configuration
cd ..
npm run ios
```

Use the artifact matching the installed React Native version if it changes.
This repairs generated local cache state; do not commit Pods or add flags that
disable React Native debug checks to work around the missing symbols.

If you're having issues getting the above steps to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.
