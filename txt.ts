import fs from 'node:fs/promises';

export function pendingTxtPrompts(text:string){return text.split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!/^\[\s*DONE\s*\]/i.test(line));}
export async function markTxtDone(file:string,prompt:string){const text=await fs.readFile(file,'utf8'),newline=text.includes('\r\n')?'\r\n':'\n',lines=text.split(/\r?\n/),index=lines.findIndex(line=>line.trim()===prompt);if(index<0)return false;lines[index]=`[ DONE ] ${lines[index].trim()}`;const temporary=`${file}.tmp`;await fs.writeFile(temporary,lines.join(newline));await fs.rename(temporary,file);return true;}
