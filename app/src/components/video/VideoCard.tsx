import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { TrainingVideo } from '@/types/domain';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatVideoLength } from '@/utils/format';
import { AppText } from '../ui/AppText';
import { Icon } from '../ui/Icon';
import { Badge } from '../ui/StatusBadge';
import { categoryMeta, progressLabel } from './videoMeta';
import { VideoThumbnail } from './VideoThumbnail';

/**
 * Training video entry.
 * - `row`: compact list row (Learn library, related training)
 * - `tile`: fixed-width card for horizontal rails (Recommended)
 */
export const VideoCard = memo(function VideoCard({
  video,
  onPress,
  variant = 'row',
}: {
  video: TrainingVideo;
  onPress: (video: TrainingVideo) => void;
  variant?: 'row' | 'tile';
}) {
  const cat = categoryMeta[video.category];
  const a11y = `${video.title}. ${cat.label}. ${formatVideoLength(video.durationSeconds)}. ${progressLabel(video)}${video.required && !video.completed ? '. Required' : ''}`;

  const status = <ProgressStatus video={video} />;

  if (variant === 'tile') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={a11y}
        onPress={() => onPress(video)}
        style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
      >
        <VideoThumbnail video={video} height={112} />
        <View style={styles.tileBody}>
          <AppText variant="bodyStrong" numberOfLines={2} style={{ minHeight: 46 }}>
            {video.title}
          </AppText>
          <Meta video={video} />
          {status}
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={() => onPress(video)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.rowThumb}>
        <VideoThumbnail video={video} height={72} showPlay={false} />
      </View>
      <View style={styles.rowBody}>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {video.title}
        </AppText>
        <Meta video={video} />
        {status}
      </View>
      <Icon name="chevron-right" size={22} color={colors.textMuted} />
    </Pressable>
  );
});

function Meta({ video }: { video: TrainingVideo }) {
  const cat = categoryMeta[video.category];
  return (
    <View style={styles.meta}>
      <Icon name={cat.icon} size={14} color={colors.textMuted} />
      <AppText variant="small" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
        {cat.label}
      </AppText>
      <AppText variant="small" tone="muted">
        ·
      </AppText>
      <AppText variant="mono" tone="secondary" style={{ fontSize: 13 }}>
        {formatVideoLength(video.durationSeconds)}
      </AppText>
    </View>
  );
}

function ProgressStatus({ video }: { video: TrainingVideo }) {
  return (
    <View style={styles.meta}>
      {video.completed ? (
        <>
          <Icon name="check-circle" size={14} color={colors.success} />
          <AppText variant="small" tone="success">
            Completed
          </AppText>
        </>
      ) : (
        <>
          <Icon
            name={video.progressSeconds > 0 ? 'progress-clock' : 'circle-outline'}
            size={14}
            color={video.progressSeconds > 0 ? colors.brand : colors.textMuted}
          />
          <AppText variant="small" tone={video.progressSeconds > 0 ? 'primary' : 'muted'}>
            {progressLabel(video)}
          </AppText>
        </>
      )}
      {video.required && !video.completed ? (
        <View style={{ marginLeft: spacing.xs }}>
          <Badge label="Required" fg={colors.brand} bg={colors.brandSubtle} />
        </View>
      ) : null}
    </View>
  );
}


const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    paddingRight: spacing.xs,
    minHeight: 88,
    borderRadius: radius.md,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowThumb: { width: 104 },
  rowBody: { flex: 1, gap: 3 },
  tile: {
    width: 232,
    borderRadius: radius.md,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  tileBody: { paddingTop: spacing.sm, gap: 3 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  pressed: { backgroundColor: colors.raised },
});
