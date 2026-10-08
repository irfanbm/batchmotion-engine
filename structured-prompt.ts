export const structuredPromptKeys=['mainSubject','styleUseCase','composition','colorsMaterials','motion','atmosphere','avoid'] as const;
export {detectDictionaryMatches,pickDictionaryMatches} from './prompt-dictionary';
export function parseStructuredPrompt(value:string){const parts=value.split(';').map(part=>part.trim());return parts.length===7&&parts.every(Boolean)?Object.fromEntries(structuredPromptKeys.map((key,index)=>[key,parts[index]])) as Record<typeof structuredPromptKeys[number],string>:undefined}
export function validateStructuredPrompt(value:unknown){
  if(!value||typeof value!=='object')throw new Error('AI returned an invalid structured prompt. Try again.');
  const input=value as Record<string,unknown>,result=Object.fromEntries(structuredPromptKeys.map(key=>[key,typeof input[key]==='string'?input[key].trim():''])) as Record<typeof structuredPromptKeys[number],string>;
  if(structuredPromptKeys.some(key=>!result[key]||result[key].includes(';')))throw new Error('AI returned an invalid structured prompt. Try again.');
  return result;
}
