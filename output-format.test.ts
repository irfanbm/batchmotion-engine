import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {adaptationCacheMatches,adaptationCacheSignature,HTML_ADAPTATION_CONTRACT_VERSION} from './html-import';
import {outputContract} from './ai';
import {effectiveRenderSettings,restoreQueue} from './queue';
import {alphaTimelineReport,analyzeAlpha,assertOutputSizePolicy,estimateOutputBytes,isStockSafeDuration,normalizeOutputFormat,outputExtension,outputPolicy,requiredDiskBytes,verifyEncodedAlpha,verifyProbe,videoEncodeArgs} from './output-format';

function run(executable:string,args:string[]){return new Promise<string>((resolve,reject)=>{const child=spawn(executable,args,{windowsHide:true});let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.on('error',error=>reject(new Error(`Cannot start ${executable}: ${error.message}`)));child.on('close',code=>code===0?resolve(stdout):reject(new Error(`${path.basename(executable)} failed (${code}). ${stderr.slice(-1000)}`)))})}
const rgba=(alphas:number[])=>Buffer.from(alphas.flatMap((alpha,index)=>[index%2?220:40,index%3?80:200,120,alpha]));
const probeFixture=(overrides:Record<string,unknown>={})=>({format:{format_name:'mov,mp4,m4a,3gp,3g2,mj2',duration:'1.000000'},streams:[{codec_type:'video',codec_name:'prores',codec_tag_string:'ap4h',profile:'4444',pix_fmt:'yuva444p12le',width:16,height:16,avg_frame_rate:'3/1',r_frame_rate:'3/1',duration:'1.000000',...overrides}]});

