import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionButton } from '@/components/ui/ActionButton';
import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { imagePicker, type PickResult } from '@/services/device/imagePicker';
import { colors, spacing } from '@/theme/tokens';

const TIPS: { icon: IconName; text: string }[] = [
  { icon: 'lock-outline', text: 'Isolate the machine before getting close to moving parts.' },
  { icon: 'ruler', text: 'Stand about 1 metre away and fill the frame with the area.' },
  { icon: 'white-balance-sunny', text: 'Avoid strong glare. Use the phone light in dark spaces.' },
];

export default function CameraScreen() {
  const [busy, setBusy] = useState<'camera' | 'gallery' | null>(null);
  const [problem, setProblem] = useState<PickResult | null>(null);

  const pick = async (source: 'camera' | 'gallery') => {
    setBusy(source);
    setProblem(null);
    const result = source === 'camera' ? await imagePicker.takePhoto() : await imagePicker.chooseFromGallery();
    setBusy(null);
    if (result.status === 'picked') {
      router.push({ pathname: '/camera/preview', params: { uri: result.uri } });
    } else if (result.status !== 'cancelled') {
      setProblem(result);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScreenHeader label="Photo check" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={{ gap: spacing.xs }}>
          <AppText variant="display" caps accessibilityRole="header">
            Ask about machinery
          </AppText>
          <AppText variant="body" tone="secondary">
            Take a photo of a part, leak or warning light and ask Cat what it might be.
          </AppText>
        </View>

        <View style={styles.viewfinder}>
          <Icon name="camera-iris" size={64} color={colors.borderStrong} />
        </View>

        {problem ? (
          <Card accent="warning" style={{ gap: spacing.sm }}>
            <AppText variant="bodyStrong">
              {problem.status === 'denied' ? 'Camera or photo access is off' : 'Could not open the camera'}
            </AppText>
            <AppText variant="small" tone="secondary">
              {problem.status === 'denied'
                ? 'Allow access in Android settings to take or choose photos.'
                : problem.status === 'error'
                  ? problem.message
                  : ''}
            </AppText>
            {problem.status === 'denied' ? (
              <ActionButton label="Open settings" icon="cog-outline" variant="secondary" size="md" onPress={() => Linking.openSettings()} />
            ) : null}
          </Card>
        ) : null}

        <View style={{ gap: spacing.sm }}>
          <ActionButton label="Take photo" icon="camera" loading={busy === 'camera'} onPress={() => pick('camera')} />
          <ActionButton
            label="Choose from gallery"
            icon="image-multiple-outline"
            variant="secondary"
            loading={busy === 'gallery'}
            onPress={() => pick('gallery')}
          />
        </View>

        <View style={styles.tips}>
          {TIPS.map((t) => (
            <View key={t.text} style={styles.tip}>
              <Icon name={t.icon} size={18} color={colors.textMuted} />
              <AppText variant="small" tone="secondary" style={{ flex: 1 }}>
                {t.text}
              </AppText>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.lg, gap: spacing.xl },
  viewfinder: {
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: 6,
    backgroundColor: colors.inset,
  },
  tips: { gap: spacing.md },
  tip: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
});
