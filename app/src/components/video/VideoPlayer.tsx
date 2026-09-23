import { useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type { Playback } from '@/hooks/useMockPlayback';
import type { MachineType, VideoChapter } from '@/types/domain';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatClock } from '@/utils/format';
import { AppText } from '../ui/AppText';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { machineIcon } from './videoMeta';

export interface VideoPlayerProps {
  videoId: string;
  title: string;
  durationSeconds: number;
  /** Null while the media backend isn't connected: a placeholder frame is shown. */
  videoUrl: string | null;
  taskId?: string;
  chapters: VideoChapter[];
  machineType: MachineType;
  playback: Playback;
}

export function chapterAt(chapters: VideoChapter[], position: number): { chapter?: VideoChapter; index: number } {
  let index = -1;
  chapters.forEach((c, i) => {
    if (position >= c.startsAt) index = i;
  });
  return { chapter: chapters[index], index };
}

/**
 * Training video player. Rendering is driven entirely by `playback`, so the
 * simulated clock can be swapped for a real player without touching the UI.
 */
export function VideoPlayer({ title, durationSeconds, videoUrl, chapters, machineType, playback }: VideoPlayerProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const { status, position, toggle, seek } = playback;
  const { chapter, index } = chapterAt(chapters, position);
  const fraction = durationSeconds ? position / durationSeconds : 0;
  const playing = status === 'playing';

  const onTrackLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);

  return (
    <View style={styles.wrap}>
      {/* Frame */}
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={playing ? `Pause ${title}` : `Play ${title}`}
        style={styles.frame}
      >
        <View style={styles.frameTop}>
          <AppText variant="label" tone="muted" caps style={{ fontSize: 10 }}>
            {videoUrl ? 'Training video' : 'Preview · stream not connected'}
          </AppText>
        </View>
        <Icon name={machineIcon[machineType]} size={72} color={colors.borderStrong} />
        {chapter ? (
          <AppText variant="small" tone="secondary" style={styles.frameChapter} numberOfLines={1}>
            {chapter.title}
          </AppText>
        ) : null}
        {!playing ? (
          <View style={styles.bigPlay}>
            <Icon name={status === 'ended' ? 'replay' : 'play'} size={40} color={colors.onBrand} />
          </View>
        ) : null}
      </Pressable>

      {/* Controls */}
      <View style={styles.controls}>
        <Pressable
          onLayout={onTrackLayout}
          onPress={(e) => trackWidth && seek((e.nativeEvent.locationX / trackWidth) * durationSeconds)}
          style={styles.trackHit}
          accessibilityRole="adjustable"
          accessibilityLabel="Playback position"
          accessibilityValue={{ text: `${formatClock(position)} of ${formatClock(durationSeconds)}` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => seek(position + (e.nativeEvent.actionName === 'increment' ? 10 : -10))}
        >
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
            {chapters.slice(1).map((c) => (
              <View key={c.startsAt} style={[styles.tick, { left: `${(c.startsAt / durationSeconds) * 100}%` }]} />
            ))}
          </View>
          <View style={[styles.knob, { left: `${fraction * 100}%` }]} />
        </Pressable>

        <View style={styles.timeRow}>
          <AppText variant="mono">{formatClock(position)}</AppText>
          <AppText variant="mono" tone="muted">
            {formatClock(durationSeconds)}
          </AppText>
        </View>

        <View style={styles.buttons}>
          <IconButton icon="rewind-10" label="Back 10 seconds" onPress={() => seek(position - 10)} size={52} />
          <IconButton
            icon={playing ? 'pause' : status === 'ended' ? 'replay' : 'play'}
            label={playing ? 'Pause' : 'Play'}
            tone="brand"
            onPress={toggle}
            size={64}
          />
          <IconButton icon="fast-forward-10" label="Forward 10 seconds" onPress={() => seek(position + 10)} size={52} />
        </View>

        {chapter ? (
          <AppText variant="small" tone="secondary" style={{ textAlign: 'center' }}>
            Chapter {index + 1} of {chapters.length} · {chapter.title}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.panel, borderBottomWidth: 1, borderBottomColor: colors.border },
  frame: {
    aspectRatio: 16 / 9,
    backgroundColor: '#050505',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameTop: { position: 'absolute', top: spacing.sm, left: spacing.md },
  frameChapter: { position: 'absolute', bottom: spacing.sm, left: spacing.md, right: spacing.md },
  bigPlay: {
    position: 'absolute',
    width: 76,
    height: 76,
    borderRadius: radius.lg,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controls: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  trackHit: { height: 32, justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.raised, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.brand },
  tick: { position: 'absolute', top: 0, width: 2, height: 6, backgroundColor: colors.canvas },
  knob: {
    position: 'absolute',
    width: 18,
    height: 18,
    marginLeft: -9,
    borderRadius: 9,
    backgroundColor: colors.brand,
    borderWidth: 3,
    borderColor: colors.panel,
  },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -spacing.xs },
  buttons: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.xxl },
});