void(async()=>{
  assert.equal(normalizeOutputFormat(undefined),'mp4-h264');
  const restored=restoreQueue([{id:'1',prompt:'x',seed:1,status:'queued',progress:0,duration:10,width:10,height:10,createdAt:''}]);
  assert.equal(restored[0].outputFormat,'mp4-h264');
  assert.equal(outputExtension('mov-prores4444-alpha'),'.mov');
  const mov=videoEncodeArgs('mov-prores4444-alpha',30,'in','out');
  for(const value of ['-an','prores_ks','4','yuva444p10le','16','bt709'])assert(mov.includes(value));
  assert(videoEncodeArgs('mp4-h264',30,'in','out').includes('yuv420p'));

  const opaque=rgba([255,255,255,255]),transparent=rgba([0,0,0,0]),antialias=rgba([1,64,128,249]),mixed=rgba([0,128,250,255]);
  assert.equal(analyzeAlpha(opaque).valid,false);
  assert.equal(analyzeAlpha(transparent).valid,false);
  assert.equal(analyzeAlpha(antialias).valid,false);
  assert.equal(analyzeAlpha(mixed).valid,true);
  const timeline=alphaTimelineReport([{timestamp:0,bitmap:mixed},{timestamp:.5,bitmap:mixed},{timestamp:1,bitmap:mixed}]);
  assert.equal(timeline.valid,true);assert.deepEqual(timeline.frames.map(x=>x.timestamp),[0,.5,1]);
  assert.equal(alphaTimelineReport([{timestamp:0,bitmap:mixed},{timestamp:.5,bitmap:opaque},{timestamp:1,bitmap:mixed}]).valid,false);

  assert(isStockSafeDuration(5)&&isStockSafeDuration(60)&&!isStockSafeDuration(4));
  assert.equal(outputPolicy(2.5e9,false).warning,false);assert.equal(outputPolicy(2.5e9+1,false).warning,true);
  assert.equal(outputPolicy(3.5e9,false).requiresOverride,false);assert.equal(outputPolicy(3.5e9+1,false).requiresOverride,true);assert.equal(outputPolicy(3.5e9+1,true).requiresOverride,false);
  assert.throws(()=>assertOutputSizePolicy('mov-prores4444-alpha',1000,1000,60,79,false),/Encode Anyway/);
  assert.doesNotThrow(()=>assertOutputSizePolicy('mov-prores4444-alpha',1000,1000,60,79,true));
  assert(requiredDiskBytes('mov-prores4444-alpha',100,100,30,5)>estimateOutputBytes('mov-prores4444-alpha',100,100,30,5));

  const base=adaptationCacheSignature('model-a',5,30,false,'mp4-h264');
  for(const changed of [adaptationCacheSignature('model-b',5,30,false,'mp4-h264'),adaptationCacheSignature('model-a',6,30,false,'mp4-h264'),adaptationCacheSignature('model-a',5,60,false,'mp4-h264'),adaptationCacheSignature('model-a',5,30,true,'mp4-h264'),adaptationCacheSignature('model-a',5,30,false,'mov-prores4444-alpha')])assert.notEqual(base,changed);
  assert(base.startsWith(`${HTML_ADAPTATION_CONTRACT_VERSION}|`));assert(adaptationCacheMatches(base,'model-a',5,30,false,'mp4-h264'));
  const persisted={adaptationContractVersion:HTML_ADAPTATION_CONTRACT_VERSION,adaptationSignature:base};assert.equal(JSON.parse(JSON.stringify(persisted)).adaptationSignature,base);

  assert(verifyProbe('mov-prores4444-alpha',probeFixture(),16,16,1,3));
  assert(verifyProbe('mov-prores4444-alpha',probeFixture({codec_tag_string:'ap4x',profile:'4444 XQ',pix_fmt:'yuva444p10le'}),16,16,1,3));
  for(const override of [{codec_name:'h264'},{codec_tag_string:'apcn'},{profile:'HQ'},{pix_fmt:'yuv422p10le'},{width:32},{height:32},{avg_frame_rate:'30/1'},{r_frame_rate:'30/1'},{duration:'2.000000'}])assert.equal(verifyProbe('mov-prores4444-alpha',probeFixture(override),16,16,1,3),false,JSON.stringify(override));
  const withAudio=probeFixture();withAudio.streams.push({codec_type:'audio'} as never);assert.equal(verifyProbe('mov-prores4444-alpha',withAudio,16,16,1,3),false);
  assert.match(outputContract({outputFormat:'mov-prores4444-alpha'} as never),/native transparency.*no background removal/i);
  assert.equal(effectiveRenderSettings({duration:1,width:1,height:1,outputFormat:'mov-prores4444-alpha'} as never,{outputFormat:'mp4-h264'} as never).outputFormat,'mov-prores4444-alpha');

  const root=await fs.mkdtemp(path.join(os.tmpdir(),'batchmotion-prores-smoke-'));
  try{
    const vendorDir = process.env.BATCHMOTION_FFMPEG_DIR || 'vendor/ffmpeg';
    const ffmpeg=path.resolve(vendorDir, 'ffmpeg.exe'),ffprobe=path.resolve(vendorDir, 'ffprobe.exe'),raw=path.join(root,'frames.rgba'),movFile=path.join(root,'alpha.mov'),tempRoot=path.join(root,'verify');
    await fs.mkdir(tempRoot);const frame=Buffer.alloc(16*16*4);for(let y=0;y<16;y++)for(let x=0;x<16;x++){const i=(y*16+x)*4;frame[i]=x*16;frame[i+1]=y*16;frame[i+2]=100;frame[i+3]=x<8?0:255}await fs.writeFile(raw,Buffer.concat([frame,frame,frame]));
    await run(ffmpeg,['-v','error','-f','rawvideo','-pix_fmt','rgba','-s','16x16','-framerate','3','-i',raw,...videoEncodeArgs('mov-prores4444-alpha',3,raw,movFile).slice(6)]).catch(error=>{throw new Error(`Bundled FFmpeg must support prores_ks profile 4 with yuva444p10le. ${(error as Error).message}`)});
    const probe=JSON.parse(await run(ffprobe,['-v','error','-show_streams','-show_format','-of','json',movFile]));assert(verifyProbe('mov-prores4444-alpha',probe,16,16,1,3),JSON.stringify(probe));
    const report=await verifyEncodedAlpha(movFile,ffmpeg,1,3,{tempRoot});assert(report.valid);report.frames.forEach((value,index)=>assert(Math.abs(value.timestamp-[0,1/3,2/3][index])<1e-9));assert((await fs.readdir(tempRoot)).length===0,'verifyEncodedAlpha temporary samples were not cleaned');
    const stream=probe.streams[0];console.log(`ProRes alpha smoke: codec=${stream.codec_name} tag=${stream.codec_tag_string} profile=${stream.profile} pix_fmt=${stream.pix_fmt} ${stream.width}x${stream.height} fps=${stream.avg_frame_rate} duration=${stream.duration||probe.format.duration}`);console.log(`Alpha ratios: ${report.frames.map(x=>`t=${x.timestamp.toFixed(3)} transparent=${x.transparentRatio.toFixed(4)} visible=${x.visibleRatio.toFixed(4)}`).join('; ')}`);
  }finally{await fs.rm(root,{recursive:true,force:true})}
  console.log('output format checks passed');
})().catch(error=>{console.error(error);process.exitCode=1});
