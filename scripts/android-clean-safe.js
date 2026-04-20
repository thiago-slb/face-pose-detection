const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

const TARGETS = [
  'android/.cxx',
  'android/build',
  'android/app/.cxx',
  'android/app/build',
  'node_modules/react-native-gesture-handler/android/build',
  'node_modules/react-native-reanimated/android/build',
  'node_modules/react-native-worklets/android/build',
  'node_modules/react-native-worklets-core/android/build',
  'node_modules/react-native-nitro-modules/android/build',
  'node_modules/react-native-nitro-image/android/build',
  'node_modules/react-native-vision-camera/android/build',
  'node_modules/react-native-vision-camera-worklets/android/build',
];

for (const rel of TARGETS) {
  const abs = path.join(projectRoot, rel);
  if (!fs.existsSync(abs)) {
    continue;
  }
  try {
    fs.rmSync(abs, { recursive: true, force: true });
    process.stdout.write(`removed ${rel}\n`);
  } catch (error) {
    const message = error && typeof error === 'object' && 'code' in error
      ? `${error.code}: ${error.message}`
      : String(error);
    process.stdout.write(`warning ${rel} (${message})\n`);
  }
}

process.stdout.write('android clean-safe complete\n');
