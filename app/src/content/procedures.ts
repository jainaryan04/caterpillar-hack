import type { SafetyCheckItem, TaskStep } from '@/types/domain';

/**
 * Site procedure content shown on Task Details. The Fleet API schedules work
 * but carries no instructions, so checklists and steps live on the device,
 * keyed by task type. Replace with a content service when one exists.
 */

export interface Procedure {
  safetyChecklist: SafetyCheckItem[];
  steps: TaskStep[];
}

const HELMET: SafetyCheckItem = { id: 'ppe-helmet', label: 'Wear safety helmet', detail: 'Chin strap fastened' };
const VEST: SafetyCheckItem = { id: 'ppe-vest', label: 'Wear high-visibility vest' };
const BOOTS: SafetyCheckItem = { id: 'ppe-boots', label: 'Wear steel-toe boots' };
const GLOVES: SafetyCheckItem = { id: 'ppe-gloves', label: 'Wear work gloves' };
const EYES: SafetyCheckItem = { id: 'ppe-eyes', label: 'Wear safety glasses' };
const HEARING: SafetyCheckItem = { id: 'ppe-hearing', label: 'Wear hearing protection' };
const WALKAROUND: SafetyCheckItem = {
  id: 'walkaround',
  label: 'Pre-start walkaround done',
  detail: 'No leaks, damage or missing guards',
};
const AREA: SafetyCheckItem = { id: 'area', label: 'Work area clear of people' };
const ISOLATED: SafetyCheckItem = {
  id: 'isolated',
  label: 'Equipment isolated and locked out',
  detail: 'Your own lock and tag on the isolation point',
};
const ZERO_ENERGY: SafetyCheckItem = { id: 'zero-energy', label: 'Zero energy proven', detail: 'Tried to start it: it must not move' };

const family: { match: RegExp; procedure: Procedure }[] = [
  {
    match: /excavation|demolition|site preparation|foundation|road building/i,
    procedure: {
      safetyChecklist: [HELMET, VEST, BOOTS, WALKAROUND, AREA, { id: 'services', label: 'Buried services marked', detail: 'Dig permit checked' }],
      steps: [
        { id: 's1', instruction: 'Walk the work face. Check for overhangs, soft ground and marked services.' },
        { id: 's2', instruction: 'Position the machine on firm, level ground with the tracks square to the face.' },
        { id: 's3', instruction: 'Keep the swing radius clear. Sound the horn before you swing or travel.', caution: 'Nobody within the swing radius while the machine is running.' },
        { id: 's4', instruction: 'Work in layers from the top down. Do not undercut the face.' },
        { id: 's5', instruction: 'At the end, park on level ground, lower the attachment and raise the hydraulic lockout lever.' },
      ],
    },
  },
  {
    match: /haul|loading|aggregate|freight/i,
    procedure: {
      safetyChecklist: [HELMET, VEST, BOOTS, WALKAROUND, { id: 'radio', label: 'Radio check with the loading area' }, { id: 'route', label: 'Haul route and speed limits confirmed' }],
      steps: [
        { id: 's1', instruction: 'Confirm the haul route, dump point and radio channel with the supervisor.' },
        { id: 's2', instruction: 'Spot under the loader only when signalled. Stay in the cab while loading.' },
        { id: 's3', instruction: 'Keep to the posted speed. Give way to loaded trucks on ramps.', caution: 'Keep at least two truck lengths from the vehicle in front.' },
        { id: 's4', instruction: 'Dump only at the marked edge, with the windrow in front of you.' },
      ],
    },
  },
  {
    match: /drill|well/i,
    procedure: {
      safetyChecklist: [HELMET, VEST, BOOTS, EYES, HEARING, WALKAROUND, { id: 'pattern', label: 'Drill pattern and depths confirmed' }],
      steps: [
        { id: 's1', instruction: 'Check the drill pattern, collar positions and hole depths with the plan.' },
        { id: 's2', instruction: 'Level the rig on its jacks before you raise the mast.' },
        { id: 's3', instruction: 'Keep everyone out of the rotating-equipment zone while drilling.', caution: 'Never reach over a rotating drill string.' },
        { id: 's4', instruction: 'Record depth, penetration rate and any voids for each hole.' },
      ],
    },
  },
  {
    match: /generator|power|cooling/i,
    procedure: {
      safetyChecklist: [HELMET, VEST, BOOTS, GLOVES, ISOLATED, ZERO_ENERGY, { id: 'permit', label: 'Electrical work permit issued' }],
      steps: [
        { id: 's1', instruction: 'Confirm the permit and isolation with the site electrician.' },
        { id: 's2', instruction: 'Check fuel, oil and coolant levels and look for leaks around the engine.' },
        { id: 's3', instruction: 'Inspect cables, terminals and the cooling fan guard.', caution: 'Hot surfaces: let the engine cool before touching the exhaust.' },
        { id: 's4', instruction: 'Remove your lock, run the unit under test load and record voltage, frequency and temperature.' },
      ],
    },
  },
  {
    match: /pipeline|gas|pump/i,
    procedure: {
      safetyChecklist: [HELMET, VEST, BOOTS, GLOVES, EYES, ISOLATED, { id: 'pressure', label: 'Line pressure released', detail: 'Gauge reads zero' }, { id: 'gas', label: 'Gas test clear' }],
      steps: [
        { id: 's1', instruction: 'Isolate and depressurise the section. Prove zero pressure on the gauge.' },
        { id: 's2', instruction: 'Inspect flanges, seals and fittings for leaks or corrosion.' },
        { id: 's3', instruction: 'Check the drive and couplings, and that guards are in place.' },
        { id: 's4', instruction: 'Restart, bring up pressure slowly and record discharge pressure.', caution: 'Stand clear of flanges while pressurising.' },
      ],
    },
  },
  {
    match: /rail|locomotive|tugboat|marine/i,
    procedure: {
      safetyChecklist: [HELMET, VEST, BOOTS, { id: 'protection', label: 'Track or vessel protection in place', detail: 'Lookout or possession confirmed' }, WALKAROUND],
      steps: [
        { id: 's1', instruction: 'Confirm the protection arrangement with the controller before you start.' },
        { id: 's2', instruction: 'Inspect in the order on the checklist sheet and mark every defect.' },
        { id: 's3', instruction: 'Report any defect that affects safe running straight away.' },
      ],
    },
  },
];

