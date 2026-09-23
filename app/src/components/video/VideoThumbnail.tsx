import { StyleSheet, View } from 'react-native';
import type { TrainingVideo } from '@/types/domain';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatClock } from '@/utils/format';
import { AppText } from '../ui/AppText';
import { Icon } from '../ui/Icon';
import { machineIcon, watchedFraction } from './videoMeta';

/**
 * Placeholder frame until the media backend supplies real thumbnails:
 * the machine type on a dark technical grid, with duration and progress.
 */
export function VideoThumbnail({ video, height = 120, showPlay = true }: { video: TrainingVideo; height?: number; showPlay?: boolean }) {
  const fraction = watchedFraction(video);
  return (
    <View style={[styles.frame, { height }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.grid}>
        {[0.25, 0.5, 0.75].map((p) => (
          <View key={`v${p}`} style={[styles.vLine, { left: `${p * 100}%` }]} />
        ))}
        {[0.33, 0.66].map((p) => (
          <View key={`h${p}`} style={[styles.hLine, { top: `${p * 100}%` }]} />
        ))}
      </View>
      <Icon name={machineIcon[video.machineType]} size={Math.min(56, height * 0.42)} color={colors.borderStrong} />
      {showPlay ? (
        <View style={styles.play}>
          <Icon name="play" size={18} color={colors.onBrand} />
        </View>
      ) : null}
      <View style={styles.duration}>
        <AppText variant="mono" style={{ fontSize: 12, lineHeight: 16 }}>
          {formatClock(video.durationSeconds)}
        </AppText>
      </View>
      {fraction > 0 ? (
        <View style={styles.track}>
          <View
            style={[styles.fill, { width: `${fraction * 100}%`, backgroundColor: video.completed ? colors.success : colors.brand }]}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: colors.inset,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  grid: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  vLine: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#161616' },
  hLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#161616' },
  play: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.sm + 3,
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  duration: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm + 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: colors.raised },
  fill: { height: 3 },
});
