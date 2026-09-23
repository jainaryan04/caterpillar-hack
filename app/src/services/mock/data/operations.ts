import type { Machine, Operator, Shift, Task } from '@/types/domain';

export const mockOperator: Operator = {
  id: 'OP-1042',
  firstName: 'Aryan',
  lastName: 'Jain',
  role: 'Equipment Operator II',
  site: 'North Ridge Quarry',
  crew: 'Crew B',
  supervisorName: 'R. Mehta',
  assignedMachineId: 'MCH-042',
};

export const mockShift: Shift = {
  id: 'SHIFT-2026-09-23-M',
  name: 'Morning Shift',
  start: '06:00',
  end: '18:00',
  site: 'North Ridge Quarry',
};

export const mockMachines: Machine[] = [
  { id: 'MCH-042', name: 'Excavator MCH-042', model: 'Cat 320D', type: 'excavator', location: 'Pit 2 · Bench 3' },
  { id: 'PMP-114', name: 'Primary Crusher Pump', model: 'Warman 8/6 AH', type: 'pump', location: 'Pit 2 · Crusher House' },
  { id: 'CV-07', name: 'Conveyor CV-07', model: '1200 mm troughed', type: 'conveyor', location: 'Primary Crusher Feed' },
  { id: 'CR-01', name: 'Primary Jaw Crusher', model: 'C130', type: 'crusher', location: 'Pit 2 · Crusher House' },
  { id: 'SITE-OFFICE', name: 'Site Office', model: '—', type: 'site', location: 'Admin Block' },
];

const PPE_HELMET = { id: 'ppe-helmet', label: 'Wear safety helmet', detail: 'Chin strap fastened' };
const PPE_VEST = { id: 'ppe-vest', label: 'Wear high-visibility vest' };
const PPE_GLOVES = { id: 'ppe-gloves', label: 'Wear chemical-resistant gloves' };
const PPE_EYES = { id: 'ppe-eyes', label: 'Wear safety glasses' };

