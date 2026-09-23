import * as ImagePicker from 'expo-image-picker';

/**
 * Device camera / gallery access. This is on-device functionality, not a
 * backend boundary, so it is real (expo-image-picker) rather than mocked.
 */
export type PickResult =
  | { status: 'picked'; uri: string }
  | { status: 'cancelled' }
  | { status: 'denied' }
  | { status: 'error'; message: string };

const OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  quality: 0.7,
  allowsEditing: false,
};

async function run(
  request: () => Promise<ImagePicker.PermissionResponse>,
  launch: () => Promise<ImagePicker.ImagePickerResult>,
): Promise<PickResult> {
  try {
    const permission = await request();
    if (!permission.granted) return { status: 'denied' };
    const result = await launch();
    if (result.canceled || !result.assets?.[0]) return { status: 'cancelled' };
    return { status: 'picked', uri: result.assets[0].uri };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : 'Could not open the camera.' };
  }
}

export const imagePicker = {
  takePhoto: () =>
    run(ImagePicker.requestCameraPermissionsAsync, () => ImagePicker.launchCameraAsync(OPTIONS)),
  chooseFromGallery: () =>
    run(
      () => ImagePicker.requestMediaLibraryPermissionsAsync(),
      () => ImagePicker.launchImageLibraryAsync(OPTIONS),
    ),
};
