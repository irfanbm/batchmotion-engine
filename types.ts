export type OutputFormat='mp4-h264'|'mov-prores4444-alpha';export type JobStatus='queued'|'generating'|'adapting'|'validating'|'ready'|'preview'|'rendering'|'encoding'|'completed'|'failed'|'stopped';
export type DictionaryCategory='style'|'motion'|'palette'|'composition'|'material'|'subject';
export interface DictionaryEntry{id:string;category:DictionaryCategory;name:string;description:string;tokens:string[];fallback?:boolean}
export interface DictionaryMatch{entry:DictionaryEntry;score:number;matchedTokens:string[]}
export interface Beat{time:number;label:string}
export type GenerationMode='background'|'concept'|'split'|'hyperframes';
export interface ConceptScene{id:string;name:string;duration:number;description:string;transitionIn?:'fade'|'slide-left'|'slide-right'|'slide-up'|'slide-down'|'scale'|'none';transitionOut?:'fade'|'slide-left'|'slide-right'|'slide-up'|'slide-down'|'scale'|'none'}
export interface ConceptPrompt{conceptType:string;overallStyle:string;scenes:ConceptScene[];totalDuration:number;avoid?:string}
export interface Settings{baseUrl:string;apiKey:string;model:string;outputFolder:string;width:number;height:number;fps:number;duration:number;retryCount:number;concurrentJobs:number;ffmpegPath:string;theme:'dark';motionStyle:'calm'|'balanced'|'dynamic'|'prompt'|'auto';outputFormat:OutputFormat;encodeAnywayLarge:boolean;artifactMode:'video'|'metadata'|'debug';retentionDays:number;looping:boolean;adobeClientId:string;autoStartQueue:boolean;autoBeautyPrompt:boolean;defaultMode?:GenerationMode;conceptSceneDuration?:number;autoApprove?:boolean;generationModel?:string;refinementModel?:string}
export interface Job{id:string;prompt:string;seed:number;status:JobStatus;progress:number;duration:number;width:number;height:number;fps?:number;looping?:boolean;motionStyle?:Settings['motionStyle'];mode?:GenerationMode;conceptData?:ConceptPrompt;outputFormat?:OutputFormat;encodeAnywayLarge?:boolean;output?:string;projectPath?:string;baseName?:string;htmlPath?:string;videoPath?:string;error?:string;rawResponse?:string;retryCount?:number;sourceTxtPath?:string;sourceKind?:'prompt'|'html-import'|'importedHtml';importFilename?:string;importId?:string;importedSourcePath?:string;sourceHtmlPath?:string;adaptedHtmlPath?:string;adaptationModel?:string;adaptationContractVersion?:string;adaptationSignature?:string;createdAt:string;model?:string;generationModel?:string;refinementModel?:string;blueprint?:unknown;previewStills?:string[];iconAssets?:import('./icon-source').IconAsset[]}
export interface HistoryItem extends Job{completedAt:string;thumbnail:string}export interface LogEntry{id:string;timestamp:string;level:'info'|'warning'|'error';message:string;jobId?:string}export type InsightStatus='New'|'Prompted'|'Queued'|'Rendering'|'Rendered'|'Failed';
export interface InsightRecord{id:string;title:string;row?:unknown;jobId?:string;output?:string;promptVersions:{original:string;beautified?:string;final?:string};settingsSnapshot?:Pick<Settings,'width'|'height'|'fps'|'duration'|'looping'|'motionStyle'|'defaultMode'>;createdAt:string;updatedAt:string}


// Host-provided collaborators for QueueService. The engine never touches app storage
// or paths directly; the host app injects both at construction.
export interface EngineStore {
  history(): Promise<HistoryItem[]>;
  queue(): Promise<Job[]>;
  saveQueue(jobs: Job[]): Promise<void>;
  saveHistory(history: HistoryItem[]): Promise<void>;
}
export interface EnginePaths {
  userData: string;
}
export type PreviewDecision =
  | { action: 'render' }
  | { action: 'revise'; note: string }
  | { action: 'remake' }
  | { action: 'delete' };
