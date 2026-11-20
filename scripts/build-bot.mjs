// Package only committed runtime sources. No frontend, Pi or Anpai dependencies.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=process.cwd();
const commit=execFileSync('git',['rev-parse','--verify',(process.argv[2]||'HEAD')+'^{commit}'],{encoding:'utf8'}).trim();
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'openbot-package-'));
try {
  const archive=execFileSync('git',['archive',commit,'src/bot','src/oh-client.ts','src/oh-events.ts','src/types.ts']);
  execFileSync('tar',['-x','-C',temp],{input:archive});
  const out=path.join(temp,'dist');
  execFileSync(process.execPath,[path.join(root,'node_modules/typescript/bin/tsc'),path.join(temp,'src/bot/main.ts'),'--target','ES2022','--module','ES2022','--moduleResolution','node','--esModuleInterop','--skipLibCheck','--strict','--types','node','--outDir',out,'--noEmitOnError'],{stdio:'inherit'});
  fs.writeFileSync(path.join(out,'package.json'),JSON.stringify({type:'module',sourceCommit:commit}));
  fs.mkdirSync(path.join(root,'dist'),{recursive:true});
  const target=path.join(root,'dist',`openbot-runtime-${commit.slice(0,7)}.tar.gz`);
  execFileSync('tar',['-czf',target,'-C',out,'.']);console.log(target);
} finally {fs.rmSync(temp,{recursive:true,force:true});}