export const mockTasks: Task[] = [
  {
    id: 'TASK-001',
    title: 'Pre-shift Safety Inspection',
    machineId: 'MCH-042',
    machine: 'Cat 320D Excavator · MCH-042',
    location: 'Pit 2 · Bench 3',
    estimatedMinutes: 20,
    status: 'completed',
    priority: 'high',
    scheduledStart: '06:10',
    completedAt: '06:32',
    description:
      'Walk around the excavator before starting the engine. Record any damage, leaks or missing guards on the pre-start sheet.',
    safetyChecklist: [PPE_HELMET, PPE_VEST, { id: 'area', label: 'Area around machine is clear' }],
    steps: [
      { id: 's1', instruction: 'Check the undercarriage, tracks and idlers for damage or loose bolts.' },
      { id: 's2', instruction: 'Check engine oil, coolant and hydraulic oil levels at the sight glasses.' },
      { id: 's3', instruction: 'Look for fresh fluid on the ground under the machine.' },
      { id: 's4', instruction: 'Test horn, travel alarm and lights from the cab.' },
    ],
    tutorialVideoId: 'VID-110',
    relatedVideoIds: ['VID-112', 'VID-103'],
  },
  {
    id: 'TASK-002',
    title: 'Conveyor Belt Inspection',
    machineId: 'CV-07',
    machine: 'Conveyor CV-07',
    location: 'Primary Crusher Feed',
    estimatedMinutes: 30,
    status: 'completed',
    priority: 'normal',
    scheduledStart: '07:00',
    completedAt: '07:41',
    description:
      'Inspect CV-07 for belt tracking, edge wear and damaged idlers. The conveyor must be stopped and locked out before you go near the belt.',
    safetyChecklist: [
      PPE_HELMET,
      PPE_VEST,
      { id: 'loto', label: 'Conveyor locked out and tagged', detail: 'Your personal lock on the isolation point' },
      { id: 'pull-wire', label: 'Pull-wire tested' },
    ],
    steps: [
      { id: 's1', instruction: 'Walk the full length of the belt and note any mistracking.' },
      { id: 's2', instruction: 'Check belt edges and splices for fraying or lifting.' },
      { id: 's3', instruction: 'Spin return idlers by hand; flag any that are seized or noisy.' },
    ],
    tutorialVideoId: 'VID-108',
    relatedVideoIds: ['VID-107'],
  },
  {
    id: 'TASK-003',
    title: 'Pump Inspection',
    machineId: 'PMP-114',
    machine: 'Primary Crusher Pump · PMP-114',
    location: 'Pit 2 · Crusher House',
    estimatedMinutes: 45,
    status: 'pending',
    priority: 'high',
    scheduledStart: '09:30',
    description:
      'Scheduled inspection of the slurry pump that feeds the primary crusher. Check the gland seal, casing and pipe connections for leaks, and record discharge pressure and bearing temperature. Night shift reported a small drip at the lower flange.',
    safetyChecklist: [
      PPE_HELMET,
      PPE_VEST,
      PPE_GLOVES,
      { id: 'isolated', label: 'Machine isolated', detail: 'Pump stopped, locked out and tagged at MCC-3' },
      { id: 'pressure', label: 'Line pressure released', detail: 'Discharge gauge reads 0 kPa' },
      { id: 'area', label: 'Area clear of other workers' },
    ],
    steps: [
      { id: 's1', instruction: 'Confirm zero energy: try to start the pump from the local panel. It must not start.' },
      {
        id: 's2',
        instruction: 'Inspect the casing, suction and discharge flanges for leaks or cracks.',
        caution: 'Slurry under the casing may be hot. Do not touch it with bare hands.',
      },
      { id: 's3', instruction: 'Check the gland seal. A slow drip is normal; a steady stream is not.' },
      { id: 's4', instruction: 'Check the drive belts for tension and wear, and check the guard is secure.' },
      { id: 's5', instruction: 'Remove your lock, restart the pump and record discharge pressure and bearing temperature after 5 minutes.' },
    ],
    tutorialVideoId: 'VID-101',
    relatedVideoIds: ['VID-102', 'VID-103', 'VID-104'],
  },
  {
    id: 'TASK-004',
    title: 'Swing Bearing Lubrication',
    machineId: 'MCH-042',
    machine: 'Cat 320D Excavator · MCH-042',
    location: 'Pit 2 · Bench 3',
    estimatedMinutes: 30,
    status: 'pending',
    priority: 'normal',
    scheduledStart: '11:00',
    description:
      'Grease the swing bearing and swing drive pinion as per the 250-hour service. Swing the upper structure in 90° steps between grease points.',
    safetyChecklist: [
      PPE_HELMET,
      PPE_VEST,
      PPE_EYES,
      { id: 'bucket', label: 'Bucket lowered to ground' },
      { id: 'lever', label: 'Hydraulic lockout lever raised' },
    ],
    steps: [
      { id: 's1', instruction: 'Park on level ground, lower the bucket and stop the engine.' },
      { id: 's2', instruction: 'Pump 5–6 strokes of grease into each swing bearing fitting.' },
      { id: 's3', instruction: 'Start the engine, swing 90°, stop the engine, and repeat until all four quadrants are greased.' },
    ],
    tutorialVideoId: 'VID-109',
    relatedVideoIds: ['VID-106'],
  },
  {
    id: 'TASK-005',
    title: 'Shift Handover Report',
    machineId: 'SITE-OFFICE',
    machine: 'Site Office',
    location: 'Admin Block',
    estimatedMinutes: 15,
    status: 'pending',
    priority: 'normal',
    scheduledStart: '17:30',
    description:
      'Brief the incoming operator on machine condition, open defects and anything unusual during your shift. Note the pump inspection result.',
    safetyChecklist: [{ id: 'machine-parked', label: 'Machine parked in designated bay' }],
    steps: [
      { id: 's1', instruction: 'Record engine hours and fuel level for MCH-042.' },
      { id: 's2', instruction: 'List any open defects and who has been told.' },
      { id: 's3', instruction: 'Walk the incoming operator to the machine if there are open defects.' },
    ],
    relatedVideoIds: ['VID-113'],
  },
];
