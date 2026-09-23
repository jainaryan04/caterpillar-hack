import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  PanResponder,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import type { ImagePoint } from '@/types/agent';
import { colors, radius, spacing } from '@/theme/tokens';
import { AppText } from '../ui/AppText';

export interface PhotoMark {
  circle?: ImagePoint[];
  tap?: ImagePoint;
}

const FRAME_HEIGHT = 300;
/** Fewer finger points than this counts as a tap, not a circle. */
const MIN_CIRCLE_POINTS = 6;
const MAX_POINTS = 60;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Photo preview the operator can circle or tap on to say which part they mean.
 * Points are reported 0..1 across and down the *image* (letterbox removed),
 * which is what the Cat agent expects. While analyzing, a scan line sweeps.
 */
export function CameraPreview({
  uri,
  analyzing,
  mark,
  onMarkChange,
}: {
  uri: string;
  analyzing?: boolean;
  mark?: PhotoMark;
  /** Enables drawing when provided. */
  onMarkChange?: (mark: PhotoMark | undefined) => void;
}) {
  const sweep = useState(() => new Animated.Value(0))[0];
  const [frame, setFrame] = useState({ w: 0, h: FRAME_HEIGHT });
  const [imageSize, setImageSize] = useState<{ w: number; h: number }>();
  const [drawing, setDrawing] = useState<{ x: number; y: number }[]>([]);

  useEffect(() => {
    Image.getSize(
      uri,
      (w, h) => setImageSize({ w, h }),
      () => setImageSize(undefined),
    );
  }, [uri]);

  useEffect(() => {
    if (!analyzing) return;
    sweep.setValue(0);
    const anim = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    );
    anim.start();
    return () => anim.stop();
  }, [analyzing, sweep]);

  // Where the image actually sits inside the frame with resizeMode="contain".
  const rect: Rect | undefined = useMemo(() => {
    if (!imageSize || !frame.w) return undefined;
    const scale = Math.min(frame.w / imageSize.w, frame.h / imageSize.h);
    const w = imageSize.w * scale;
    const h = imageSize.h * scale;
    return { x: (frame.w - w) / 2, y: (frame.h - h) / 2, w, h };
  }, [imageSize, frame]);

  const rectRef = useRef(rect);
  const onChangeRef = useRef(onMarkChange);
  const pointsRef = useRef<{ x: number; y: number }[]>([]);
  useEffect(() => {
    rectRef.current = rect;
    onChangeRef.current = onMarkChange;
  });

  // Handlers read the latest rect/callback through refs, and only on touch,
  // never during render; the compiler lint can't see that through PanResponder.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !!onChangeRef.current,
        onMoveShouldSetPanResponder: () => !!onChangeRef.current,
        // Don't let the surrounding ScrollView steal a circle mid-stroke.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          pointsRef.current = [{ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }];
          setDrawing(pointsRef.current);
        },
        onPanResponderMove: (e) => {
          const last = pointsRef.current[pointsRef.current.length - 1];
          const p = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
          // Keep points a few px apart so a slow finger doesn't flood the list.
          if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 6) {
            pointsRef.current = [...pointsRef.current, p];
            setDrawing(pointsRef.current);
          }
        },
        onPanResponderRelease: () => {
          const r = rectRef.current;
          const pts = pointsRef.current;
          if (!r || !pts.length) return;
          const norm = (p: { x: number; y: number }): ImagePoint => [
            Math.min(1, Math.max(0, (p.x - r.x) / r.w)),
            Math.min(1, Math.max(0, (p.y - r.y) / r.h)),
          ];
          if (pts.length < MIN_CIRCLE_POINTS) {
            onChangeRef.current?.({ tap: norm(pts[pts.length - 1]) });
          } else {
            const step = Math.ceil(pts.length / MAX_POINTS);
            onChangeRef.current?.({ circle: pts.filter((_, i) => i % step === 0).map(norm) });
          }
        },
      }),
  );

  const onLayout = (e: LayoutChangeEvent) =>
    setFrame({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  // Draw the saved mark (normalised) or the stroke in progress (frame coords).
  const toFrame = (p: ImagePoint) => (rect ? { x: rect.x + p[0] * rect.w, y: rect.y + p[1] * rect.h } : undefined);
  const strokePoints = mark?.circle
    ? mark.circle.map(toFrame).filter((p): p is { x: number; y: number } => !!p)
    : mark?.tap
      ? []
      : drawing;
  const tapPoint = mark?.tap ? toFrame(mark.tap) : undefined;

  return (
    <View style={styles.frame} onLayout={onLayout} {...(onMarkChange ? responder.panHandlers : {})}>
      <Image source={{ uri }} style={styles.image} resizeMode="contain" accessibilityLabel="Machinery photo" />
      {strokePoints.map((p, i) => (
        <View key={i} pointerEvents="none" style={[styles.dot, { left: p.x - 3, top: p.y - 3 }]} />
      ))}
      {tapPoint ? <View pointerEvents="none" style={[styles.tap, { left: tapPoint.x - 14, top: tapPoint.y - 14 }]} /> : null}
      {analyzing ? (
        <View style={styles.overlay} accessibilityLiveRegion="polite" accessibilityLabel="Analyzing image">
          <Animated.View
            style={[
              styles.scan,
              { transform: [{ translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [0, FRAME_HEIGHT - 20] }) }] },
            ]}
          />
          <View style={styles.badge}>
            <AppText variant="label" tone="brand" caps style={{ letterSpacing: 3 }}>
              Analyzing image…
            </AppText>
          </View>
        </View>
      ) : null}
      {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
        <View key={c} pointerEvents="none" style={[styles.corner, styles[c]]} />
      ))}
    </View>
  );
}

const C = 18;
const styles = StyleSheet.create({
  frame: {
    height: FRAME_HEIGHT,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: '#050505',
    borderWidth: 1,
    borderColor: colors.border,
  },
  image: { width: '100%', height: '100%' },
  dot: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: colors.brand },
  tap: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 3,
    borderColor: colors.brand,
    backgroundColor: 'rgba(255,205,17,0.2)',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scan: { position: 'absolute', top: 10, left: 0, right: 0, height: 2, backgroundColor: colors.brand, opacity: 0.8 },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderWidth: 1,
    borderColor: colors.brandBorder,
  },
  corner: { position: 'absolute', width: C, height: C, borderColor: colors.brand },
  tl: { top: spacing.sm, left: spacing.sm, borderTopWidth: 2, borderLeftWidth: 2 },
  tr: { top: spacing.sm, right: spacing.sm, borderTopWidth: 2, borderRightWidth: 2 },
  bl: { bottom: spacing.sm, left: spacing.sm, borderBottomWidth: 2, borderLeftWidth: 2 },
  br: { bottom: spacing.sm, right: spacing.sm, borderBottomWidth: 2, borderRightWidth: 2 },
});
