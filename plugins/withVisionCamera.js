const { withAndroidManifest, withInfoPlist } = require('@expo/config-plugins');

function withVisionCameraAndroid(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const permissions = manifest.manifest['uses-permission'] ?? [];

    const cameraPermission = 'android.permission.CAMERA';
    const alreadyAdded = permissions.some(
      (p) => p.$['android:name'] === cameraPermission
    );

    if (!alreadyAdded) {
      manifest.manifest['uses-permission'] = [
        ...permissions,
        { $: { 'android:name': cameraPermission } },
      ];
    }

    cfg.modResults = manifest;
    return cfg;
  });
}

function withVisionCameraIos(config, { cameraPermissionText } = {}) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults['NSCameraUsageDescription'] =
      cameraPermissionText ?? 'This app requires access to your camera.';
    return cfg;
  });
}

module.exports = (config, options = {}) => {
  config = withVisionCameraAndroid(config);
  config = withVisionCameraIos(config, options);
  return config;
};
