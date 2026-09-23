import type { LearningCategory, MachineType, TrainingVideo } from '@/types/domain';
import type { IconName } from '../ui/Icon';

export const categoryMeta: Record<LearningCategory, { label: string; icon: IconName }> = {
  safety: { label: 'Safety', icon: 'shield-check-outline' },
  machinery: { label: 'Machinery', icon: 'cog-outline' },
  maintenance: { label: 'Maintenance', icon: 'wrench-outline' },
  emergency: { label: 'Emergency procedures', icon: 'alarm-light-outline' },
};

export const machineIcon: Record<MachineType, IconName> = {
  excavator: 'excavator',
  pump: 'pump',
  conveyor: 'factory',
  crusher: 'robot-industrial',
  haul_truck: 'dump-truck',
  site: 'hard-hat',
};

export function watchedFraction(v: TrainingVideo): number {
  if (v.completed) return 1;
  return v.durationSeconds ? v.progressSeconds / v.durationSeconds : 0;
}

export function progressLabel(v: TrainingVideo): string {
  if (v.completed) return 'Completed';
  if (v.progressSeconds > 0) return `${Math.round(watchedFraction(v) * 100)}% watched`;
  return 'Not started';
}
