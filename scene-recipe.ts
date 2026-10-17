export type SceneRecipe = 'office-desk' | 'generic';

export function selectSceneRecipe(text: string): SceneRecipe {
  return /\b(?:desk|table|office|laptop|workstation|meja|komputer)\b/i.test(text) ? 'office-desk' : 'generic';
}

export const OFFICE_DESK_RECIPE = `
DETERMINISTIC SCENE RECIPE: office-desk
This is a constrained illustration recipe, not a request to invent a new coordinate system.
DESIGN SPACE: use viewBox 0 0 1920 1080. CSS stage is width:100%; height:100%; aspect ratio 16:9. All object coordinates live in this design space.
STAGE: render a warm wall/ground studio field, a soft upper-left light wash, one floor footprint shadow, and copy space on the right.
CANONICAL ANCHORS (design-space values):
- desk top left/front = (110,470), top right/front = (650,470), back right = (710,510), back left = (170,510); underside is exactly 16px below those four points.
- desk ground plane is y=790. Start both visible leg assemblies from the underside anchors, inset 38px from the desk ends; terminate both at y=790 with feet and shadow contact. Never leave a gap between tabletop and legs.
- desk top is a 540x40 projected slab; its top and camera-facing front/side faces share exact vertices. Do not draw a flat rectangle plus unrelated legs.
- closed laptop footprint is local to the desk: x=260..480, y=430..464 on the desk top plane. Its base, flush lid, two side faces, and contact shadow must be inside the desk assembly and inherit the same parent transform.
LAYER ORDER: background → ground → rear legs/supports → desk underside → desktop top/faces → laptop contact shadow → closed laptop base/lid → front edge/highlights.
MATERIAL TOKENS: wood base #b89970, wood light #d7bd91, wood dark #806447; frame base #343a3d, frame light #70797b, frame dark #1d2224; laptop base #292e30, laptop light #555c5d, laptop dark #151819; shadow rgba(45,35,25,.22).
MOTION: use one paused deterministic timeline. Default to coordinated drift of the complete desk assembly (±6px) and a separate subtle light sweep. The closed laptop is rigid; never animate a lid independently. If parallax is explicitly requested, use three wrappers with ±3/±6/±10px, not arbitrary whole-subject replacement.
QA: the desktop/legs/laptop must be connected through these anchors; first and last frame must match; no visible gap, missing face, detached laptop, clipping, or blank frame.`;

export function recipeForBlueprint(blueprintText: string): string {
  return selectSceneRecipe(blueprintText) === 'office-desk' ? OFFICE_DESK_RECIPE : '';
}
