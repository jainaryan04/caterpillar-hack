import { useState } from 'react';
import { Image, StyleSheet, View, type ImageStyle, type StyleProp } from 'react-native';
import { colors, spacing } from '@/theme/tokens';
import { AppText } from './AppText';
import { Icon } from './Icon';

/**
 * Image from a backend URL. If it fails to load (404, server down) it says so,
 * instead of leaving an empty box that looks like a rendering bug.
 */
export function RemoteImage({
  uri,
  style,
  label,
  resizeMode = 'contain',
  failedText = 'Picture unavailable',
}: {
  uri: string;
  style: StyleProp<ImageStyle>;
  label: string;
  resizeMode?: 'contain' | 'cover';
  failedText?: string;
}) {
  const [failedUri, setFailedUri] = useState<string>();
  if (failedUri === uri) {
    return (
      <View style={[style as object, styles.failed]} accessibilityLabel={`${label}: ${failedText}`}>
        <Icon name="image-broken-variant" size={22} color={colors.textMuted} />
        <AppText variant="small" tone="muted" style={{ textAlign: 'center' }}>
          {failedText}
        </AppText>
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={style}
      resizeMode={resizeMode}
      accessibilityLabel={label}
      onError={() => setFailedUri(uri)}
    />
  );
}

const styles = StyleSheet.create({
  failed: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
    backgroundColor: colors.inset,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
  },
});
