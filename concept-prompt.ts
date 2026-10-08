import { ConceptPrompt, ConceptScene, GenerationMode } from './types';

export interface ConceptPromptBuildResult {
  prompt: string;
  totalDuration: number;
  sceneCount: number;
}

export function buildConceptPrompt(concept: ConceptPrompt): ConceptPromptBuildResult {
  const scenes = concept.scenes || [];
  const totalDuration = scenes.reduce((sum, s) => sum + (s.duration || 0), 0);

  const sceneDescriptions = scenes.map((scene, idx) => {
    const num = idx + 1;
    const transIn = scene.transitionIn && scene.transitionIn !== 'none'
      ? ` Transition in: ${scene.transitionIn}.`
      : '';
    const transOut = scene.transitionOut && scene.transitionOut !== 'none'
      ? ` Transition out: ${scene.transitionOut}.`
      : '';
    return `Scene ${num} "${scene.name}": ${scene.description}. Duration: ${scene.duration}s.${transIn}${transOut}`;
  }).join('\n');

  const avoidClause = concept.avoid
    ? `Avoid: ${concept.avoid}.`
    : 'Avoid: text, logos, brand marks, real user data, flicker, clipping, external assets, network calls.';

  const prompt = [
    `Concept type: ${concept.conceptType}.`,
    `Overall visual style: ${concept.overallStyle}.`,
    `Total duration: ${totalDuration}s across ${scenes.length} scenes.`,
    '',
    'Scene breakdown:',
    sceneDescriptions,
    '',
    'Technical requirements:',
    '- Single self-contained HTML file with inline CSS and JS only',
    '- No external assets, fonts, images, or network calls',
    '- Use Web Animations API (element.animate) for all animations',
    '- All animations must be deterministic with fixed timing',
    '- Use CSS custom properties for consistent theming',
    '- Scene transitions must be smooth and deterministic',
    '- Final scene should hold or fade gracefully',
    '',
    avoidClause,
  ].join('\n');

  return {
    prompt,
    totalDuration,
    sceneCount: scenes.length,
  };
}

export function validateConceptPrompt(concept: ConceptPrompt): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!concept.conceptType?.trim()) {
    errors.push('Concept type is required');
  }

  if (!concept.overallStyle?.trim()) {
    errors.push('Overall style is required');
  }

  if (!concept.scenes || concept.scenes.length === 0) {
    errors.push('At least one scene is required');
  }

  concept.scenes?.forEach((scene, idx) => {
    if (!scene.name?.trim()) {
      errors.push(`Scene ${idx + 1}: name is required`);
    }
    if (!scene.description?.trim()) {
      errors.push(`Scene ${idx + 1}: description is required`);
    }
    if (!scene.duration || scene.duration <= 0) {
      errors.push(`Scene ${idx + 1}: duration must be positive`);
    }
    if (scene.duration > 60) {
      errors.push(`Scene ${idx + 1}: duration must be 60s or less`);
    }
  });

  const totalDuration = concept.scenes?.reduce((sum, s) => sum + (s.duration || 0), 0) || 0;
  if (totalDuration > 120) {
    errors.push('Total duration must be 120s or less');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function createDefaultConcept(): ConceptPrompt {
  return {
    conceptType: 'custom',
    overallStyle: 'modern minimalist with soft shadows and smooth transitions',
    scenes: [
      {
        id: crypto.randomUUID(),
        name: 'Scene 1',
        duration: 5,
        description: 'Opening state with main visual element',
        transitionIn: 'fade',
        transitionOut: 'fade',
      },
    ],
    totalDuration: 5,
    avoid: '',
  };
}

export function createScene(name: string, duration: number = 5): ConceptScene {
  return {
    id: crypto.randomUUID(),
    name,
    duration,
    description: '',
    transitionIn: 'fade',
    transitionOut: 'fade',
  };
}