const generic: Procedure = {
  safetyChecklist: [HELMET, VEST, BOOTS, WALKAROUND, AREA],
  steps: [
    { id: 's1', instruction: 'Review the task with your supervisor and check the equipment before you start.' },
    { id: 's2', instruction: 'Carry out the work in the order agreed. Stop if conditions change.' },
    { id: 's3', instruction: 'Leave the area and equipment safe, and report any defects.' },
  ],
};

/** Extra checks driven by the task's scheduled conditions. */
function conditionChecks(weather?: string, shiftType?: string): SafetyCheckItem[] {
  const extra: SafetyCheckItem[] = [];
  if (weather && /rain|storm|snow|fog|wind/i.test(weather)) {
    extra.push({ id: 'weather', label: `${weather} conditions checked`, detail: 'Ground, visibility and slopes safe to work' });
  }
  if (shiftType && /night/i.test(shiftType)) {
    extra.push({ id: 'lighting', label: 'Work lights and beacons working' });
  }
  return extra;
}

export function procedureFor(taskType: string, weather?: string, shiftType?: string): Procedure {
  const base = family.find((f) => f.match.test(taskType))?.procedure ?? generic;
  return { steps: base.steps, safetyChecklist: [...base.safetyChecklist, ...conditionChecks(weather, shiftType)] };
}

/**
 * Training videos come from the Cat agent, which currently has Cat 320D
 * excavator material only, so tutorials are linked for excavator work.
 */
export function videosFor(machineType: string): { tutorialVideoId?: string; relatedVideoIds: string[] } {
  if (/excavator/i.test(machineType)) {
    return { tutorialVideoId: 'controls-tour', relatedVideoIds: ['start-to-finish', 'cat-320d-overview'] };
  }
  return { relatedVideoIds: [] };
}
