import type { ProceduralRecipe } from './proceduralPoseEngine';

export type StudioTab = 'generator' | 'finetune' | 'motion' | 'library' | 'editor';
export type RenderStyleMode = 'cutout' | 'digital' | 'silhouette';
export type CameraFraming = 'full' | 'upper' | 'skull' | 'extremities';

export interface CuratedPreset {
  id: string;
  title: string;
  subtitle: string;
  recipe: Partial<ProceduralRecipe>;
}

export const CURATED_RECIPES: CuratedPreset[] = [
  {
    id: 'preset_vitruvian_canon',
    title: 'Vitruvian Canon',
    subtitle: 'Composed · Vitruvian Neutral · Front',
    recipe: {
      mood: 'composed',
      stance: 'vitruvian',
      bodyView: 'front',
      elevation: 'eyeLevel',
      vanishing: 'center',
      skullFacing: 'front',
      intensity: 'standard',
      symmetry: 'mirrorLtoR',
      armAttitude: 'spread',
      prometheusWings: false,
      ribAnchor: 'upper',
    },
  },
  {
    id: 'preset_promethean_ascend',
    title: 'Promethean Chungus',
    subtitle: "Dramatic · Promethean · Worm's-Eye",
    recipe: {
      mood: 'dramatic',
      stance: 'promethean',
      bodyView: 'front',
      elevation: 'wormsEye',
      vanishing: 'center',
      skullFacing: 'front',
      intensity: 'dramatic',
      symmetry: 'mirrorArms',
      prometheusWings: true,
      ribAnchor: 'lower',
    },
  },
  {
    id: 'preset_heroic_contrapposto',
    title: 'Heroic Contrapposto',
    subtitle: "Heroic · Contrapposto · 3/4 Right · Worm's-Eye",
    recipe: {
      mood: 'heroic',
      stance: 'contrapposto',
      bodyView: 'threeQuarterR',
      elevation: 'wormsEye',
      vanishing: 'right',
      skullFacing: 'auto',
      intensity: 'dramatic',
      symmetry: 'procedural',
      prometheusWings: false,
      ribAnchor: 'upper',
    },
  },
  {
    id: 'preset_predator_sprint',
    title: 'Predatory Sprint',
    subtitle: 'Predatory · Sprint Drive · Profile R · Extreme Low',
    recipe: {
      mood: 'predatory',
      stance: 'sprintDrive',
      bodyView: 'sideR',
      elevation: 'extremeLow',
      vanishing: 'right',
      skullFacing: 'sideR',
      intensity: 'dramatic',
      symmetry: 'procedural',
      handBuild: 'claw',
      jaw: 'open',
      prometheusWings: true,
      ribAnchor: 'ribwings',
    },
  },
  {
    id: 'preset_seated_inquisitive',
    title: 'Seated Contemplation',
    subtitle: 'Inquisitive · Seated Perched · 3/4 Left',
    recipe: {
      mood: 'inquisitive',
      stance: 'seatedPerched',
      bodyView: 'threeQuarterL',
      elevation: 'eyeLevel',
      vanishing: 'left',
      skullFacing: 'auto',
      intensity: 'standard',
      symmetry: 'procedural',
      headPitch: 'tiltL',
      prometheusWings: false,
      ribAnchor: 'upper',
    },
  },
  {
    id: 'preset_melancholy_crouch',
    title: 'Weighted Solitude',
    subtitle: "Melancholic · Deep Crouch · Bird's-Eye",
    recipe: {
      mood: 'melancholic',
      stance: 'deepCoil',
      bodyView: 'threeQuarterL',
      elevation: 'birdsEye',
      vanishing: 'left',
      skullFacing: 'auto',
      intensity: 'dramatic',
      symmetry: 'procedural',
      headPitch: 'chinTuck',
      prometheusWings: false,
      ribAnchor: 'upper',
    },
  },
];
