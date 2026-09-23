import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { colors } from '@/theme/tokens';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function Icon({ name, size = 22, color = colors.text }: { name: IconName; size?: number; color?: ColorValue }) {
  return <MaterialCommunityIcons name={name} size={size} color={color} accessibilityElementsHidden importantForAccessibility="no" />;
}
