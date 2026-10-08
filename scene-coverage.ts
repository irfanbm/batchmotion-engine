import type {MotionRect} from './geometry';

export type ScenePaint={tag:string;rect:MotionRect;background:boolean;paint:boolean};
export type SceneLayout={paints:ScenePaint[]};

function clippedArea(rect:MotionRect,width:number,height:number){const left=Math.max(0,rect.x),top=Math.max(0,rect.y),right=Math.min(width,rect.x+rect.width),bottom=Math.min(height,rect.y+rect.height);return Math.max(0,right-left)*Math.max(0,bottom-top)}
export function rectCoverage(rect:MotionRect|undefined,width:number,height:number){return rect?clippedArea(rect,width,height)/Math.max(1,width*height):0}

export function pixelSceneCoverage(bitmap:Buffer,width:number,height:number){
  if(bitmap.length<width*height*4||width<1||height<1)return{occupiedRatio:0,boundsRatio:0,variation:false};
  const reference=bitmap.readUInt32LE(0);let occupied=0,minX=width,minY=height,maxX=-1,maxY=-1,samples=0;
  const stepX=Math.max(1,Math.floor(width/64)),stepY=Math.max(1,Math.floor(height/36));
  for(let y=0;y<height;y+=stepY)for(let x=0;x<width;x+=stepX){samples++;if(bitmap.readUInt32LE((y*width+x)*4)!==reference){occupied++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)}}
  return{occupiedRatio:occupied/Math.max(1,samples),boundsRatio:occupied?(maxX-minX+stepX)*(maxY-minY+stepY)/(width*height):0,variation:occupied>0};
}

export function opaqueBackdropReport(layout:SceneLayout,metadataBackgrounds:MotionRect[],bitmap:Buffer,width:number,height:number){
  const painted=layout.paints.filter(item=>item.background||item.paint).map(item=>rectCoverage(item.rect,width,height));
  const metadata=metadataBackgrounds.map(rect=>rectCoverage(rect,width,height));
  const declaredCoverage=Math.min(1,Math.max(0,...painted,...metadata));
  const pixels=pixelSceneCoverage(bitmap,width,height);
  // Pixel bounds prove a non-uniform canvas scene; CSS/SVG paint or background metadata also proves solid backdrops.
  const pixelProven=pixels.occupiedRatio>=.005&&pixels.boundsRatio>=.9;
  return{ok:declaredCoverage>=.98||pixelProven,coverage:declaredCoverage,pixelOccupied:pixels.occupiedRatio,pixelBounds:pixels.boundsRatio,source:declaredCoverage>=.98?'layout/metadata':pixelProven?'captured pixels':'none'};
}
